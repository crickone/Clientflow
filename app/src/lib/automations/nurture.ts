import "server-only";

import { and, asc, eq, inArray, lte, ne } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getTenantDbById } from "@/lib/db/tenant";
import type { Lead } from "@/lib/db/schema";
import { TRIGGER_LABELS, inSendingHours } from "@/lib/automationModel";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getThemeForTenant } from "@/lib/settings";
import { renderEmailShell, sendEmailForTenant, textToParagraphs } from "@/lib/email";
import { isStopped } from "@/lib/platform/killSwitch";
import { isTriggerEnabled } from "@/lib/leadFlows/flowModel";
import { startFlow, stopFlows } from "@/lib/leadFlows/runs";

/**
 * The lead follow-up sequences, kept under their old names for their
 * callers (leads.upsertLead, offers/fulfil, lib/automations, the ticker).
 * The engine is lib/leadFlows: runs.ts starts and stops flows,
 * definitions.ts says what a flow is in this business.
 *
 * The campaign sign-up sequence is ON unless the operator has switched it
 * off; every other flow is off until switched on.
 */
export const NURTURE_TRIGGER_KEY = "campaign_signup";

// Which triggers are on with no saved row lives with the flow vocabulary now.
export { DEFAULT_ENABLED_TRIGGERS, isTriggerEnabled } from "@/lib/leadFlows/flowModel";

/** Whether a sequence is switched on for the ambient tenant (campaign sign-up is on unless switched off). */
export function sequenceEnabled(triggerKey: string): boolean {
  const state = db
    .select({ enabled: schema.automationTriggers.enabled })
    .from(schema.automationTriggers)
    .where(eq(schema.automationTriggers.key, triggerKey))
    .get();
  return isTriggerEnabled(triggerKey, state);
}

/** Put a lead on a sequence unless it is already on it. Returns how many messages were queued. */
export function enrolLeadInSequence(
  lead: Pick<Lead, "id">,
  triggerKey: string,
  extra: { offerName?: string | null; offerLink?: string | null } = {},
): number {
  return startFlow(lead.id, triggerKey, { ifNotActive: true, extra }).queued;
}

/** The campaign sign-up sequence (kept for its callers). */
export function enrolLeadInNurture(lead: Pick<Lead, "id">): number {
  return enrolLeadInSequence(lead, NURTURE_TRIGGER_KEY);
}

/** Stop the named sequences for a lead. Returns the runs stopped. */
export function cancelSequences(leadId: number, triggerKeys: readonly string[]): number {
  if (triggerKeys.length === 0) return 0;
  return stopFlows(leadId, "stopped", { only: triggerKeys });
}

/** Stop every sequence for a lead (won or lost). */
export function cancelNurtureForLead(leadId: number): number {
  return stopFlows(leadId, "won or lost", "all");
}

/** Queued messages for a lead, soonest first -- for the lead's detail view. */
export function listQueuedForLead(leadId: number) {
  return db
    .select()
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"), eq(schema.automationQueue.kind, "message")))
    .orderBy(asc(schema.automationQueue.dueAt))
    .all();
}

const BATCH = 25;

/**
 * Send every due message for one tenant. Explicit-tenant reads and sends
 * (getTenantDbById, sendEmailForTenant), because the ticker has no request
 * to be scoped by. Returns how many were sent.
 */
