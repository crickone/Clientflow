import "server-only";

import { and, asc, eq, inArray, lte, ne, sql } from "drizzle-orm";

import { schema } from "@/lib/db";
import { getTenantDbById, runWithTenant, type TenantDb } from "@/lib/db/tenant";
import type { AutomationQueueRow } from "@/lib/db/schema";
import { TRIGGER_LABELS } from "@/lib/automationModel";
import { getAppBaseUrl } from "@/lib/appUrl";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { escapeHtml, renderEmailShell, textToParagraphs } from "@/lib/email";
import { notifyUser } from "@/lib/notifications/notify";
import { isStopped } from "@/lib/platform/killSwitch";
import { getThemeForTenant } from "@/lib/settings";

import { flowNow } from "./clock";
import { unsubscribeUrl } from "./consent";
import { CALL_BACK_FLOW, IMPORTED_RUN_SOURCE, isTriggerEnabled, NURTURE_FLOW, parsePayload, PENDING_STATUSES, resolveColumn } from "./flowModel";
import { isRecipientUndeliverable } from "./flowPlan";
import { startFlow } from "./runs";
import { endOfLocalDay, fitToWindow } from "./sendingWindow";
import { getLeadFlowSettingsForTenant } from "./settings";
import type { LeadFlowSettings } from "./settingsModel";
import { getFlowTransport } from "./transport";
import { handleUndelivered } from "./undelivered";

/**
 * Send what is due in the lead flows, for one tenant. Called by the minute
 * dispatch ticker (lib/dispatch/ticker.ts). Each row is one of:
 *   message        a WhatsApp or email to the lead, inside sending hours
 *   move           a flow ending with no reply: the card moves column
 * (later kinds are added to HANDLERS below). Every outcome is written back
 * to the row; messages also go to automation_log, the Sent view.
 */

const BATCH = 25;

export const WHATSAPP_NOT_CONNECTED = "WhatsApp is not connected. Add credentials in Settings → Integrations → WhatsApp.";

export interface DispatchContext {
  tenantId: number;
  tdb: TenantDb;
  now: number;
  baseUrl: string;
  settings: LeadFlowSettings;
  businessName: string;
  accent: string;
}

/** Handles one due row. Returns true when a message went to a lead. */
export type RowHandler = (ctx: DispatchContext, row: AutomationQueueRow) => Promise<boolean>;

export function markRow(
  tdb: TenantDb,
  id: number,
  patch: { status: "queued" | "sent" | "failed" | "cancelled" | "held"; error?: string | null; sentAt?: Date | null; providerMessageId?: string | null },
): void {
  tdb.update(schema.automationQueue).set(patch).where(eq(schema.automationQueue.id, id)).run();
}

export function logSend(ctx: DispatchContext, row: AutomationQueueRow, channel: string, subject: string | null, sentTo: string | null, error: string | null, triggerName?: string): void {
  ctx.tdb.insert(schema.automationLog)
    .values({
      triggerKey: row.triggerKey,
      triggerName: triggerName ?? TRIGGER_LABELS[row.triggerKey] ?? row.triggerKey,
      channel,
      subject,
      sentTo,
      status: error ? "failed" : "sent",
      sentAt: new Date(ctx.now),
    })
    .run();
}

function isAddressSuppressed(tdb: TenantDb, email: string): boolean {
  const clean = email.trim().toLowerCase();
  return !!tdb.select({ id: schema.suppressions.id }).from(schema.suppressions).where(sql`lower(${schema.suppressions.email}) = ${clean}`).get();
}

async function sendWhatsAppRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  const transport = getFlowTransport();
  let error: string | null = null;
  let providerMessageId: string | null = null;
  let undeliverable = false;
  if (item.leadId == null) error = "No lead to send to.";
  else if (!transport.whatsAppConnected()) error = WHATSAPP_NOT_CONNECTED;
  else {
    try {
      providerMessageId = (await transport.sendWhatsAppToLead(item.leadId, item.body)).providerMessageId;
    } catch (err) {
      error = err instanceof Error ? err.message : "WhatsApp send failed.";
      // Only a recipient-level failure (not on WhatsApp, a bad number) counts. An
      // outage, timeout, expired token or rate limit stays a plain failed row.
      undeliverable = isRecipientUndeliverable(error);
    }
  }
  markRow(ctx.tdb, item.id, { status: error ? "failed" : "sent", error, sentAt: new Date(ctx.now), providerMessageId });
  logSend(ctx, item, "whatsapp", null, item.sendTo, error);
  if (error) console.error(`[lead flows] tenant ${ctx.tenantId} WhatsApp ${item.id} failed: ${error}`);
  // The recipient can't be reached on the run's first WhatsApp: Message undelivered, the rest by email.
  if (undeliverable && error) await handleUndelivered(ctx.tenantId, { ...item, status: "failed", error }, error);
  return !error;
}

