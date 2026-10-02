import "server-only";

import { and, eq, gte, isNotNull, lt, lte, or, sql } from "drizzle-orm";

import { listCampaigns } from "@/lib/campaigns/store";
import { getCampaignScoreboard } from "@/lib/campaigns/scoreboardData";
import type { Scoreboard } from "@/lib/campaigns/scoreboard";
import { db, schema } from "@/lib/db";
import { upcomingDates } from "@/lib/marketing/seasonalCalendar";
import { getSelfCompetitor, latestMetric, listCompetitors } from "@/lib/research/store";
import { mergeUpcoming, type UpcomingItem } from "./marketing";
import { bucketIndex, seriesBuckets } from "./stats";

const d = (ms: number) => new Date(ms);
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Inclusive UTC day strings covering [fromMs, toMs). */
const dayRange = (fromMs: number, toMs: number) => ({ from: dayOf(fromMs), to: dayOf(Math.max(fromMs, toMs - 1)) });

export type CampaignRow = { id: number; name: string; slug: string; status: string; adSpendCents: number };

export function campaignsByStatus(): { active: number; ready: number } {
  const all = listCampaigns();
  return { active: all.filter((c) => c.status === "active").length, ready: all.filter((c) => c.status === "ready").length };
}

export function countCampaignLeadsIn(fromMs: number, toMs: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(isNotNull(schema.leads.campaign), gte(schema.leads.createdAt, d(fromMs)), lt(schema.leads.createdAt, d(toMs))))
    .get();
  return Number(row?.n ?? 0);
}

/** Leads in range per campaign name. */
export function campaignLeadCountsIn(fromMs: number, toMs: number): Map<string, number> {
  const rows = db
    .select({ name: schema.leads.campaign, n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(isNotNull(schema.leads.campaign), gte(schema.leads.createdAt, d(fromMs)), lt(schema.leads.createdAt, d(toMs))))
    .groupBy(schema.leads.campaign)
    .all();
  return new Map(rows.map((r) => [r.name as string, Number(r.n)]));
}

export type ScoredCampaign = { campaign: CampaignRow; score: Scoreboard };

/**
 * Active and complete campaigns with their all-time scoreboard. The AI build
 * cost is not part of any dashboard figure (CAC and ROAS use ad spend and
 * revenue only), so it is passed as 0 rather than estimated per campaign.
 */
export async function scoredCampaigns(): Promise<ScoredCampaign[]> {
  const set = listCampaigns().filter((c) => c.status === "active" || c.status === "complete");
  return Promise.all(set.map(async (c) => ({ campaign: c, score: await getCampaignScoreboard(c, 0) })));
}

/** Landing-page views in range for a campaign slug (production host path or dev mount path). */
export function landingViewsIn(slug: string, fromMs: number, toMs: number): number {
  const { from, to } = dayRange(fromMs, toMs);
  const row = db
    .select({ n: sql<number>`coalesce(sum(${schema.sitePageViewsDaily.views}), 0)` })
    .from(schema.sitePageViewsDaily)
    .where(
      and(
        gte(schema.sitePageViewsDaily.day, from),
        lte(schema.sitePageViewsDaily.day, to),
        or(
          eq(schema.sitePageViewsDaily.path, `/c/${slug}`),
          sql`${schema.sitePageViewsDaily.path} LIKE ${`/site/%/c/${slug}`}`,
        ),
      ),
    )
    .get();
  return Number(row?.n ?? 0);
}

/** Unique visitors summed across the tenant's sites, per series bucket. */
export function visitorsSeries(fromMs: number, toMs: number): { labels: string[]; values: number[]; total: number } {
  const buckets = seriesBuckets(fromMs, toMs);
  const values = buckets.map(() => 0);
  const { from, to } = dayRange(fromMs, toMs);
  const rows = db
    .select({ day: schema.siteVisitorsDaily.day, n: sql<number>`sum(${schema.siteVisitorsDaily.uniques})` })
    .from(schema.siteVisitorsDaily)
    .where(and(gte(schema.siteVisitorsDaily.day, from), lte(schema.siteVisitorsDaily.day, to)))
    .groupBy(schema.siteVisitorsDaily.day)
    .all();
  for (const r of rows) {
    const i = bucketIndex(buckets, Date.parse(`${r.day}T00:00:00Z`));
    if (i >= 0) values[i] += Number(r.n);
  }
  return { labels: buckets.map((b) => b.label), values, total: values.reduce((a, b) => a + b, 0) };
}

export function visitorsTotal(fromMs: number, toMs: number): number {
  return visitorsSeries(fromMs, toMs).total;
}

/** Page views in range grouped by raw (utm, referrer) pair; labelling is done by the caller. */
export function trafficRows(fromMs: number, toMs: number): { utm: string; referrer: string; views: number }[] {
  const { from, to } = dayRange(fromMs, toMs);
  return db
    .select({
      utm: schema.sitePageViewsDaily.utmSource,
      referrer: schema.sitePageViewsDaily.referrerDomain,
      views: sql<number>`sum(${schema.sitePageViewsDaily.views})`,
    })
    .from(schema.sitePageViewsDaily)
    .where(and(gte(schema.sitePageViewsDaily.day, from), lte(schema.sitePageViewsDaily.day, to)))
    .groupBy(schema.sitePageViewsDaily.utmSource, schema.sitePageViewsDaily.referrerDomain)
    .all()
    .map((r) => ({ ...r, views: Number(r.views) }));
}

export function formSubmissionsIn(fromMs: number, toMs: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.formSubmissions)
    .where(and(gte(schema.formSubmissions.createdAt, d(fromMs)), lt(schema.formSubmissions.createdAt, d(toMs))))
    .get();
  return Number(row?.n ?? 0);
}

