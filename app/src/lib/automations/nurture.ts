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

function sequenceMessages(): QueuedMessage[] {
  const saved = db
    .select()
    .from(schema.automationMessages)
    .where(eq(schema.automationMessages.triggerKey, NURTURE_TRIGGER_KEY))
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
      : (DEFAULT_MESSAGES[NURTURE_TRIGGER_KEY] ?? []).map((m) => ({
          channel: m.channel,
          subject: m.subject,
          template: m.template,
          delayValue: m.delayValue,
          delayUnit: m.delayUnit,
        }));
  return messages.filter((m) => isMessageLive(m, NURTURE_TRIGGER_KEY) && m.template.trim());
}

/**
 * Queue the sequence for one lead. Runs in the ambient tenant (the lead was
 * just created there). Nothing is sent here; nothing is queued for a lead
 * with no email address, since email is the one live channel.
 */
export function enrolLeadInNurture(lead: Pick<Lead, "id" | "firstName" | "lastName" | "email" | "campaign">): number {
  const state = db
    .select({ enabled: schema.automationTriggers.enabled })
    .from(schema.automationTriggers)
    .where(eq(schema.automationTriggers.key, NURTURE_TRIGGER_KEY))
    .get();
  if (!isTriggerEnabled(NURTURE_TRIGGER_KEY, state)) return 0;
  if (!lead.email) return 0;

  const messages = sequenceMessages();
  if (messages.length === 0) return 0;

  const businessName = getBusinessProfile().businessName;
  const vars = { firstName: lead.firstName, lastName: lead.lastName, businessName };
  const now = Date.now();
  let queued = 0;
  for (const m of messages) {
    const subject = applyShortcodes((m.subject ?? "").trim() || `A message from ${businessName}`, vars);
    const body = applyShortcodes(m.template, vars);
    db.insert(schema.automationQueue)
      .values({
        triggerKey: NURTURE_TRIGGER_KEY,
        leadId: lead.id,
        channel: m.channel,
        subject,
        body,
        sendTo: lead.email,
        dueAt: new Date(now + delayToMs(m.delayValue, m.delayUnit)),
      })
      .run();
    queued++;
  }
  return queued;
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
  const label = TRIGGER_LABELS[NURTURE_TRIGGER_KEY] ?? NURTURE_TRIGGER_KEY;
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
    if (item.channel !== "email" || !item.sendTo) {
      tdb.update(schema.automationQueue)
        .set({ status: "failed", error: item.channel !== "email" ? "Only email sends today." : "No email address." })
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