async function sendEmailRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  // Stopped between the batch query and this row: hold it, untouched.
  if (isStopped("email")) return false;
  if (!item.sendTo) {
    markRow(ctx.tdb, item.id, { status: "failed", error: "No email address." });
    return false;
  }
  if (isAddressSuppressed(ctx.tdb, item.sendTo)) {
    markRow(ctx.tdb, item.id, { status: "cancelled", error: "Not sent: this address unsubscribed, bounced or complained." });
    return false;
  }
  const subject = item.subject || `A message from ${ctx.businessName}`;
  let bodyHtml = textToParagraphs(item.body);
  let text = item.body;
  // Long-term nurture is marketing: still agreed to, and every email carries the signed unsubscribe link.
  if (item.triggerKey === NURTURE_FLOW) {
    const lead = item.leadId == null
      ? undefined
      : ctx.tdb
          .select({ marketingConsentAt: schema.leads.marketingConsentAt, firstName: schema.leads.firstName, lastName: schema.leads.lastName, phone: schema.leads.phone })
          .from(schema.leads)
          .where(eq(schema.leads.id, item.leadId))
          .get();
    if (!lead || lead.marketingConsentAt == null) {
      markRow(ctx.tdb, item.id, { status: "cancelled", error: "Not sent: no marketing consent." });
      return false;
    }
    let url: string;
    try {
      url = unsubscribeUrl(ctx.tdb, ctx.tenantId, ctx.baseUrl, { email: item.sendTo, firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone });
    } catch (err) {
      const error = `Can't add the unsubscribe link: ${err instanceof Error ? err.message : "unknown error"}`.slice(0, 300);
      markRow(ctx.tdb, item.id, { status: "failed", error, sentAt: new Date(ctx.now) });
      logSend(ctx, item, "email", item.subject, item.sendTo, error);
      return false;
    }
    bodyHtml += `<p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Don't want these emails? <a href="${escapeHtml(url)}" style="color:#9ca3af;">Unsubscribe</a>.</p>`;
    text += `\n\nUnsubscribe: ${url}`;
  }
  const html = renderEmailShell({ businessName: ctx.businessName, accent: ctx.accent, bodyHtml, footer: `Sent by ${ctx.businessName}.` });
  let error: string | null = null;
  try {
    const res = await getFlowTransport().sendEmail(ctx.tenantId, { to: item.sendTo, subject, html, text });
    if (!res.ok) error = ("error" in res && typeof res.error === "string" && res.error) || "Send failed.";
  } catch (err) {
    error = err instanceof Error ? err.message : "Send failed.";
  }
  markRow(ctx.tdb, item.id, { status: error ? "failed" : "sent", error, sentAt: new Date(ctx.now) });
  logSend(ctx, item, "email", subject, item.sendTo, error);
  return !error;
}

async function sendMessageRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  // A call reminder is useless once the call time has passed, inside sending hours or not.
  const notAfter = parsePayload(item.payload).notAfter;
  if (notAfter != null && ctx.now >= notAfter) {
    markRow(ctx.tdb, item.id, { status: "cancelled", error: "Too late: the call time has passed." });
    return false;
  }
  // Sending hours: a row that became due outside them waits for the next window.
  const allowed = fitToWindow(ctx.now, item.channel, ctx.settings.window);
  if (allowed > ctx.now) {
    if (notAfter != null && allowed >= notAfter) {
      markRow(ctx.tdb, item.id, { status: "cancelled", error: "Too late: sending hours would put it after the call." });
      return false;
    }
    ctx.tdb.update(schema.automationQueue).set({ dueAt: new Date(allowed) }).where(eq(schema.automationQueue.id, item.id)).run();
    return false;
  }
  if (item.channel === "whatsapp") return sendWhatsAppRow(ctx, item);
  if (item.channel === "email") return sendEmailRow(ctx, item);
  markRow(ctx.tdb, item.id, { status: "failed", error: "This channel does not send." });
  return false;
}

