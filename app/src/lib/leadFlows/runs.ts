import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { LeadFlowRun } from "@/lib/db/schema";
import { applyShortcodes, TRIGGER_LABELS } from "@/lib/automationModel";
import { getBusinessProfile } from "@/lib/businessProfile";

import { formatCallDay, formatCallTime, scheduleCallMessages } from "./callPlan";
import { flowNow } from "./clock";
import { getFlowDefinition } from "./definitions";
import { CALL_ALERT_KEY, CALL_BOOKED_FLOW, LEAD_FLOW_KEYS, LEAD_FLOW_KEY_SET } from "./flowModel";
import { cascadeDueTimes, finishDueAt, pickForInterest, type FlowScope } from "./flowPlan";
import { fitToWindow } from "./sendingWindow";
import { getLeadFlowSettings } from "./settings";

/**
 * Lead flow runs: starting one lead on one flow, and stopping flows. All in
 * the ambient tenant (a request, or a runWithTenant binding).
 *
 * Starting renders every message for that person there and then and parks
 * it in automation_queue with the time it is due, the way the campaign
 * nurture always has: the wording the operator approved is the wording that
 * goes, even if they edit the flow next week. Starting any flow stops every
 * other flow the lead is in, including an earlier run of the same one, so
 * re-entering a column restarts its flow.
 */

export interface StartFlowOptions {
  /** Skip when this flow is already running for the lead (enrolment at intake). */
  ifNotActive?: boolean;
  /** The first message's time, replacing its delay (the morning after a picked call-back day). */
  firstAt?: number;
  /** lead_call_booked only: when the call is. */
  callAt?: number;
  /** The checkout sequence's [OFFER_NAME] and [OFFER_LINK]. */
  extra?: { offerName?: string | null; offerLink?: string | null };
  now?: number;
}

export interface StartFlowResult {
  runId: number | null;
  /** Messages queued for the lead. */
  queued: number;
  /** Why nothing started, or null. */
  skipped: string | null;
}

function keysIn(scope: FlowScope): string[] {
  if (scope === "all") return [...LEAD_FLOW_KEYS];
  if ("only" in scope) return scope.only.filter((k) => LEAD_FLOW_KEY_SET.has(k));
  return LEAD_FLOW_KEYS.filter((k) => !scope.except.includes(k));
}

/** Stop a lead's flows in scope: their runs end and whatever they still had queued is cancelled. Returns the runs stopped. */
export function stopFlows(leadId: number, reason: string, scope: FlowScope = "all"): number {
  const keys = keysIn(scope);
  if (keys.length === 0) return 0;
  const runs = db
    .select({ id: schema.leadFlowRuns.id })
    .from(schema.leadFlowRuns)
    .where(and(eq(schema.leadFlowRuns.leadId, leadId), eq(schema.leadFlowRuns.status, "active"), inArray(schema.leadFlowRuns.triggerKey, keys)))
    .all();
  if (runs.length > 0) {
    db.update(schema.leadFlowRuns)
      .set({ status: "stopped", stopReason: reason.slice(0, 200), endedAt: new Date(flowNow()) })
      .where(inArray(schema.leadFlowRuns.id, runs.map((r) => r.id)))
      .run();
  }
  // The runs' rows, and rows queued before runs existed (no run id), for the same flows.
  db.update(schema.automationQueue)
    .set({ status: "cancelled", error: `Stopped: ${reason}`.slice(0, 300) })
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"), inArray(schema.automationQueue.triggerKey, keys)))
    .run();
  return runs.length;
}

/** Drop a scheduled call's staff alerts and call-back check. */
export function cancelCallRows(leadId: number, reason: string): number {
  return db
    .update(schema.automationQueue)
    .set({ status: "cancelled", error: `Stopped: ${reason}`.slice(0, 300) })
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"), eq(schema.automationQueue.triggerKey, CALL_ALERT_KEY)))
    .run().changes;
}

export function activeRun(leadId: number, triggerKey: string): LeadFlowRun | null {
  return (
    db
      .select()
      .from(schema.leadFlowRuns)
      .where(and(eq(schema.leadFlowRuns.leadId, leadId), eq(schema.leadFlowRuns.triggerKey, triggerKey), eq(schema.leadFlowRuns.status, "active")))
      .orderBy(desc(schema.leadFlowRuns.id))
      .get() ?? null
  );
}

function alreadyRunning(leadId: number, triggerKey: string): boolean {
  if (activeRun(leadId, triggerKey)) return true;
  return !!db
    .select({ id: schema.automationQueue.id })
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.triggerKey, triggerKey), eq(schema.automationQueue.status, "queued")))
    .get();
}

