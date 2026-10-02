import "server-only";

import { and, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { toRecord } from "@/lib/marketing/campaigns";
import { countsFromStats, linkGroup, type SendCounts } from "./email";
import { bucketIndex, seriesBuckets } from "./stats";

const d = (ms: number) => new Date(ms);

export function subscribedNow(): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.contacts)
    .where(eq(schema.contacts.status, "subscribed"))
    .get();
  return Number(row?.n ?? 0);
}

/** When the contact joined the list: subscribedAt, falling back to createdAt. */
const joinedAt = sql<number>`coalesce(${schema.contacts.subscribedAt}, ${schema.contacts.createdAt})`;

/** Timestamps (ms) of contacts who joined the list in range (ever subscribed). */
function joinTimes(fromMs: number, toMs: number): number[] {
  return db
    .select({ at: joinedAt })
    .from(schema.contacts)
    .where(and(inArray(schema.contacts.status, ["subscribed", "unsubscribed"]), sql`${joinedAt} >= ${fromMs}`, sql`${joinedAt} < ${toMs}`))
    .all()
    .map((r) => Number(r.at));
}

function unsubTimes(fromMs: number, toMs: number): number[] {
  return db
    .select({ at: schema.contacts.unsubscribedAt })
    .from(schema.contacts)
    .where(and(isNotNull(schema.contacts.unsubscribedAt), gte(schema.contacts.unsubscribedAt, d(fromMs)), lt(schema.contacts.unsubscribedAt, d(toMs))))
    .all()
    .map((r) => (r.at as Date).getTime());
}

export function listChange(fromMs: number, toMs: number): { adds: number; unsubs: number } {
  return { adds: joinTimes(fromMs, toMs).length, unsubs: unsubTimes(fromMs, toMs).length };
}

export function listGrowthSeries(fromMs: number, toMs: number): { label: string; Adds: number; Unsubscribes: number }[] {
  const buckets = seriesBuckets(fromMs, toMs);
  const rows = buckets.map((b) => ({ label: b.label, Adds: 0, Unsubscribes: 0 }));
  for (const t of joinTimes(fromMs, toMs)) {
    const i = bucketIndex(buckets, t);
    if (i >= 0) rows[i].Adds += 1;
  }
  for (const t of unsubTimes(fromMs, toMs)) {
    const i = bucketIndex(buckets, t);
    if (i >= 0) rows[i].Unsubscribes += 1;
  }
  return rows;
}

export function statusCounts(): { label: string; value: number }[] {
  return db
    .select({ label: schema.contacts.status, value: sql<number>`count(*)` })
    .from(schema.contacts)
    .groupBy(schema.contacts.status)
    .all()
    .map((r) => ({ label: r.label, value: Number(r.value) }));
}

export type SentCampaign = { id: number; name: string; sentAtMs: number; counts: SendCounts };

/** Campaigns whose sentAt falls in range, newest first. */
export function campaignsSentIn(fromMs: number, toMs: number): SentCampaign[] {
  return db
    .select()
    .from(schema.emailCampaigns)
    .where(and(isNotNull(schema.emailCampaigns.sentAt), gte(schema.emailCampaigns.sentAt, d(fromMs)), lt(schema.emailCampaigns.sentAt, d(toMs))))
    .all()
    .map(toRecord)
    .map((c) => ({ id: c.id, name: c.name, sentAtMs: c.sentAt as number, counts: countsFromStats(c.stats) }))
    .sort((a, b) => b.sentAtMs - a.sentAtMs);
}

function eventsIn(event: string, fromMs: number, toMs: number) {
  return db
    .select({ sendId: schema.emailEvents.sendId, url: schema.emailEvents.url, at: schema.emailEvents.at })
    .from(schema.emailEvents)
    .where(and(eq(schema.emailEvents.event, event), gte(schema.emailEvents.at, d(fromMs)), lt(schema.emailEvents.at, d(toMs))))
    .all();
}

/** Opens and clicks per bucket, total and unique by send id. */
export function engagementSeries(fromMs: number, toMs: number) {
  const buckets = seriesBuckets(fromMs, toMs);
  const rows = buckets.map((b) => ({ label: b.label, Opens: 0, "Unique opens": 0, Clicks: 0, "Unique clicks": 0 }));
  const seen = buckets.map(() => ({ opened: new Set<number>(), clicked: new Set<number>() }));
  for (const [event, total, unique] of [
    ["opened", "Opens", "Unique opens"],
    ["clicked", "Clicks", "Unique clicks"],
  ] as const) {
    for (const e of eventsIn(event, fromMs, toMs)) {
      const i = bucketIndex(buckets, e.at.getTime());
      if (i < 0) continue;
      rows[i][total] += 1;
      if (e.sendId == null) continue;
      const set = seen[i][event];
      if (!set.has(e.sendId)) {
        set.add(e.sendId);
        rows[i][unique] += 1;
      }
    }
  }
  return rows;
}

/** Clicked links grouped by URL without query string, most clicked first. */
export function topLinks(fromMs: number, toMs: number, limit: number): { url: string; clicks: number; uniques: number }[] {
  const groups = new Map<string, { clicks: number; sends: Set<number> }>();
  for (const e of eventsIn("clicked", fromMs, toMs)) {
    if (!e.url) continue;
    const k = linkGroup(e.url);
    const g = groups.get(k) ?? { clicks: 0, sends: new Set<number>() };
    g.clicks += 1;
    if (e.sendId != null) g.sends.add(e.sendId);
    groups.set(k, g);
  }
  return [...groups]
    .map(([url, g]) => ({ url, clicks: g.clicks, uniques: g.sends.size }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, limit);
}

export function openTimes(fromMs: number, toMs: number): number[] {
  return eventsIn("opened", fromMs, toMs).map((e) => e.at.getTime());
}

export function suppressionCounts(): { label: string; value: number }[] {
  return db
    .select({ label: schema.suppressions.reason, value: sql<number>`count(*)` })
    .from(schema.suppressions)
    .groupBy(schema.suppressions.reason)
    .all()
    .map((r) => ({ label: r.label, value: Number(r.value) }));
}

export function contactSourceCounts(): { label: string; value: number }[] {
  const merged = new Map<string, number>();
  const rows = db
    .select({ source: schema.contacts.source, n: sql<number>`count(*)` })
    .from(schema.contacts)
    .groupBy(schema.contacts.source)
    .all();
  for (const r of rows) {
    const k = r.source?.trim() || "Unknown";
    merged.set(k, (merged.get(k) ?? 0) + Number(r.n));
  }
  return [...merged].map(([label, value]) => ({ label, value }));
}