async function runMoveRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  const { column } = parsePayload(item.payload);
  if (item.leadId == null || !column) {
    markRow(ctx.tdb, item.id, { status: "failed", error: "Nothing to move." });
    return false;
  }
  const lead = ctx.tdb.select({ pipelineId: schema.leads.pipelineId, stageId: schema.leads.stageId }).from(schema.leads).where(eq(schema.leads.id, item.leadId)).get();
  if (!lead) {
    markRow(ctx.tdb, item.id, { status: "cancelled", error: "Lead no longer exists." });
    return false;
  }
  // Loaded here: the stage writer imports the flows.
  const { listStages } = await import("@/lib/pipeline/stageRepo");
  const target = resolveColumn(column, listStages(lead.pipelineId));
  if (!target) {
    markRow(ctx.tdb, item.id, { status: "cancelled", error: "This board has no such column." });
    return false;
  }
  // Marked done first: entering the column may start a flow, which stops this run.
  markRow(ctx.tdb, item.id, { status: "sent", error: null, sentAt: new Date(ctx.now) });
  if (lead.stageId !== target.id) {
    const { writeStageId } = await import("@/lib/pipeline/stage");
    const label = TRIGGER_LABELS[item.triggerKey] ?? item.triggerKey;
    writeStageId(item.leadId, target.id, `Lead moved to ${target.name}: ${label} ended with no reply`, "automation");
  }
  return false;
}

async function sendStaffAlertRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  const p = parsePayload(item.payload);
  if (p.userId != null && p.title) {
    notifyUser(p.userId, { kind: "lead", title: p.title, body: p.body ?? "", href: p.href ?? "/leads", key: `alert:${item.id}` });
  }
  if (!p.whatsappText) {
    markRow(ctx.tdb, item.id, { status: "sent", error: null, sentAt: new Date(ctx.now) });
    return false;
  }
  const to = ctx.settings.alertWhatsAppTo;
  if (!to) {
    markRow(ctx.tdb, item.id, { status: "cancelled", error: "No WhatsApp alert number is set." });
    return false;
  }
  const transport = getFlowTransport();
  let error: string | null = null;
  if (!transport.whatsAppConnected()) error = WHATSAPP_NOT_CONNECTED;
  else {
    try {
      await transport.sendWhatsAppToNumber(to, p.whatsappText);
    } catch (err) {
      error = err instanceof Error ? err.message : "WhatsApp send failed.";
    }
  }
  markRow(ctx.tdb, item.id, { status: error ? "failed" : "sent", error, sentAt: new Date(ctx.now) });
  logSend(ctx, item, "whatsapp", null, to, error, "Staff alert");
  return false;
}

async function unknownRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  markRow(ctx.tdb, item.id, { status: "failed", error: "Unknown queue row." });
  return false;
}

/** The triage never answered: treat the reply as wanting to talk, so a person looks. */
async function runReplyCheckRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  markRow(ctx.tdb, item.id, { status: "sent", error: "No triage answer in time: treated as wanting to talk.", sentAt: new Date(ctx.now) });
  if (item.leadId == null) return false;
  const { resolveThinkingReply } = await import("@/lib/pipeline/stage");
  resolveThinkingReply(item.leadId, parsePayload(item.payload).text ?? "", true);
  return false;
}

/** End of the picked call-back day: still in Call back later, so nobody reached them. Start its flow the next morning. */
async function runCallbackCheckRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  const { day } = parsePayload(item.payload);
  markRow(ctx.tdb, item.id, { status: "sent", error: null, sentAt: new Date(ctx.now) });
  if (item.leadId == null || !day) return false;
  const lead = ctx.tdb.select({ pipelineId: schema.leads.pipelineId, stageId: schema.leads.stageId }).from(schema.leads).where(eq(schema.leads.id, item.leadId)).get();
  if (!lead) return false;
  const { listStages } = await import("@/lib/pipeline/stageRepo");
  const current = listStages(lead.pipelineId).find((s) => s.id === lead.stageId);
  if (current?.systemKey !== "call_back") return false;
  startFlow(item.leadId, CALL_BACK_FLOW, { firstAt: fitToWindow(endOfLocalDay(day) + 1, "whatsapp", ctx.settings.window), now: ctx.now });
  return false;
}

/** What each kind of row does when it is due. */
const HANDLERS: Record<string, RowHandler> = {
  callback_check: runCallbackCheckRow,
  message: sendMessageRow,
  move: runMoveRow,
  reply_check: runReplyCheckRow,
  staff_alert: sendStaffAlertRow,
};

function closeRunIfDone(tdb: TenantDb, runId: number, now: number): void {
  const left = tdb
    .select({ id: schema.automationQueue.id })
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.runId, runId), inArray(schema.automationQueue.status, [...PENDING_STATUSES])))
    .get();
  if (left) return;
  tdb.update(schema.leadFlowRuns)
    .set({ status: "finished", endedAt: new Date(now) })
    .where(and(eq(schema.leadFlowRuns.id, runId), eq(schema.leadFlowRuns.status, "active")))
    .run();
}

