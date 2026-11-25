import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";

import { flowNow } from "./clock";
import { getFlowDefinition } from "./definitions";
import { CALL_BOOKED_FLOW, IMPORTED_RUN_SOURCE, LEAD_FLOW_KEY_SET, NURTURE_FLOW, PENDING_STATUSES } from "./flowModel";
import { pickForInterest } from "./flowPlan";
import { planRelease } from "./heldRows";
import { messageRow, messageVars, stopFlows } from "./runs";
import { todayIn } from "./sendingWindow";
import { flowTenant } from "./tenant";

/**
 * Runs placed by the GoHighLevel import (lib/ghlImport), part-way through.
 * Unlike startFlow, the steps and their times come worked out by the
 * importer (lib/ghlImport/placement.ts): steps GoHighLevel already sent, and
 * any whose time has passed, are left out. While the flow is off the rows
 * are "held": they wait, and are released, past steps skipped, when it is
 * switched on. Nothing is sent here. Ambient tenant.
 */

export interface ImportedRunPlan {
  triggerKey: string;
  /** Indexes into the lead's picked messages (pickForInterest on the lead's interest), with their times. */
  steps: { step: number; dueAt: number }[];
  /** The finish move's time, or null. */
  finishAt: number | null;
  /** WhatsApp steps go by email (Message undelivered). */
  emailOnly: boolean;
}

export interface ImportedRunResult {
  runId: number | null;
  queued: number;
  /** The flow is off: the rows wait. */
  held: boolean;
  skipped: string | null;
}

export const SKIPPED_WHILE_OFF = "Skipped: its time passed while the follow-up was off.";

export function placeImportedRun(leadId: number, plan: ImportedRunPlan, now: number = flowNow()): ImportedRunResult {
  const skip = (why: string): ImportedRunResult => ({ runId: null, queued: 0, held: false, skipped: why });
  if (!LEAD_FLOW_KEY_SET.has(plan.triggerKey)) return skip("not a lead flow");
  if (plan.triggerKey === CALL_BOOKED_FLOW) return skip("a booked call is not imported");
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return skip("no such lead");
  if (lead.doNotContact) return skip("do not contact");
  if (plan.triggerKey === NURTURE_FLOW && lead.marketingConsentAt == null) return skip("no marketing consent");
  const tenant = flowTenant();
  if (!tenant) return skip("no business");

  const def = getFlowDefinition(plan.triggerKey);
  const profile = getBusinessProfileForTenant(tenant.id);
  const picked = pickForInterest(def.messages, lead.therapyInterest);
  const vars = messageVars(lead, profile);
  const status = def.enabled ? "queued" : "held";

  const rows: (typeof schema.automationQueue.$inferInsert)[] = [];
  for (const s of plan.steps) {
    const m = picked[s.step];
    if (!m) continue;
    let channel = m.channel;
    let subject = m.subject;
    if (plan.emailOnly && channel === "whatsapp") {
      channel = "email";
      subject = `A message from ${profile.businessName}`;
    }
    const sendTo = channel === "whatsapp" ? lead.phone : lead.email;
    if (!sendTo) continue;
    rows.push({
      ...messageRow({ triggerKey: plan.triggerKey, leadId, step: s.step, channel, sendTo, subject, template: m.template, dueAt: s.dueAt, vars, businessName: profile.businessName }),
      status,
    });
  }
  const finishAt = plan.finishAt != null && def.finish ? plan.finishAt : null;
  if (rows.length === 0 && finishAt == null) return skip("nothing this lead can receive");

  const runId = db.transaction((tx) => {
    stopFlows(leadId, `${def.label} placed by the GoHighLevel import`, "all");
    const id = tx
      .insert(schema.leadFlowRuns)
      .values({ leadId, triggerKey: plan.triggerKey, status: "active", startedAt: new Date(now), source: IMPORTED_RUN_SOURCE })
      .returning({ id: schema.leadFlowRuns.id })
      .get().id;
    for (const r of rows) tx.insert(schema.automationQueue).values({ ...r, runId: id }).run();
    if (finishAt != null && def.finish) {
      tx.insert(schema.automationQueue)
        .values({
          triggerKey: plan.triggerKey,
          leadId,
          runId: id,
          kind: "move",
          channel: "chat",
          body: `Move to ${def.finish.column}`,
          dueAt: new Date(finishAt),
          payload: JSON.stringify({ column: def.finish.column }),
          status,
        })
        .run();
    }
    return id;
  });
  return { runId, queued: rows.length, held: !def.enabled, skipped: null };
}

/** The flow was switched on: its held rows go, except messages whose time passed (planRelease). */
export function releaseHeldImportRows(triggerKey: string, now: number = flowNow()): { queued: number; skipped: number } {
  const q = schema.automationQueue;
  const held = db
    .select({ id: q.id, runId: q.runId, kind: q.kind, dueAt: q.dueAt })
    .from(q)
    .where(and(eq(q.triggerKey, triggerKey), eq(q.status, "held")))
    .all();
  if (held.length === 0) return { queued: 0, skipped: 0 };
  const plan = planRelease(held.map((r) => ({ ...r, dueAt: r.dueAt.getTime() })), now, (at) => todayIn(at));
  db.transaction((tx) => {
    if (plan.cancel.length) tx.update(q).set({ status: "cancelled", error: SKIPPED_WHILE_OFF }).where(inArray(q.id, plan.cancel)).run();
    for (const r of plan.queue) tx.update(q).set({ status: "queued", dueAt: new Date(r.dueAt) }).where(eq(q.id, r.id)).run();
    // A run left with nothing to do has finished.
    const runIds = [...new Set(held.map((r) => r.runId).filter((id): id is number => id != null))];
    for (const runId of runIds) {
      const left = tx.select({ id: q.id }).from(q).where(and(eq(q.runId, runId), inArray(q.status, [...PENDING_STATUSES]))).get();
      if (!left) {
        tx.update(schema.leadFlowRuns)
          .set({ status: "finished", endedAt: new Date(now) })
          .where(and(eq(schema.leadFlowRuns.id, runId), eq(schema.leadFlowRuns.status, "active")))
          .run();
      }
    }
  });
  return { queued: plan.queue.length, skipped: plan.cancel.length };
}
