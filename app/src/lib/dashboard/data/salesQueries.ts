import "server-only";

import { and, asc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { listLeadsForBoard } from "@/lib/leads";
import { slaTone, STALE_MS } from "@/lib/pipeline/boardMetrics";
import { defaultPipelineId, listPipelines } from "@/lib/pipeline/pipelineRepo";
import { WON_ROLES, type StageRole } from "@/lib/pipeline/roles";
import { bucketIndex, median, seriesBuckets, timeInStage, velocityDays, type StageEv } from "./stats";

const d = (ms: number) => new Date(ms);
const isWon = (role: string | null) => role != null && WON_ROLES.has(role as StageRole);

type StageRow = { id: number; pipelineId: number; name: string; position: number; role: string | null };

export function allStages(): StageRow[] {
  return db
    .select({
      id: schema.pipelineStages.id,
      pipelineId: schema.pipelineStages.pipelineId,
      name: schema.pipelineStages.name,
      position: schema.pipelineStages.position,
      role: schema.pipelineStages.role,
    })
    .from(schema.pipelineStages)
    .orderBy(asc(schema.pipelineStages.position))
    .all();
}

export function stageIdsWithRole(stages: StageRow[], pred: (role: string | null) => boolean): number[] {
  return stages.filter((s) => s.role != null && pred(s.role)).map((s) => s.id);
}

/** Leads created in [fromMs, toMs) with their current stage role. */
export function leadsCreatedIn(fromMs: number, toMs: number) {
  return db
    .select({
      source: schema.leads.source,
      campaign: schema.leads.campaign,
      therapyInterest: schema.leads.therapyInterest,
      role: schema.pipelineStages.role,
    })
    .from(schema.leads)
    .leftJoin(schema.pipelineStages, eq(schema.pipelineStages.id, schema.leads.stageId))
    .where(and(gte(schema.leads.createdAt, d(fromMs)), lt(schema.leads.createdAt, d(toMs))))
    .all();
}

export function countLeadsIn(fromMs: number, toMs: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(gte(schema.leads.createdAt, d(fromMs)), lt(schema.leads.createdAt, d(toMs))))
    .get();
  return Number(row?.n ?? 0);
}

export function conversionIn(fromMs: number, toMs: number): { won: number; total: number } {
  const rows = leadsCreatedIn(fromMs, toMs);
  return { total: rows.length, won: rows.filter((r) => isWon(r.role)).length };
}

/** Distinct leads that moved into a won stage (from a non-won one) in range. */
export function wonLeadsIn(fromMs: number, toMs: number): number {
  const wonIds = stageIdsWithRole(allStages(), (r) => WON_ROLES.has(r as StageRole));
  if (wonIds.length === 0) return 0;
  const rows = db
    .select({ leadId: schema.leadStageEvents.leadId, from: schema.leadStageEvents.fromStageId })
    .from(schema.leadStageEvents)
    .where(
      and(
        inArray(schema.leadStageEvents.toStageId, wonIds),
        gte(schema.leadStageEvents.at, d(fromMs)),
        lt(schema.leadStageEvents.at, d(toMs)),
      ),
    )
    .all();
  const won = new Set(wonIds);
  return new Set(rows.filter((r) => r.from == null || !won.has(r.from)).map((r) => r.leadId)).size;
}

export function openPipelineCount(): { open: number; pipelines: number } {
  const rows = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.leads)
    .leftJoin(schema.pipelineStages, eq(schema.pipelineStages.id, schema.leads.stageId))
    .where(
      sql`${schema.pipelineStages.role} IS NULL OR ${schema.pipelineStages.role} NOT IN ('won','repeat','lost','lapsed')`,
    )
    .get();
  return { open: Number(rows?.n ?? 0), pipelines: listPipelines().length };
}

export function funnelSteps(fromMs: number, toMs: number): { label: string; value: number }[] {
  const pid = defaultPipelineId();
  const stages = allStages().filter((s) => s.pipelineId === pid && !CLOSED_OUT.has(s.role ?? ""));
  if (stages.length === 0) return [];
  const rows = db
    .select({ toStageId: schema.leadStageEvents.toStageId, n: sql<number>`count(distinct ${schema.leadStageEvents.leadId})` })
    .from(schema.leadStageEvents)
    .where(
      and(
        inArray(schema.leadStageEvents.toStageId, stages.map((s) => s.id)),
        gte(schema.leadStageEvents.at, d(fromMs)),
        lt(schema.leadStageEvents.at, d(toMs)),
      ),
    )
    .groupBy(schema.leadStageEvents.toStageId)
    .all();
  const by = new Map(rows.map((r) => [r.toStageId, Number(r.n)]));
  return stages.map((s) => ({ label: s.name, value: by.get(s.id) ?? 0 }));
}
const CLOSED_OUT = new Set(["lost", "lapsed"]);

