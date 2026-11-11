import "server-only";

import { and, asc, eq, inArray, lte } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getTenantDbById } from "@/lib/db/tenant";
import type { Lead } from "@/lib/db/schema";
import {
  DEFAULT_MESSAGES,
  TRIGGER_LABELS,
  applyShortcodes,
  delayToMs,
  inSendingHours,
  isMessageLive,
  type Channel,
} from "@/lib/automationModel";
import { getBusinessProfile, getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getThemeForTenant } from "@/lib/settings";
import { renderEmailShell, sendEmailForTenant, textToParagraphs } from "@/lib/email";

/**
 * The campaign nurture sequence: one follow-up series, every campaign.
 *
 * A lead that arrives on a campaign is ENROLLED here at creation
 * (leads.upsertLead): each message of the "campaign_signup" trigger is
 * rendered for that person there and then, and parked in automation_queue
 * with the time it is due -- now for the first, now plus its delay for the
 * rest. The dispatch ticker (lib/dispatch/ticker.ts) sends whatever is due,
 * one tenant at a time, and writes the outcome to automation_log, the same
 * log an immediate automation writes to, so the Sent view shows both.
 *
 * Rendering at enrolment rather than at send time is deliberate: the message
 * the operator approved is the message that goes, even if they edit the
 * sequence next week. Editing changes future enrolments, not people already
 * in the funnel.
 *
 * The trigger is ON unless the operator has switched it off. Every other
 * trigger is off until switched on, but this one exists because the operator
 * asked for a sequence that runs for every campaign -- a nurture that had to
 * be discovered and enabled first would not be that.
 */
export const NURTURE_TRIGGER_KEY = "campaign_signup";

/** Triggers that are on by default (no automation_triggers row yet). */
export const DEFAULT_ENABLED_TRIGGERS: ReadonlySet<string> = new Set([NURTURE_TRIGGER_KEY]);

export function isTriggerEnabled(key: string, state: { enabled: boolean } | undefined | null): boolean {
  if (state) return state.enabled;
  return DEFAULT_ENABLED_TRIGGERS.has(key);
}

interface QueuedMessage {
  channel: Channel;
  subject: string | null;
  template: string;
  delayValue: number;
  delayUnit: "minutes" | "hours" | "days";
}

function sequenceMessages(triggerKey: string): QueuedMessage[] {
  const saved = db
    .select()
    .from(schema.automationMessages)
    .where(eq(schema.automationMessages.triggerKey, triggerKey))
    .orderBy(asc(schema.automationMessages.position))
    .all();
  const messages: QueuedMessage[] =
    saved.length > 0
      ? saved.map((m) => ({
          channel: m.channel as Channel,
          subject: m.subject,
          template: m.template ?? "",
          delayValue: m.delayValue,
          delayUnit: m.delayUnit,
        }))
      : (DEFAULT_MESSAGES[triggerKey] ?? []).map((m) => ({
          channel: m.channel,
          subject: m.subject,
          template: m.template,
          delayValue: m.delayValue,
          delayUnit: m.delayUnit,
        }));
  return messages.filter((m) => isMessageLive(m, triggerKey) && m.template.trim());
}

/** Whether a sequence is switched on for the ambient tenant (campaign sign-up is on unless switched off). */
export function sequenceEnabled(triggerKey: string): boolean {
  const state = db
    .select({ enabled: schema.automationTriggers.enabled })
    .from(schema.automationTriggers)
    .where(eq(schema.automationTriggers.key, triggerKey))
    .get();
  return isTriggerEnabled(triggerKey, state);
}

/**
 * Queue a sequence for one lead. Runs in the ambient tenant. Nothing is sent
 * here. Each message goes by its own channel: an email needs an email
 * address, a WhatsApp a phone number; a message the lead cannot receive is
 * skipped, the rest still go. A lead already in this sequence is not
 * enrolled twice (moving to booked, out and back, does not double the
 * reminders).
 */
export function enrolLeadInSequence(
  lead: Pick<Lead, "id" | "firstName" | "lastName" | "email" | "phone">,
  triggerKey: string,
  extra: { offerName?: string | null; offerLink?: string | null } = {},
): number {
  if (!sequenceEnabled(triggerKey)) return 0;
  const already = db
    .select({ id: schema.automationQueue.id })
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.leadId, lead.id), eq(schema.automationQueue.triggerKey, triggerKey), eq(schema.automationQueue.status, "queued")))
    .get();
  if (already) return 0;

  const messages = sequenceMessages(triggerKey);
  if (messages.length === 0) return 0;

  const businessName = getBusinessProfile().businessName;
  const vars = { firstName: lead.firstName, lastName: lead.lastName, businessName, ...extra };
  const now = Date.now();
  let queued = 0;
  for (const m of messages) {
    const sendTo = m.channel === "whatsapp" ? lead.phone : lead.email;
    if (!sendTo) continue;
    const subject = m.channel === "email" ? applyShortcodes((m.subject ?? "").trim() || `A message from ${businessName}`, vars) : null;
    const body = applyShortcodes(m.template, vars);
    db.insert(schema.automationQueue)
      .values({
        triggerKey,
        leadId: lead.id,
        channel: m.channel,
        subject,
        body,
        sendTo,
        dueAt: new Date(inSendingHours(now + delayToMs(m.delayValue, m.delayUnit), m.channel)),
      })
      .run();
    queued++;
  }
  return queued;
}

/** The campaign sign-up sequence (kept for its callers). */
export function enrolLeadInNurture(lead: Pick<Lead, "id" | "firstName" | "lastName" | "email" | "phone" | "campaign">): number {
  return enrolLeadInSequence(lead, NURTURE_TRIGGER_KEY);
}

/** Stop what is still queued for a lead in the named sequences only. */
export function cancelSequences(leadId: number, triggerKeys: readonly string[]): number {
  if (triggerKeys.length === 0) return 0;
  return db
    .update(schema.automationQueue)
    .set({ status: "cancelled" })
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"), inArray(schema.automationQueue.triggerKey, [...triggerKeys])))
    .run().changes;
}

/**
 * Stop what is still queued for a lead. Called when the lead is won or lost:
 * a customer does not need "still thinking it over?", and someone who said
 * no does not need anything.
 */
export function cancelNurtureForLead(leadId: number): number {
  const result = db
    .update(schema.automationQueue)
    .set({ status: "cancelled" })
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued")))
    .run();
  return result.changes;
}

/** Queued messages for a lead, soonest first -- for the lead's detail view. */
export function listQueuedForLead(leadId: number) {
  return db
    .select()
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued")))
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
  const due = tdb
    .select()
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.status, "queued"), lte(schema.automationQueue.dueAt, new Date(now))))
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
