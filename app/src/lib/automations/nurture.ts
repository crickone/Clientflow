import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { Lead } from "@/lib/db/schema";
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

// The dispatch lives with the engine now.
export { dispatchDueAutomationQueue } from "@/lib/leadFlows/dispatch";
