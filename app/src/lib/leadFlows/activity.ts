import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { countRuns, runProgress, type ActivityCounts, type ActivityStep, type RunProgress, type RunStatus } from "./activityModel";

/**
 * Who has gone through one follow-up flow, read from lead_flow_runs (one row
 * per person per time they entered) and automation_queue (one row per step).
 * Read-only.
 */

export interface ActivityRow {
  runId: number;
  leadId: number;
  name: string;
  contact: string | null;
  startedAt: number;
  endedAt: number | null;
  status: RunStatus;
  stopReason: string | null;
  progress: RunProgress;
}

export function flowActivity(
  triggerKey: string,
  opts: { status?: RunStatus | "all"; limit?: number } = {},
): { counts: ActivityCounts; rows: ActivityRow[]; total: number } {
  const all = db
    .select({ id: schema.leadFlowRuns.id, status: schema.leadFlowRuns.status, stopReason: schema.leadFlowRuns.stopReason })
    .from(schema.leadFlowRuns)
    .where(eq(schema.leadFlowRuns.triggerKey, triggerKey))
    .all();
  const counts = countRuns(all.map((r) => ({ status: r.status as RunStatus, stopReason: r.stopReason })));

  const status = opts.status && opts.status !== "all" ? opts.status : null;
  const runs = db
    .select()
    .from(schema.leadFlowRuns)
    .where(status ? and(eq(schema.leadFlowRuns.triggerKey, triggerKey), eq(schema.leadFlowRuns.status, status)) : eq(schema.leadFlowRuns.triggerKey, triggerKey))
    .orderBy(desc(schema.leadFlowRuns.startedAt))
    .limit(opts.limit ?? 200)
    .all();
  const total = status ? all.filter((r) => r.status === status).length : all.length;
  if (runs.length === 0) return { counts, rows: [], total };

  const leadIds = [...new Set(runs.map((r) => r.leadId))];
  const leads = new Map(
    db
      .select({ id: schema.leads.id, firstName: schema.leads.firstName, lastName: schema.leads.lastName, phone: schema.leads.phone, email: schema.leads.email })
      .from(schema.leads)
      .where(inArray(schema.leads.id, leadIds))
      .all()
      .map((l) => [l.id, l]),
  );
  const steps = db
    .select({
      runId: schema.automationQueue.runId,
      kind: schema.automationQueue.kind,
      channel: schema.automationQueue.channel,
      status: schema.automationQueue.status,
      dueAt: schema.automationQueue.dueAt,
      sentAt: schema.automationQueue.sentAt,
    })
    .from(schema.automationQueue)
    .where(inArray(schema.automationQueue.runId, runs.map((r) => r.id)))
    .all();
  const byRun = new Map<number, ActivityStep[]>();
  for (const s of steps) {
    if (s.runId == null) continue;
    const list = byRun.get(s.runId) ?? [];
    list.push({ kind: s.kind, channel: s.channel, status: s.status, dueAt: s.dueAt.getTime(), sentAt: s.sentAt ? s.sentAt.getTime() : null });
    byRun.set(s.runId, list);
  }

  const rows = runs.map((r) => {
    const l = leads.get(r.leadId);
    const name = [l?.firstName, l?.lastName].filter(Boolean).join(" ").trim() || "Anonymous";
    return {
      runId: r.id,
      leadId: r.leadId,
      name,
      contact: l?.phone || l?.email || null,
      startedAt: r.startedAt.getTime(),
      endedAt: r.endedAt ? r.endedAt.getTime() : null,
      status: r.status as RunStatus,
      stopReason: r.stopReason,
      progress: runProgress(byRun.get(r.id) ?? []),
    };
  });
  return { counts, rows, total };
}

export interface TimelineStep {
  id: number;
  step: number | null;
  kind: string;
  channel: string;
  subject: string | null;
  body: string;
  sendTo: string | null;
  status: "queued" | "sent" | "failed" | "cancelled" | "held";
  dueAt: number;
  sentAt: number | null;
  error: string | null;
}

/** One person's run, step by step, for the run page. Null when it isn't this flow's. */
export function runTimeline(triggerKey: string, runId: number) {
  const run = db
    .select()
    .from(schema.leadFlowRuns)
    .where(and(eq(schema.leadFlowRuns.id, runId), eq(schema.leadFlowRuns.triggerKey, triggerKey)))
    .get();
  if (!run) return null;
  const lead = db
    .select({ id: schema.leads.id, firstName: schema.leads.firstName, lastName: schema.leads.lastName, phone: schema.leads.phone, email: schema.leads.email })
    .from(schema.leads)
    .where(eq(schema.leads.id, run.leadId))
    .get();
  const steps: TimelineStep[] = db
    .select()
    .from(schema.automationQueue)
    .where(eq(schema.automationQueue.runId, runId))
    .orderBy(asc(schema.automationQueue.dueAt), asc(schema.automationQueue.id))
    .all()
    .map((s) => ({
      id: s.id,
      step: s.step ?? null,
      kind: s.kind,
      channel: s.channel,
      subject: s.subject ?? null,
      body: s.body,
      sendTo: s.sendTo ?? null,
      status: s.status,
      dueAt: s.dueAt.getTime(),
      sentAt: s.sentAt ? s.sentAt.getTime() : null,
      error: s.error ?? null,
    }));
  return {
    run: { ...run, startedAt: run.startedAt.getTime(), endedAt: run.endedAt ? run.endedAt.getTime() : null },
    lead: lead
      ? { id: lead.id, name: [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || "Anonymous", contact: lead.phone || lead.email || null }
      : null,
    steps,
  };
}
