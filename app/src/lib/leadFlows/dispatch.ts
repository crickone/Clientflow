import "server-only";

import { and, asc, eq, inArray, lte, ne, sql } from "drizzle-orm";

import { schema } from "@/lib/db";
import { getTenantDbById, runWithTenant, type TenantDb } from "@/lib/db/tenant";
import type { AutomationQueueRow } from "@/lib/db/schema";
import { TRIGGER_LABELS } from "@/lib/automationModel";
import { getAppBaseUrl } from "@/lib/appUrl";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { escapeHtml, renderEmailShell, textToParagraphs } from "@/lib/email";
import { isStopped } from "@/lib/platform/killSwitch";
import { getThemeForTenant } from "@/lib/settings";

import { flowNow } from "./clock";
import { unsubscribeUrl } from "./consent";
import { NURTURE_FLOW, parsePayload, resolveColumn } from "./flowModel";
import { fitToWindow } from "./sendingWindow";
import { getLeadFlowSettingsForTenant } from "./settings";
import type { LeadFlowSettings } from "./settingsModel";
import { getFlowTransport } from "./transport";

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
  patch: { status: "queued" | "sent" | "failed" | "cancelled"; error?: string | null; sentAt?: Date | null; providerMessageId?: string | null },
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
  if (item.leadId == null) error = "No lead to send to.";
  else if (!transport.whatsAppConnected()) error = WHATSAPP_NOT_CONNECTED;
  else {
    try {
      providerMessageId = (await transport.sendWhatsAppToLead(item.leadId, item.body)).providerMessageId;
    } catch (err) {
      error = err instanceof Error ? err.message : "WhatsApp send failed.";
    }
  }
  markRow(ctx.tdb, item.id, { status: error ? "failed" : "sent", error, sentAt: new Date(ctx.now), providerMessageId });
  logSend(ctx, item, "whatsapp", null, item.sendTo, error);
  if (error) console.error(`[lead flows] tenant ${ctx.tenantId} WhatsApp ${item.id} failed: ${error}`);
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
  // Sending hours: a row that became due outside them waits for the next window.
  const allowed = fitToWindow(ctx.now, item.channel, ctx.settings.window);
  if (allowed > ctx.now) {
    const notAfter = parsePayload(item.payload).notAfter;
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

async function unknownRow(ctx: DispatchContext, item: AutomationQueueRow): Promise<boolean> {
  markRow(ctx.tdb, item.id, { status: "failed", error: "Unknown queue row." });
  return false;
}

/** What each kind of row does when it is due. */
const HANDLERS: Record<string, RowHandler> = {
  message: sendMessageRow,
  move: runMoveRow,
};

function closeRunIfDone(tdb: TenantDb, runId: number, now: number): void {
  const left = tdb
    .select({ id: schema.automationQueue.id })
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.runId, runId), eq(schema.automationQueue.status, "queued")))
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
  for (const item of due) {
    if (item.leadId != null) {
      const status = leadStatus.get(item.leadId);
      if (status === undefined || status === "lost") {
        markRow(tdb, item.id, { status: "cancelled", error: status === undefined ? "Lead no longer exists." : "Lead marked lost." });
        if (item.runId != null) closeRunIfDone(tdb, item.runId, now);
        continue;
      }
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