/** Put a lead on a flow. Nothing is sent here; the dispatch ticker sends what is due. */
export function startFlow(leadId: number, triggerKey: string, opts: StartFlowOptions = {}): StartFlowResult {
  const now = opts.now ?? flowNow();
  const skip = (why: string): StartFlowResult => ({ runId: null, queued: 0, skipped: why });
  if (!LEAD_FLOW_KEY_SET.has(triggerKey)) return skip("not a lead flow");
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!lead) return skip("no such lead");
  const def = getFlowDefinition(triggerKey);
  if (!def.enabled) return skip("switched off");
  if (opts.ifNotActive && alreadyRunning(leadId, triggerKey)) return skip("already running");
  if (triggerKey === CALL_BOOKED_FLOW && opts.callAt == null) return skip("no call time");

  stopFlows(leadId, `${def.label} started`, "all");

  const { window } = getLeadFlowSettings();
  const profile = getBusinessProfile();
  const picked = pickForInterest(def.messages, lead.therapyInterest);
  const delays = picked.map((m) => m.delayMs);
  const fit = (at: number, i: number) => fitToWindow(at, picked[i].channel, window);
  const dues: (number | null)[] =
    triggerKey === CALL_BOOKED_FLOW
      ? scheduleCallMessages({ now, callAt: opts.callAt!, delaysMs: delays, fit })
      : cascadeDueTimes(now, delays, fit, opts.firstAt);

  const vars = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    businessName: profile.businessName,
    businessPhone: profile.phone ?? "",
    ...opts.extra,
    ...(opts.callAt != null ? { callDay: formatCallDay(opts.callAt), callTime: formatCallTime(opts.callAt) } : {}),
  };

  const rows: (typeof schema.automationQueue.$inferInsert)[] = [];
  picked.forEach((m, i) => {
    const due = dues[i];
    if (due == null) return;
    let channel = m.channel;
    let subject = m.subject;
    let sendTo = channel === "whatsapp" ? lead.phone : lead.email;
    // A booked call with no phone on file: the confirmation and reminder go by email.
    if (!sendTo && channel === "whatsapp" && triggerKey === CALL_BOOKED_FLOW && lead.email) {
      channel = "email";
      sendTo = lead.email;
      subject = `Your call with ${profile.businessName}`;
    }
    // A message the lead has no address for is skipped; the rest still go.
    if (!sendTo) return;
    rows.push({
      triggerKey,
      leadId,
      kind: "message",
      step: i,
      channel,
      sendTo,
      subject: channel === "email" ? applyShortcodes((subject ?? "").trim() || `A message from ${profile.businessName}`, vars) : null,
      body: applyShortcodes(m.template, vars),
      dueAt: new Date(due),
      payload: triggerKey === CALL_BOOKED_FLOW && i > 0 ? JSON.stringify({ notAfter: opts.callAt }) : null,
    });
  });
  const finishAt = def.finish && triggerKey !== CALL_BOOKED_FLOW ? finishDueAt(opts.firstAt ?? now, dues, delays, def.finish.afterMs) : null;
  if (rows.length === 0 && finishAt == null) return skip("nothing this lead can receive");

  const runId = db
    .insert(schema.leadFlowRuns)
    .values({ leadId, triggerKey, status: "active", startedAt: new Date(now) })
    .returning({ id: schema.leadFlowRuns.id })
    .get().id;
  for (const r of rows) db.insert(schema.automationQueue).values({ ...r, runId }).run();
  if (finishAt != null && def.finish) {
    db.insert(schema.automationQueue)
      .values({
        triggerKey,
        leadId,
        runId,
        kind: "move",
        channel: "chat",
        body: `Move to ${def.finish.column}`,
        dueAt: new Date(finishAt),
        payload: JSON.stringify({ column: def.finish.column }),
      })
      .run();
  }
  return { runId, queued: rows.length, skipped: null };
}

/** For the lead page: the flow the lead is in and its next few messages. */
export function leadFlowStatus(leadId: number): { flow: string | null; next: { channel: string; dueAt: number }[] } {
  const run = db
    .select()
    .from(schema.leadFlowRuns)
    .where(and(eq(schema.leadFlowRuns.leadId, leadId), eq(schema.leadFlowRuns.status, "active")))
    .orderBy(desc(schema.leadFlowRuns.id))
    .get();
  const next = db
    .select({ channel: schema.automationQueue.channel, dueAt: schema.automationQueue.dueAt })
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"), eq(schema.automationQueue.kind, "message")))
    .orderBy(asc(schema.automationQueue.dueAt))
    .limit(3)
    .all()
    .map((r) => ({ channel: r.channel, dueAt: r.dueAt.getTime() }));
  return { flow: run ? (TRIGGER_LABELS[run.triggerKey] ?? run.triggerKey) : null, next };
}
