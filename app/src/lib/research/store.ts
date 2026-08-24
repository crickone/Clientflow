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
 *
 * P1.1 added `isSelf` on `competitors`: marks the tenant's OWN gym among the
 * watchlist (see lib/research/discovery.ts's isSameBusiness) — exposed on
 * `CompetitorRow` like every other column, settable via `NewCompetitor`,
 * filterable via `listCompetitors({excludeSelf:true})`, and readable
 * directly via `getSelfCompetitor()` below.
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
  /** True for the (at most one) row discovery matched as the tenant's own gym — see the module doc. */
  isSelf: boolean;
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
  /** Defaults to false when omitted — see the module doc. */
  isSelf?: boolean;
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
 *
 * `isSelf` IS included in the conflict `set`, unlike those operator-owned
 * flags — it's re-derived fresh from Google's data + discovery's
 * isSameBusiness match every run, not something an operator sets by hand.
 * A rare miss on one run (e.g. Google briefly renames the place, or it
 * drops out of this run's `kept` set) self-corrects on the next; omitted
 * entirely (no `isSelf` on `c`), it defaults to false, matching the column
 * default for a genuinely new row.
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
      isSelf: c.isSelf ?? false,
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
        isSelf: c.isSelf ?? false,
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
 * flipped off. `excludeSelf` (P1.1) additionally drops the tenant's own gym
 * (isSelf=true) — the option every caller that means "competitors" (ranking,
 * highlights, counts, the AI landscape digest) should pass; a caller that
 * genuinely wants everything on the watchlist including self (e.g. the
 * weekly refresh's own metric-snapshot loop, which must keep capturing
 * self's rating/reviews too) omits it. `and()` tolerates `undefined`
 * conditions (drizzle drops them), so any combination of the two flags — or
 * neither — composes into a single `where` with no branching needed here.
 */
export function listCompetitors(opts: { trackedOnly?: boolean; excludeSelf?: boolean } = {}): CompetitorRow[] {
  return db
    .select()
    .from(schema.competitors)
    .where(
      and(
        opts.trackedOnly ? eq(schema.competitors.tracked, true) : undefined,
        opts.trackedOnly ? eq(schema.competitors.muted, false) : undefined,
        opts.excludeSelf ? eq(schema.competitors.isSelf, false) : undefined,
      ),
    )
    .orderBy(asc(schema.competitors.distanceKm))
    .all();
}

/**
 * The tenant's OWN gym, if discovery has ever matched one (isSameBusiness in
 * discovery.ts) — at most one row can ever have isSelf=true (discovery
 * enforces "nearest best match" per run). Null when no match has been found
 * yet (best-effort, see discovery.ts's own doc comment) — callers treat that
 * as "no self reference to show", the current, pre-P1.1 behaviour.
 */
export function getSelfCompetitor(): CompetitorRow | null {
  return (
    db.select().from(schema.competitors).where(eq(schema.competitors.isSelf, true)).limit(1).get() ?? null
  );
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

/**
 * The current cached review sample for a competitor — whatever `replaceReviews`
 * last wrote wholesale (already capped to Google's own top-N per place; see
 * this table's doc comment above), in the order they were inserted (`id asc`),
 * which preserves Google's own relevance ordering rather than re-sorting by,
 * say, rating or recency. Empty array (never throwing) for a competitor with
 * no sample yet — mirrors `metricHistory`'s "nothing yet -> []" contract.
 *
 * Added for Task 8 (Market Research P1's AI review-themes summary,
 * lib/research/summary.ts) as the read counterpart to `replaceReviews` — no
 * caller needed a single competitor's review rows back out until now.
 */
export function getReviews(competitorId: number): StoredReview[] {
  return db
    .select({
      externalReviewId: schema.competitorReviews.externalReviewId,
      author: schema.competitorReviews.author,
      ratingMilli: schema.competitorReviews.ratingMilli,
      text: schema.competitorReviews.text,
      publishedAt: schema.competitorReviews.publishedAt,
    })
    .from(schema.competitorReviews)
    .where(eq(schema.competitorReviews.competitorId, competitorId))
    .orderBy(asc(schema.competitorReviews.id))
    .all();
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