export function stageDistribution(): { label: string; value: number }[] {
  const pid = defaultPipelineId();
  const stages = allStages().filter((s) => s.pipelineId === pid);
  const rows = db
    .select({ stageId: schema.leads.stageId, n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(eq(schema.leads.pipelineId, pid))
    .groupBy(schema.leads.stageId)
    .all();
  const by = new Map(rows.map((r) => [r.stageId, Number(r.n)]));
  return stages.map((s) => ({ label: s.name, value: by.get(s.id) ?? 0 }));
}

/** Average completed time in each default-pipeline stage, in days (1 dp). */
export function avgTimeInStageDays(fromMs: number, toMs: number): { label: string; value: number; stays: number }[] {
  const pid = defaultPipelineId();
  const stages = allStages().filter((s) => s.pipelineId === pid);
  const inRange = and(
    eq(schema.leadStageEvents.pipelineId, pid),
    gte(schema.leadStageEvents.at, d(fromMs)),
    lt(schema.leadStageEvents.at, d(toMs)),
  );
  const leadIds = db.select({ id: schema.leadStageEvents.leadId }).from(schema.leadStageEvents).where(inRange);
  const events = db
    .select()
    .from(schema.leadStageEvents)
    .where(
      and(
        eq(schema.leadStageEvents.pipelineId, pid),
        lt(schema.leadStageEvents.at, d(toMs)),
        inArray(schema.leadStageEvents.leadId, leadIds),
      ),
    )
    .orderBy(asc(schema.leadStageEvents.at), asc(schema.leadStageEvents.id))
    .all()
    .map((e): StageEv => ({
      leadId: e.leadId,
      fromStageId: e.fromStageId,
      toStageId: e.toStageId,
      atMs: e.at.getTime(),
    }));
  const byLead = new Map<number, StageEv[]>();
  for (const e of events) {
    const l = byLead.get(e.leadId) ?? [];
    l.push(e);
    byLead.set(e.leadId, l);
  }
  const durations = new Map<number, number[]>();
  for (const evs of byLead.values()) {
    for (let i = 0; i + 1 < evs.length; i++) {
      if (evs[i + 1].atMs < fromMs) continue; // the stay ended before the range
      const m = timeInStage([evs[i], evs[i + 1]]);
      for (const [stageId, xs] of m) durations.set(stageId, [...(durations.get(stageId) ?? []), ...xs]);
    }
  }
  const out: { label: string; value: number; stays: number }[] = [];
  for (const s of stages) {
    const xs = durations.get(s.id);
    if (!xs || xs.length === 0) continue;
    const avg = xs.reduce((a, b) => a + b, 0) / xs.length / 86_400_000;
    out.push({ label: s.name, value: Math.round(avg * 10) / 10, stays: xs.length });
  }
  return out;
}

export function medianLeadToWonDays(fromMs: number, toMs: number): number | null {
  const wonIds = stageIdsWithRole(allStages(), (r) => WON_ROLES.has(r as StageRole));
  if (wonIds.length === 0) return null;
  const wonLeads = db
    .select({ id: schema.leadStageEvents.leadId })
    .from(schema.leadStageEvents)
    .where(
      and(
        inArray(schema.leadStageEvents.toStageId, wonIds),
        gte(schema.leadStageEvents.at, d(fromMs)),
        lt(schema.leadStageEvents.at, d(toMs)),
      ),
    );
  const events = db
    .select()
    .from(schema.leadStageEvents)
    .where(and(lt(schema.leadStageEvents.at, d(toMs)), inArray(schema.leadStageEvents.leadId, wonLeads)))
    .all()
    .map((e): StageEv => ({ leadId: e.leadId, fromStageId: e.fromStageId, toStageId: e.toStageId, atMs: e.at.getTime() }));
  const m = median(velocityDays(events, new Set(wonIds), fromMs, toMs));
  return m == null ? null : Math.round(m * 10) / 10;
}

export function wonLostSeries(fromMs: number, toMs: number): Record<string, string | number>[] {
  const stages = allStages();
  const wonIds = new Set(stageIdsWithRole(stages, (r) => WON_ROLES.has(r as StageRole)));
  const lostIds = new Set(stageIdsWithRole(stages, (r) => r === "lost"));
  const buckets = seriesBuckets(fromMs, toMs);
  const out = buckets.map((b) => ({ label: b.label, Won: 0, Lost: 0 }));
  const ids = [...wonIds, ...lostIds];
  if (ids.length === 0) return out;
  const rows = db
    .select({ to: schema.leadStageEvents.toStageId, at: schema.leadStageEvents.at })
    .from(schema.leadStageEvents)
    .where(
      and(
        inArray(schema.leadStageEvents.toStageId, ids),
        gte(schema.leadStageEvents.at, d(fromMs)),
        lt(schema.leadStageEvents.at, d(toMs)),
      ),
    )
    .all();
  for (const r of rows) {
    const i = bucketIndex(buckets, r.at.getTime());
    if (i < 0) continue;
    if (wonIds.has(r.to)) out[i].Won++;
    else out[i].Lost++;
  }
  return out;
}

export function staleLeads(nowMs: number, limit = 10) {
  return db
    .select({
      id: schema.leads.id,
      firstName: schema.leads.firstName,
      lastName: schema.leads.lastName,
      email: schema.leads.email,
      updatedAt: schema.leads.updatedAt,
      stage: schema.pipelineStages.name,
    })
    .from(schema.leads)
    .leftJoin(schema.pipelineStages, eq(schema.pipelineStages.id, schema.leads.stageId))
    .where(
      and(
        lt(schema.leads.updatedAt, d(nowMs - STALE_MS)),
        sql`(${schema.pipelineStages.role} IS NULL OR ${schema.pipelineStages.role} NOT IN ('won','repeat','lost'))`,
      ),
    )
    .orderBy(asc(schema.leads.updatedAt))
    .limit(limit)
    .all();
}

/** Uncontacted entry-stage leads that have waited past the red SLA threshold. */
export function slaBreachCount(nowMs: number): number {
  return listLeadsForBoard().filter(
    (l) =>
      l.firstOutboundAt === null &&
      (l.stage?.role == null || l.stage.role === "new") &&
      slaTone(nowMs - l.createdAt.getTime()) === "red",
  ).length;
}

export { isWon };