export async function dispatchDueAutomationQueue(tenantId: number, now: number = Date.now()): Promise<number> {
  const tdb = getTenantDbById(tenantId);
  // The platform "Email sending" switch holds the nurture sequence too. A
  // held email row is left exactly as it is (still queued, no attempt, no
  // error) so it goes on the first tick after sending is started again. The
  // email rows are kept out of the batch query rather than skipped in the
  // loop: otherwise 25 held emails at the front of the queue would crowd the
  // WhatsApp messages (which the switch does not cover) out of every batch.
  const emailHeld = isStopped("email");
  const due = tdb
    .select()
    .from(schema.automationQueue)
    .where(
      and(
        eq(schema.automationQueue.status, "queued"),
        eq(schema.automationQueue.kind, "message"),
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

  const businessName = getBusinessProfileForTenant(tenantId).businessName;
  const accent = getThemeForTenant(tenantId).accent;
  let sent = 0;

  for (const item of due) {
    if (item.leadId != null) {
      const status = leadStatus.get(item.leadId);
      if (status === undefined || status === "lost") {
        tdb.update(schema.automationQueue)
          .set({ status: "cancelled", error: status === undefined ? "Lead no longer exists." : "Lead marked lost." })
          .where(eq(schema.automationQueue.id, item.id))
          .run();
        continue;
      }
    }
    const label = TRIGGER_LABELS[item.triggerKey] ?? item.triggerKey;

    // WhatsApp: within sending hours (it may have become due overnight),
    // through the business's own WhatsApp connection, recorded on the
    // lead's conversation like a reply typed in the inbox.
    if (item.channel === "whatsapp") {
      const allowed = inSendingHours(now, "whatsapp");
      if (allowed > now) {
        tdb.update(schema.automationQueue).set({ dueAt: new Date(allowed) }).where(eq(schema.automationQueue.id, item.id)).run();
        continue;
      }
      let error: string | null = null;
      if (item.leadId == null) error = "No lead to send to.";
      else {
        try {
          // Loaded here: whatsapp/send imports leads, which imports this module.
          const { sendWhatsApp } = await import("@/lib/whatsapp/send");
          await sendWhatsApp({ subjectType: "lead", subjectId: item.leadId, text: item.body });
        } catch (err) {
          error = err instanceof Error ? err.message : "WhatsApp send failed.";
        }
      }
      tdb.update(schema.automationQueue)
        .set({ status: error ? "failed" : "sent", error, sentAt: new Date() })
        .where(eq(schema.automationQueue.id, item.id))
        .run();
      tdb.insert(schema.automationLog)
        .values({ triggerKey: item.triggerKey, triggerName: label, channel: "whatsapp", subject: null, sentTo: item.sendTo, status: error ? "failed" : "sent", sentAt: new Date() })
        .run();
      if (error) console.error(`[automations] tenant ${tenantId} WhatsApp follow-up ${item.id} failed: ${error}`);
      else sent++;
      continue;
    }

    // Stopped between the batch query and this row: hold it, untouched.
    if (item.channel === "email" && isStopped("email")) continue;

    if (item.channel !== "email" || !item.sendTo) {
      tdb.update(schema.automationQueue)
        .set({ status: "failed", error: item.channel !== "email" ? "This channel does not send." : "No email address." })
        .where(eq(schema.automationQueue.id, item.id))
        .run();
      continue;
    }

    const subject = item.subject || `A message from ${businessName}`;
    const html = renderEmailShell({
      businessName,
      accent,
      bodyHtml: textToParagraphs(item.body),
      footer: `Sent by ${businessName}.`,
    });
    let ok = false;
    let error: string | null = null;
    try {
      const res = await sendEmailForTenant(tenantId, { to: item.sendTo, subject, html, text: item.body });
      ok = res.ok;
      if (!res.ok) error = "error" in res && typeof res.error === "string" ? res.error : "Send failed.";
    } catch (err) {
      error = err instanceof Error ? err.message : "Send failed.";
    }

    tdb.update(schema.automationQueue)
      .set({ status: ok ? "sent" : "failed", error, sentAt: new Date() })
      .where(eq(schema.automationQueue.id, item.id))
      .run();
    tdb.insert(schema.automationLog)
      .values({
        triggerKey: item.triggerKey,
        triggerName: label,
        channel: "email",
        subject,
        sentTo: item.sendTo,
        status: ok ? "sent" : "failed",
        sentAt: new Date(),
      })
      .run();
    if (ok) sent++;
  }
  return sent;
}