/** Send every due row for one tenant. Returns how many messages went to leads. */
export async function dispatchDueAutomationQueue(tenantId: number, now: number = flowNow(), baseUrl?: string): Promise<number> {
  return runWithTenant(tenantId, () => dispatchBound(tenantId, now, baseUrl));
}

async function dispatchBound(tenantId: number, now: number, baseUrl?: string): Promise<number> {
  const tdb = getTenantDbById(tenantId);
  // The platform "Email sending" switch holds the email rows exactly as they
  // are, kept out of the batch so they cannot crowd the WhatsApp rows out.
  const emailHeld = isStopped("email");
  const due = tdb
    .select()
    .from(schema.automationQueue)
    .where(
      and(
        eq(schema.automationQueue.status, "queued"),
        lte(schema.automationQueue.dueAt, new Date(now)),
        ...(emailHeld ? [ne(schema.automationQueue.channel, "email")] : []),
      ),
    )
    .orderBy(asc(schema.automationQueue.dueAt))
    .limit(BATCH)
    .all();
  if (due.length === 0) return 0;

  // A lead that has been deleted, or has since said no, is not written to.
  const leadIds = [...new Set(due.map((d) => d.leadId).filter((id): id is number => id != null))];
  const leadRows = leadIds.length
    ? tdb.select({ id: schema.leads.id, status: schema.leads.status }).from(schema.leads).where(inArray(schema.leads.id, leadIds)).all()
    : [];
  const leadStatus = new Map(leadRows.map((l) => [l.id, l.status]));

  // Imported runs (lib/ghlImport) only send while their flow is switched on.
  const runIds = [...new Set(due.map((d) => d.runId).filter((id): id is number => id != null))];
  const importedRuns = new Set(
    runIds.length
      ? tdb
          .select({ id: schema.leadFlowRuns.id })
          .from(schema.leadFlowRuns)
          .where(and(inArray(schema.leadFlowRuns.id, runIds), eq(schema.leadFlowRuns.source, IMPORTED_RUN_SOURCE)))
          .all()
          .map((r) => r.id)
      : [],
  );
  const triggerStates = new Map(tdb.select().from(schema.automationTriggers).all().map((t) => [t.key, t]));

  let resolvedBase = baseUrl;
  if (!resolvedBase) {
    try {
      resolvedBase = getAppBaseUrl();
    } catch {
      resolvedBase = "http://localhost:3000";
    }
  }
  const ctx: DispatchContext = {
    tenantId,
    tdb,
    now,
    baseUrl: resolvedBase.replace(/\/+$/, ""),
    settings: getLeadFlowSettingsForTenant(tenantId),
    businessName: getBusinessProfileForTenant(tenantId).businessName,
    accent: getThemeForTenant(tenantId).accent,
  };

  let sent = 0;
  for (const batchItem of due) {
    // The batch is a snapshot and every handler awaits: an earlier row of this
    // pass (an undelivered first WhatsApp switching the rest to email), a
    // reply or a person's move may have changed this row since. Re-read it and
    // handle only a row that is still queued, as it is now.
    const item = tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.id, batchItem.id)).get();
    if (!item || item.status !== "queued" || item.dueAt.getTime() > now) continue;
    if (item.leadId != null) {
      const status = leadStatus.get(item.leadId);
      if (status === undefined || status === "lost") {
        markRow(tdb, item.id, { status: "cancelled", error: status === undefined ? "Lead no longer exists." : "Lead marked lost." });
        if (item.runId != null) closeRunIfDone(tdb, item.runId, now);
        continue;
      }
    }
    if (item.runId != null && importedRuns.has(item.runId) && !isTriggerEnabled(item.triggerKey, triggerStates.get(item.triggerKey))) {
      // Waits, untouched, until the flow is switched on (lib/leadFlows/importedRuns.ts releaseHeldImportRows).
      markRow(tdb, item.id, { status: "held" });
      continue;
    }
    const handler = HANDLERS[item.kind] ?? unknownRow;
    try {
      if (await handler(ctx, item)) sent++;
    } catch (err) {
      console.error(`[lead flows] tenant ${tenantId} row ${item.id} failed:`, err);
      markRow(tdb, item.id, { status: "failed", error: err instanceof Error ? err.message.slice(0, 300) : "Failed." });
    }
    if (item.runId != null) closeRunIfDone(tdb, item.runId, now);
  }
  return sent;
}
