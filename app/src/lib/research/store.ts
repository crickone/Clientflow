import "server-only";

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";

/**
 * Tenant store for Market Research P1's competitor watchlist (Task 4) — CRUD
 * over the 4 tables added alongside this file (see lib/db/schema.ts +
 * lib/db/tenant.ts's ensureTenantTables): `competitors` (the watchlist),
 * `competitor_metrics` (weekly rating/review-count time-series),
 * `competitor_reviews` (a rolling top-N review sample, replaced wholesale on
 * each refresh — never appended to), and `competitor_events` (the change
 * feed later tasks alert on).
 *
 * Reads/writes through the ambient, request-scoped `db` proxy (see
 * lib/db/index.ts) — the same choice lib/leads.ts and lib/campaigns/store.ts
 * make — so every call here is implicitly scoped to whichever tenant bound
 * the current request (or, for background jobs, whichever tenant
 * `runWithTenant()` bound); this module never takes a tenantId parameter and
 * must never be handed one to smuggle through raw SQL.
 *
 * These exported names + signatures are the CONTRACT later Market Research
 * tasks (the refresh job, change-detection, and the dashboard UI) build
 * against verbatim — do not rename without updating every caller.
 */

export type CompetitorRow = {
  id: number;
  siteId: number | null;
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm: number;
  source: string;
  tracked: boolean;
  muted: boolean;
  themesJson: string | null;
  themesAt: string | null;
  addedBy: string;
  firstSeenAt: string;
  lastRefreshedAt: string | null;
};

export type Metric = {
  id: number;
  competitorId: number;
  capturedAt: string;
  ratingMilli: number | null;
  reviewCount: number | null;
};

export type StoredReview = {
  externalReviewId: string;
  author: string;
  ratingMilli: number | null;
  text: string;
  publishedAt: string | null;
};

export type EventRow = {
  id: number;
  competitorId: number | null;
  type: string;
  summary: string;
  detailJson: string | null;
  occurredAt: string;
  seen: boolean;
};

export type NewCompetitor = {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceKm: number;
  source?: string;
  addedBy?: string;
};

export type NewEvent = {
  competitorId: number | null;
  type: string;
  summary: string;
  detailJson?: string | null;
  occurredAt?: string;
};

// ── competitors (the watchlist) ─────────────────────────────────────────

/**
 * Upsert-by-placeId: a fresh placeId inserts a new watchlist row (tracked,
 * unmuted, firstSeenAt = now); a placeId already on the watchlist updates
 * its mutable discovery fields (name/address/lat/lng/distanceKm/source) in
 * place and returns the SAME id. `firstSeenAt`, `tracked`, `muted`,
 * `themesJson`/`themesAt`, and `lastRefreshedAt` are deliberately left out
 * of the conflict `set` — a re-discovery (e.g. the next radius scan picking
 * this place up again) can never reset when it was first seen, silently
 * re-track/un-mute a row an operator chose to mute, or wipe a themes
 * summary that hasn't gone stale yet.
 */
export function upsertCompetitor(c: NewCompetitor): number {
  const now = new Date().toISOString();
  const row = db
    .insert(schema.competitors)
    .values({
      placeId: c.placeId,
      name: c.name,
      address: c.address,
      lat: c.lat,
      lng: c.lng,
      distanceKm: c.distanceKm,
      source: c.source ?? "google",
      addedBy: c.addedBy ?? "auto",
      firstSeenAt: now,
    })
    .onConflictDoUpdate({
      target: schema.competitors.placeId,
      set: {
        name: c.name,
        address: c.address,
        lat: c.lat,
        lng: c.lng,
        distanceKm: c.distanceKm,
        source: c.source ?? "google",
      },
    })
    .returning({ id: schema.competitors.id })
    .get();
  return row.id;
}

/**
 * The watchlist, nearest-first. `trackedOnly` filters to tracked=true AND
 * excludes muted rows too — a muted competitor is definitionally not part of
 * "what am I actively tracking", even if its `tracked` flag was never
 * flipped off.
 */
export function listCompetitors(opts: { trackedOnly?: boolean } = {}): CompetitorRow[] {
  return db
    .select()
    .from(schema.competitors)
    .where(
      opts.trackedOnly
        ? and(eq(schema.competitors.tracked, true), eq(schema.competitors.muted, false))
        : undefined,
    )
    .orderBy(asc(schema.competitors.distanceKm))
    .all();
}

