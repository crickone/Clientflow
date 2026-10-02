import "server-only";

import { and, desc, eq, gte, inArray, isNotNull, lt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { mergeCalendar, type CalendarItem } from "./content";

const SP = schema.scheduledPosts;
const BP = schema.blogPosts;
const d = (ms: number) => new Date(ms);

function count(q: { n: number } | undefined): number {
  return Number(q?.n ?? 0);
}

/** Posts that went out (postedAt) in [fromMs, toMs). */
export function postedCount(fromMs: number, toMs: number): number {
  return count(
    db
      .select({ n: sql<number>`count(*)` })
      .from(SP)
      .where(and(eq(SP.status, "posted"), isNotNull(SP.postedAt), gte(SP.postedAt, d(fromMs)), lt(SP.postedAt, d(toMs))))
      .get(),
  );
}

/** Posts still waiting to go out at or after `nowMs`. */
export function scheduledCount(nowMs: number): number {
  return count(
    db.select({ n: sql<number>`count(*)` }).from(SP).where(and(eq(SP.status, "scheduled"), gte(SP.scheduledFor, d(nowMs)))).get(),
  );
}

/** Failed posts whose last attempt (else scheduled time) falls in [fromMs, toMs). */
export function failedCount(fromMs: number, toMs: number): number {
  const at = sql`coalesce(${SP.lastAttemptAt}, ${SP.scheduledFor})`;
  return count(
    db.select({ n: sql<number>`count(*)` }).from(SP).where(and(eq(SP.status, "failed"), sql`${at} >= ${fromMs}`, sql`${at} < ${toMs}`)).get(),
  );
}

/** Blog posts published in [fromMs, toMs). */
export function blogPublishedCount(fromMs: number, toMs: number): number {
  return count(
    db
      .select({ n: sql<number>`count(*)` })
      .from(BP)
      .where(and(eq(BP.publishState, "published"), isNotNull(BP.publishedAt), gte(BP.publishedAt, d(fromMs)), lt(BP.publishedAt, d(toMs))))
      .get(),
  );
}

/** Scheduled social posts and scheduled blog posts in the next `days` days, soonest first. */
export function calendarItems(nowMs: number, days: number, limit: number): CalendarItem[] {
  const end = nowMs + days * 86_400_000;
  const posts = db
    .select({ name: schema.carouselSets.name, at: SP.scheduledFor, channels: SP.channels })
    .from(SP)
    .leftJoin(schema.carouselSets, eq(schema.carouselSets.id, SP.carouselSetId))
    .where(and(eq(SP.status, "scheduled"), gte(SP.scheduledFor, d(nowMs)), lt(SP.scheduledFor, d(end))))
    .all();
  const blogs = db
    .select({ title: BP.title, at: BP.scheduledFor })
    .from(BP)
    .where(and(eq(BP.publishState, "scheduled"), isNotNull(BP.scheduledFor), gte(BP.scheduledFor, d(nowMs)), lt(BP.scheduledFor, d(end))))
    .all();
  return mergeCalendar(
    posts.map((p) => ({ name: p.name ?? "Untitled post", atMs: p.at.getTime(), channels: p.channels })),
    blogs.map((b) => ({ name: b.title, atMs: (b.at as Date).getTime() })),
    limit,
  );
}

/** The channels column of every post that went out in [fromMs, toMs). */
export function postedChannelColumns(fromMs: number, toMs: number): string[] {
  return db
    .select({ channels: SP.channels })
    .from(SP)
    .where(and(eq(SP.status, "posted"), isNotNull(SP.postedAt), gte(SP.postedAt, d(fromMs)), lt(SP.postedAt, d(toMs))))
    .all()
    .map((r) => r.channels);
}

export type FailedPost = { id: number; name: string; error: string | null; atMs: number };

/** Latest failed posts, newest first. */
export function failedPosts(limit: number): FailedPost[] {
  return db
    .select({
      id: SP.id,
      name: schema.carouselSets.name,
      error: SP.error,
      attempt: SP.lastAttemptAt,
      scheduledFor: SP.scheduledFor,
    })
    .from(SP)
    .leftJoin(schema.carouselSets, eq(schema.carouselSets.id, SP.carouselSetId))
    .where(eq(SP.status, "failed"))
    .orderBy(desc(sql`coalesce(${SP.lastAttemptAt}, ${SP.scheduledFor})`), desc(SP.id))
    .limit(limit)
    .all()
    .map((r) => ({ id: r.id, name: r.name ?? "Untitled post", error: r.error, atMs: (r.attempt ?? r.scheduledFor).getTime() }));
}

export type RecentDesign = { id: number; name: string; slides: number; status: string | null; updatedAtMs: number };

/** Latest designs by update time, with slide counts from one grouped query. */
export function recentDesigns(limit: number): RecentDesign[] {
  const sets = db
    .select({ id: schema.carouselSets.id, name: schema.carouselSets.name, status: schema.carouselSets.generationStatus, updatedAt: schema.carouselSets.updatedAt })
    .from(schema.carouselSets)
    .orderBy(desc(schema.carouselSets.updatedAt), desc(schema.carouselSets.id))
    .limit(limit)
    .all();
  if (sets.length === 0) return [];
  const counts = new Map(
    db
      .select({ id: schema.carouselSlides.carouselSetId, n: sql<number>`count(*)` })
      .from(schema.carouselSlides)
      .where(inArray(schema.carouselSlides.carouselSetId, sets.map((s) => s.id)))
      .groupBy(schema.carouselSlides.carouselSetId)
      .all()
      .map((r) => [r.id, Number(r.n)] as const),
  );
  return sets.map((s) => ({ id: s.id, name: s.name, slides: counts.get(s.id) ?? 0, status: s.status, updatedAtMs: s.updatedAt.getTime() }));
}

/** Library assets in total and added in [fromMs, toMs). */
export function libraryCounts(fromMs: number, toMs: number): { total: number; added: number } {
  const A = schema.imageLibraryAssets;
  const total = db.select({ n: sql<number>`count(*)` }).from(A).get();
  const added = db.select({ n: sql<number>`count(*)` }).from(A).where(and(gte(A.createdAt, d(fromMs)), lt(A.createdAt, d(toMs)))).get();
  return { total: count(total), added: count(added) };
}

/** Blog posts by lifecycle stage, all time. */
export function blogPipelineCounts(): { drafts: number; scheduled: number; published: number } {
  const rows = db
    .select({ state: BP.publishState, status: BP.status, n: sql<number>`count(*)` })
    .from(BP)
    .groupBy(BP.publishState, BP.status)
    .all();
  let drafts = 0;
  let scheduled = 0;
  let published = 0;
  for (const r of rows) {
    const n = Number(r.n);
    if (r.state === "published") published += n;
    else if (r.state === "scheduled") scheduled += n;
    else if (r.status === "ready") drafts += n;
  }
  return { drafts, scheduled, published };
}