/** Scheduled posts and emails in the next `days` days, soonest first. */
export function upcomingSendItems(nowMs: number, days: number, limit: number): UpcomingItem[] {
  const end = nowMs + days * 86_400_000;
  const posts = db
    .select({ name: schema.carouselSets.name, at: schema.scheduledPosts.scheduledFor })
    .from(schema.scheduledPosts)
    .innerJoin(schema.carouselSets, eq(schema.carouselSets.id, schema.scheduledPosts.carouselSetId))
    .where(
      and(
        eq(schema.scheduledPosts.status, "scheduled"),
        gte(schema.scheduledPosts.scheduledFor, d(nowMs)),
        lt(schema.scheduledPosts.scheduledFor, d(end)),
      ),
    )
    .all();
  const emails = db
    .select({ name: schema.emailCampaigns.name, at: schema.emailCampaigns.scheduledAt })
    .from(schema.emailCampaigns)
    .where(
      and(
        eq(schema.emailCampaigns.status, "scheduled"),
        isNotNull(schema.emailCampaigns.scheduledAt),
        gte(schema.emailCampaigns.scheduledAt, d(nowMs)),
        lt(schema.emailCampaigns.scheduledAt, d(end)),
      ),
    )
    .all();
  return mergeUpcoming(
    posts.map((p) => ({ name: p.name, atMs: p.at.getTime() })),
    emails.map((e) => ({ name: e.name, atMs: (e.at as Date).getTime() })),
    limit,
  );
}

/** Today's date in Dublin as YYYY-MM-DD. */
export function dublinToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function seasonalDates(now: Date, limit: number) {
  const today = dublinToday(now);
  const base = Date.parse(`${today}T00:00:00Z`);
  return upcomingDates(today, 60)
    .slice(0, limit)
    .map((x) => ({ ...x, inDays: Math.round((Date.parse(`${x.iso}T00:00:00Z`) - base) / 86_400_000) }));
}

export type RatingGap = { self: number | null; others: number | null; competitors: number; hasSelf: boolean };

export function ratingGap(): RatingGap {
  const self = getSelfCompetitor();
  const comps = listCompetitors({ trackedOnly: true, excludeSelf: true });
  const ratings = comps
    .map((c) => latestMetric(c.id)?.ratingMilli)
    .filter((r): r is number => r != null)
    .map((r) => r / 1000);
  const selfMilli = self ? latestMetric(self.id)?.ratingMilli ?? null : null;
  return {
    hasSelf: self !== null,
    self: selfMilli == null ? null : selfMilli / 1000,
    others: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null,
    competitors: comps.length,
  };
}