/** Partial flag update — omit a key to leave it untouched. No-ops (no write) if neither flag is given. */
export function setCompetitorFlags(id: number, flags: { tracked?: boolean; muted?: boolean }): void {
  const set: Partial<{ tracked: boolean; muted: boolean }> = {};
  if (flags.tracked !== undefined) set.tracked = flags.tracked;
  if (flags.muted !== undefined) set.muted = flags.muted;
  if (Object.keys(set).length === 0) return;
  db.update(schema.competitors).set(set).where(eq(schema.competitors.id, id)).run();
}

export function setCompetitorThemes(id: number, themesJson: string, at: string): void {
  db.update(schema.competitors).set({ themesJson, themesAt: at }).where(eq(schema.competitors.id, id)).run();
}

export function touchRefreshed(id: number, at: string): void {
  db.update(schema.competitors).set({ lastRefreshedAt: at }).where(eq(schema.competitors.id, id)).run();
}

// ── weekly metrics (rating/review-count time-series) ───────────────────

export function appendMetric(
  competitorId: number,
  ratingMilli: number | null,
  reviewCount: number | null,
  capturedAt: string,
): void {
  db.insert(schema.competitorMetrics).values({ competitorId, ratingMilli, reviewCount, capturedAt }).run();
}

export function latestMetric(competitorId: number): Metric | null {
  return (
    db
      .select()
      .from(schema.competitorMetrics)
      .where(eq(schema.competitorMetrics.competitorId, competitorId))
      .orderBy(desc(schema.competitorMetrics.capturedAt), desc(schema.competitorMetrics.id))
      .limit(1)
      .get() ?? null
  );
}

// ~a year of weekly captures — a generous cap, not an expected steady-state size.
const DEFAULT_METRIC_HISTORY_LIMIT = 52;

/**
 * Newest-first (matches latestMetric()'s ordering and listEvents()'s
 * "newest first" contract below) — a caller that wants a chronological chart
 * just `.reverse()`s the (small, capped) result rather than this store
 * exposing two different orderings for the same table.
 */
export function metricHistory(competitorId: number, limit: number = DEFAULT_METRIC_HISTORY_LIMIT): Metric[] {
  return db
    .select()
    .from(schema.competitorMetrics)
    .where(eq(schema.competitorMetrics.competitorId, competitorId))
    .orderBy(desc(schema.competitorMetrics.capturedAt), desc(schema.competitorMetrics.id))
    .limit(limit)
    .all();
}

// ── review sample (rolling top-N, replaced wholesale) ───────────────────

/**
 * Wholesale swap: deletes every existing sampled review for this competitor
 * and inserts the new set, atomically (one transaction — a reader never sees
 * a moment with zero reviews between the delete and the insert). The sample
 * is a point-in-time snapshot from the latest refresh, never appended to.
 */
export function replaceReviews(competitorId: number, reviews: StoredReview[], capturedAt: string): void {
  db.transaction((tx) => {
    tx.delete(schema.competitorReviews).where(eq(schema.competitorReviews.competitorId, competitorId)).run();
    if (reviews.length > 0) {
      tx.insert(schema.competitorReviews)
        .values(
          reviews.map((r) => ({
            competitorId,
            externalReviewId: r.externalReviewId,
            author: r.author,
            ratingMilli: r.ratingMilli,
            text: r.text,
            publishedAt: r.publishedAt,
            capturedAt,
          })),
        )
        .run();
    }
  });
}

// ── change feed (alerts) ────────────────────────────────────────────────

export function addEvent(e: NewEvent): void {
  db.insert(schema.competitorEvents)
    .values({
      competitorId: e.competitorId,
      type: e.type,
      summary: e.summary,
      detailJson: e.detailJson ?? null,
      occurredAt: e.occurredAt ?? new Date().toISOString(),
    })
    .run();
}

const DEFAULT_EVENT_LIST_LIMIT = 50;

/** Newest-first. `unseenOnly` filters to seen=false — the notification-bell / "what changed" feed. */
export function listEvents(opts: { unseenOnly?: boolean; limit?: number } = {}): EventRow[] {
  return db
    .select()
    .from(schema.competitorEvents)
    .where(opts.unseenOnly ? eq(schema.competitorEvents.seen, false) : undefined)
    .orderBy(desc(schema.competitorEvents.occurredAt), desc(schema.competitorEvents.id))
    .limit(opts.limit ?? DEFAULT_EVENT_LIST_LIMIT)
    .all();
}

export function markEventsSeen(ids: number[]): void {
  if (ids.length === 0) return;
  db.update(schema.competitorEvents).set({ seen: true }).where(inArray(schema.competitorEvents.id, ids)).run();
}
