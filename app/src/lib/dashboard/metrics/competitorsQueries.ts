import "server-only";

import {
  getReviews,
  getSelfCompetitor,
  latestMetric,
  listAds,
  listCompetitors,
  listEvents,
  metricHistory,
  type CompetitorRow,
  type EventRow,
  type Metric,
  type StoredAd,
  type StoredReview,
} from "@/lib/research/store";
import { getResearchCapCents, researchSpentCents } from "@/lib/research/spend";
import { and, eq, gte, lt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { averageCount } from "./competitors";

export { ratingGap } from "./marketingQueries";

const tracked = () => listCompetitors({ trackedOnly: true, excludeSelf: true });

/** Own review count against the average of tracked competitors' latest counts. */
export function reviewGapData(): { hasSelf: boolean; self: number | null; others: number | null; competitors: number } {
  const self = getSelfCompetitor();
  const comps = tracked();
  const selfCount = self ? latestMetric(self.id)?.reviewCount ?? null : null;
  return {
    hasSelf: self !== null,
    self: selfCount,
    others: averageCount(comps.map((c) => latestMetric(c.id)?.reviewCount ?? null)),
    competitors: comps.length,
  };
}

/** new_ad events with `occurredAt` in [fromMs, toMs). */
export function newAdCount(fromMs: number, toMs: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.competitorEvents)
    .where(
      and(
        eq(schema.competitorEvents.type, "new_ad"),
        gte(schema.competitorEvents.occurredAt, new Date(fromMs).toISOString()),
        lt(schema.competitorEvents.occurredAt, new Date(toMs).toISOString()),
      ),
    )
    .get();
  return Number(row?.n ?? 0);
}

export function researchSpend(tenantId: number): { spentCents: number; capCents: number } {
  return { spentCents: researchSpentCents(tenantId), capCents: getResearchCapCents(tenantId) };
}

export type NamedHistory = { name: string; isSelf: boolean; history: Metric[] };

/** Self (when present) first, then up to `limit` nearest tracked competitors, each with up to `points` newest metrics. */
export function trendHistories(limit: number, points: number): NamedHistory[] {
  const self = getSelfCompetitor();
  const out: NamedHistory[] = [];
  if (self) out.push({ name: "You", isSelf: true, history: metricHistory(self.id, points) });
  for (const c of tracked().slice(0, limit)) out.push({ name: c.name, isSelf: false, history: metricHistory(c.id, points) });
  return out;
}

export type RecentReview = StoredReview & { competitor: string };

/** The review samples of every tracked competitor (callers pick the newest). */
export function trackedReviews(): RecentReview[] {
  return tracked().flatMap((c) => getReviews(c.id).map((r) => ({ ...r, competitor: c.name })));
}

export type ActivityEvent = EventRow & { competitor: string | null };

/** Newest competitor events with the competitor's name. */
export function recentActivity(limit: number): ActivityEvent[] {
  const names = new Map<number, string>(listCompetitors().map((c: CompetitorRow) => [c.id, c.name]));
  return listEvents({ limit }).map((e) => ({ ...e, competitor: e.competitorId === null ? null : names.get(e.competitorId) ?? null }));
}

export type RunningAd = StoredAd & { competitor: string };

/** Active ads across tracked competitors, newest started first. */
export function activeAds(limit: number): RunningAd[] {
  const t = (a: StoredAd) => (a.startedAt ? Date.parse(a.startedAt) || 0 : 0);
  return tracked()
    .flatMap((c) => listAds(c.id, { activeOnly: true }).map((a) => ({ ...a, competitor: c.name })))
    .sort((a, b) => t(b) - t(a))
    .slice(0, limit);
}
