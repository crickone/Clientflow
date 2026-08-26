import "server-only";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { AdLite } from "./adLibrary";

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
 *
 * Market Research P2 (Task 3) added `competitor_ads` — a competitor's
 * individual ads, sourced from the Meta Ad Library
 * (lib/research/adLibrary.ts's searchCompetitorAds / `AdLite`) and kept in
 * sync by the later refresh job via lib/research/adDiff.ts's `diffAds`. Same
 * ambient-`db`/no-tenantId-param contract as everything else here.
 * `bodies`/`platforms` are JSON-encoded on write and parsed back into arrays
 * on read (see `toStoredAd` below) — `AdLite`'s own array shape, stored as
 * TEXT the same way every other JSON-array column in this app is (e.g.
 * `appointments.therapyIds`). Also added `competitors.adAngleJson`/
 * `adAngleAt` (`setCompetitorAdAngle`) — Task 5's cached AI ad-angle summary,
 * mirroring `themesJson`/`themesAt`'s cache-column shape above but for ads
 * instead of reviews; exposed on `CompetitorRow` the same way `isSelf` was.
 * The advertiser-page-match fix later added `pageName`/`pageId` to
 * `competitor_ads` (the Meta page an ad is actually attributed to — see
 * lib/research/adPageMatch.ts's module doc); refresh.ts filters
 * `searchCompetitorAds`'s results down to matching-page ads BEFORE they ever
 * reach `diffAds`/`upsertAd`, so every row this store holds already passed
 * that check.
 *
 * Exact Page-ID ad matching (Task 1) added `facebookPageId`/`facebookPageName`
 * to `competitors` — an operator-set link to a specific Meta Page (Task 2's
 * admin UI is the intended caller of the two setters below). When set,
 * refresh.ts switches that one competitor from the search_terms +
 * adPageMatchesCompetitor filter path to `searchCompetitorAdsByPageId`
 * (search_page_ids — exact, every ad Meta attributes to that page, no
 * name-text matching) and uses the results directly, unfiltered. NULL/NULL
 * (unlinked) is the default for every competitor until explicitly linked.
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
  /** Task 5's cached AI ad-angle summary for this competitor's ad set (competitor_ads) — see setCompetitorAdAngle. */
  adAngleJson: string | null;
  adAngleAt: string | null;
  /** Meta Page this competitor is linked to (exact Page-ID ad matching,
   *  Task 1) — set via setCompetitorFacebookPage, cleared via
   *  clearCompetitorFacebookPage. When set, refresh.ts fetches this
   *  competitor's ads via searchCompetitorAdsByPageId (search_page_ids,
   *  exact) instead of the name-filtered search_terms path. NULL
   *  (unlinked) for every competitor until an operator links one. */
  facebookPageId: string | null;
  /** Human-readable label for facebookPageId, set together with it — display only, never used for matching. */
  facebookPageName: string | null;
  /** Content-gap analysis: the competitor's own site (Google Places' websiteUri, or admin-set) — see setCompetitorWebsite. Null until Google returns one or an admin sets it. */
  websiteUri: string | null;
  /** When contentScan.ts's scanCompetitorContent last crawled this site — a real JS Date (drizzle's timestamp_ms mode), null before the first scan. Convert with `.getTime()` where an epoch number is more convenient (see getContentGaps). */
  contentScannedAt: Date | null;
  /** AI-derived site-level topic set from the last content scan (topics.ts's deriveSiteTopics), a plain JSON string[] — see setCompetitorContentTopics. Null before the first scan. */
  contentTopicsJson: string | null;
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

/**
 * Links this competitor to a specific Meta Page (exact Page-ID ad matching,
 * Task 1) — sets BOTH facebook_page_id and facebook_page_name together
 * (Task 2's admin UI is the intended caller; there's no legitimate way to
 * have one set without the other). Once linked, refresh.ts's ad-fetch step
 * switches this competitor from the search_terms + adPageMatchesCompetitor
 * name-filter path to searchCompetitorAdsByPageId (search_page_ids) — exact,
 * no name-text matching — see adLibrary.ts's module doc.
 */
export function setCompetitorFacebookPage(id: number, pageId: string, pageName: string): void {
  db.update(schema.competitors)
    .set({ facebookPageId: pageId, facebookPageName: pageName })
    .where(eq(schema.competitors.id, id))
    .run();
}

/** Unlinks a competitor from its Meta Page — reverts refresh.ts back to the search_terms + adPageMatchesCompetitor filtered path for this competitor. */
export function clearCompetitorFacebookPage(id: number): void {
  db.update(schema.competitors)
    .set({ facebookPageId: null, facebookPageName: null })
    .where(eq(schema.competitors.id, id))
    .run();
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

// ── competitor ads (Market Research P2, Task 3) ─────────────────────────

export type StoredAd = {
  id: number;
  competitorId: number;
  adId: string;
  bodies: string[];
  linkTitle: string | null;
  linkCaption: string | null;
  platforms: string[];
  snapshotUrl: string;
  startedAt: string | null;
  stoppedAt: string | null;
  active: boolean;
  imageUrl: string | null;
  /** The advertiser page Meta attributed this ad to (AdLite.pageName) — see
   *  the module doc's "advertiser-page-match fix" note. Defaults to `""`
   *  both for a row Meta genuinely didn't return a page_name for AND for a
   *  pre-existing row written before this column existed (NULL in the DB
   *  either way) — same "never null in the app-facing shape" contract as
   *  linkTitle/linkCaption below use `null`, except this one mirrors
   *  bodies/platforms' "always a real value" contract instead, matching
   *  AdLite.pageName being required-with-"" rather than optional. */
  pageName: string;
  /** page_id — stored for a later exact-match task; not read by
   *  adPageMatchesCompetitor today. Same ""-default contract as pageName. */
  pageId: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

/**
 * Best-effort JSON-array parse for the `bodies`/`platforms` TEXT columns —
 * mirrors adLibrary.ts's own defensive style (never throws; a malformed or
 * non-array value degrades to `[]` rather than blowing up a read). Every
 * write path in this module always JSON.stringifies a real `string[]` first
 * (AdLite.bodies/platforms), so this only ever has to tolerate a
 * hand-edited or pre-migration row in practice.
 */
function parseJsonStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toStoredAd(row: typeof schema.competitorAds.$inferSelect): StoredAd {
  return {
    id: row.id,
    competitorId: row.competitorId,
    adId: row.adId,
    bodies: parseJsonStringArray(row.bodies),
    linkTitle: row.linkTitle,
    linkCaption: row.linkCaption,
    platforms: parseJsonStringArray(row.platforms),
    snapshotUrl: row.snapshotUrl,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt,
    active: row.active,
    imageUrl: row.imageUrl,
    // NULL -> "" covers both a row Meta returned no page_name for AND a
    // pre-existing row written before the page_name/page_id columns existed
    // (see the migration note in lib/db/tenant.ts) -- either way, "" is what
    // adPageMatchesCompetitor already treats as "no match" (see
    // adPageMatch.ts), so a stale pre-migration row simply won't appear in
    // the gallery until the next rescan re-upserts it with a real page_name.
    pageName: row.pageName ?? "",
    pageId: row.pageId ?? "",
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
  };
}

/**
 * Upsert-by-(competitorId, adId): a fresh pair inserts a new row
 * (firstSeenAt = lastSeenAt = `at`, active = true); a pair already stored
 * updates its mutable fields in place — bodies/linkTitle/linkCaption/
 * platforms/snapshotUrl/startedAt/stoppedAt/imageUrl/pageName/pageId/
 * active/lastSeenAt.
 * `firstSeenAt` is deliberately left out of the conflict `set`, mirroring
 * upsertCompetitor's exact "keep firstSeenAt" contract — a re-fetch can
 * never reset when this ad was first seen.
 *
 * `active` is unconditionally set true here, even on the update path — an ad
 * this call is asked to upsert came back from the current Ad Library search,
 * so it's current by definition; the ONLY way a row becomes inactive is a
 * later, explicit `markAdsStopped` call (fed by the diff's `stoppedAdIds`)
 * for ids that DIDN'T come back. Caller order matters: adDiff.ts's `diffAds`
 * returns `upserts` (every current ad, for this function) and
 * `stoppedAdIds` separately — a refresh job upserts first, then calls
 * markAdsStopped, so an ad that's both present-but-past-its-stoppedAt AND in
 * `stoppedAdIds` still ends up correctly inactive (markAdsStopped runs
 * second and wins).
 */
export function upsertAd(competitorId: number, ad: AdLite, at: string): void {
  const mutable = {
    bodies: JSON.stringify(ad.bodies),
    linkTitle: ad.linkTitle ?? null,
    linkCaption: ad.linkCaption ?? null,
    platforms: JSON.stringify(ad.platforms),
    snapshotUrl: ad.snapshotUrl,
    startedAt: ad.startedAt ?? null,
    stoppedAt: ad.stoppedAt ?? null,
    active: true,
    imageUrl: ad.imageUrl ?? null,
    // ad.pageName/pageId are always real strings (required on AdLite,
    // defaulting to "" in mapAdLite -- never undefined), so these just pass
    // straight through; stored as "" rather than NULL for anything upserted
    // through this path (only a genuinely pre-migration row is ever NULL).
    pageName: ad.pageName,
    pageId: ad.pageId,
    lastSeenAt: at,
  };
  db.insert(schema.competitorAds)
    .values({ competitorId, adId: ad.adId, firstSeenAt: at, ...mutable })
    .onConflictDoUpdate({
      target: [schema.competitorAds.competitorId, schema.competitorAds.adId],
      set: mutable,
    })
    .run();
}

/**
 * A competitor's stored ads, newest-first by `startedAt`. SQLite treats NULL
 * as smaller than any other value, so a plain `DESC` naturally sorts ads
 * with a known start date first (most recently started first) and pushes
 * ads with no `startedAt` (Meta didn't return one) to the end, rather than
 * letting them sort arbitrarily first; `id DESC` breaks ties (equal
 * startedAt, or both null) so the ordering is fully deterministic.
 * `activeOnly` filters to active=true — the "what's this competitor running
 * right now" view.
 */
export function listAds(competitorId: number, opts: { activeOnly?: boolean } = {}): StoredAd[] {
  return db
    .select()
    .from(schema.competitorAds)
    .where(
      and(
        eq(schema.competitorAds.competitorId, competitorId),
        opts.activeOnly ? eq(schema.competitorAds.active, true) : undefined,
      ),
    )
    .orderBy(desc(schema.competitorAds.startedAt), desc(schema.competitorAds.id))
    .all()
    .map(toStoredAd);
}

/** The adIds this competitor currently has active=true — feeds adDiff.ts's `prevActiveIds` for the next refresh cycle. */
export function activeAdIds(competitorId: number): Set<string> {
  const rows = db
    .select({ adId: schema.competitorAds.adId })
    .from(schema.competitorAds)
    .where(and(eq(schema.competitorAds.competitorId, competitorId), eq(schema.competitorAds.active, true)))
    .all();
  return new Set(rows.map((r) => r.adId));
}

/**
 * Flips active -> false for the given adIds (scoped to one competitor) and
 * stamps `stoppedAt`, but ONLY where it isn't already set. Two updates in a
 * transaction rather than a single COALESCE-in-`set` statement, to keep this
 * file consistent with its existing plain-drizzle style (replaceReviews
 * above is the precedent for "wholesale change inside db.transaction")
 * rather than introduce a new sql-template idiom. This preserves a real
 * `ad_delivery_stop_time` Meta already gave upsertAd, and makes the call
 * idempotent: re-running it for an already-stopped id changes active (a
 * no-op, already false) but never clobbers stoppedAt with a later "now". A
 * no-op (no transaction opened) on an empty adIds array, mirroring
 * markEventsSeen's contract.
 */
export function markAdsStopped(competitorId: number, adIds: string[], at: string): void {
  if (adIds.length === 0) return;
  db.transaction((tx) => {
    tx.update(schema.competitorAds)
      .set({ active: false })
      .where(and(eq(schema.competitorAds.competitorId, competitorId), inArray(schema.competitorAds.adId, adIds)))
      .run();
    tx.update(schema.competitorAds)
      .set({ stoppedAt: at })
      .where(
        and(
          eq(schema.competitorAds.competitorId, competitorId),
          inArray(schema.competitorAds.adId, adIds),
          isNull(schema.competitorAds.stoppedAt),
        ),
      )
      .run();
  });
}

/** Caches Task 5's AI ad-angle summary on the owning competitor row — mirrors setCompetitorThemes's shape exactly, for ads instead of reviews. */
export function setCompetitorAdAngle(competitorId: number, adAngleJson: string, at: string): void {
  db.update(schema.competitors).set({ adAngleJson, adAngleAt: at }).where(eq(schema.competitors.id, competitorId)).run();
}

// ── content-gap analysis (competitor site pages + crawl bookkeeping) ────

/**
 * Sets a competitor's own site. The ONLY legitimate callers are refresh.ts
 * (Google Places' `websiteUri`, guarded there on `if (detail.websiteUri)` so
 * a cycle where Google omits the field never clobbers what's already
 * stored) and a future admin "set website by hand" control — either way,
 * this setter itself always takes a real, non-empty URL string; there is no
 * "clear" counterpart because nothing in this feature needs one yet.
 */
export function setCompetitorWebsite(id: number, websiteUri: string): void {
  db.update(schema.competitors).set({ websiteUri }).where(eq(schema.competitors.id, id)).run();
}

/** Stamps when contentScan.ts's scanCompetitorContent last crawled this competitor's site — a real JS Date (drizzle's timestamp_ms mode), mirroring runStore.ts's `new Date()` convention for its own timestamp_ms columns (not this table's usual ISO-string touchRefreshed/setCompetitorThemes calls). */
export function setCompetitorContentScannedAt(id: number, at: Date): void {
  db.update(schema.competitors).set({ contentScannedAt: at }).where(eq(schema.competitors.id, id)).run();
}

/** Caches the AI-derived site-level topic set (topics.ts's deriveSiteTopics) as a plain JSON string[] — no companion `_at` column, unlike themesJson/adAngleJson, because contentScannedAt (set in the same crawl pass) already timestamps it. */
export function setCompetitorContentTopics(id: number, topicsJson: string): void {
  db.update(schema.competitors).set({ contentTopicsJson: topicsJson }).where(eq(schema.competitors.id, id)).run();
}

/** The on-page SEO read of one crawled page (lib/research/seo.ts's PageSeo) plus where it was found — the shape `replaceCompetitorPages` inserts and `listCompetitorPages`/`listAllCompetitorPagesWithCompetitor` read back. `topic` is optional on write (omitted/undefined -> stored NULL) — a future per-page AI mapping step's hook; contentScan.ts never sets it today (see schema.ts's module doc). */
export type NewCompetitorPage = {
  url: string;
  path: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  h2s: string[];
  wordCount: number;
  topic?: string | null;
};

/** A stored competitor_pages row, JSON/Date-parsed back into app shapes — mirrors StoredAd's role for competitor_ads. `fetchedAt` is epoch ms (converted from the column's real Date via `.getTime()`, mirroring runStore.ts's RunRecord conversion) rather than a Date, so this type stays plain-JSON-serialisable for a Server Component prop / API response. */
export type StoredCompetitorPage = {
  id: number;
  competitorId: number;
  url: string;
  path: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  h2s: string[];
  wordCount: number;
  topic: string | null;
  fetchedAt: number;
};

function toStoredCompetitorPage(row: typeof schema.competitorPages.$inferSelect): StoredCompetitorPage {
  return {
    id: row.id,
    competitorId: row.competitorId,
    url: row.url,
    path: row.path,
    title: row.title,
    metaDescription: row.metaDescription,
    h1: row.h1,
    h2s: parseJsonStringArray(row.h2sJson ?? "[]"),
    wordCount: row.wordCount,
    topic: row.topic,
    fetchedAt: row.fetchedAt.getTime(),
  };
}

/**
 * Wholesale swap, same "delete + re-insert in one transaction" contract as
 * replaceReviews above: a scan REPLACES a competitor's whole crawled page
 * set, never appends to it, so a reader never sees a moment with zero pages
 * between the delete and the insert, and a competitor's page list always
 * reflects only its most recent crawl. `fetchedAt` is a single shared
 * timestamp for the whole crawl batch (mirrors replaceReviews' own
 * `capturedAt` parameter) rather than a per-page value — the pages of one
 * scan are conceptually "captured together", even though the underlying
 * fetches were paced with a small delay between requests (see crawl.ts).
 */
export function replaceCompetitorPages(competitorId: number, pages: NewCompetitorPage[], fetchedAt: Date): void {
  db.transaction((tx) => {
    tx.delete(schema.competitorPages).where(eq(schema.competitorPages.competitorId, competitorId)).run();
    if (pages.length > 0) {
      tx.insert(schema.competitorPages)
        .values(
          pages.map((p) => ({
            competitorId,
            url: p.url,
            path: p.path,
            title: p.title,
            metaDescription: p.metaDescription,
            h1: p.h1,
            h2sJson: JSON.stringify(p.h2s),
            wordCount: p.wordCount,
            topic: p.topic ?? null,
            fetchedAt,
          })),
        )
        .run();
    }
  });
}

/** One competitor's crawled pages, in crawl/insertion order (id asc — the order discoverUrls returned them in). Empty array (never throwing) for a competitor never scanned yet, mirroring getReviews'/listAds' "nothing yet -> []" contract. */
export function listCompetitorPages(competitorId: number): StoredCompetitorPage[] {
  return db
    .select()
    .from(schema.competitorPages)
    .where(eq(schema.competitorPages.competitorId, competitorId))
    .orderBy(asc(schema.competitorPages.id))
    .all()
    .map(toStoredCompetitorPage);
}

export type CompetitorPageWithCompetitor = StoredCompetitorPage & {
  competitorName: string;
  isSelf: boolean;
};

/**
 * Every tracked-or-not competitor's crawled pages, tenant-wide, joined to
 * the owning competitor's name/isSelf — the read the gap computation
 * (contentScan.ts's getContentGaps) and the UI's per-competitor site
 * breakdown both need, so neither has to N+1 across `listCompetitorPages`
 * per competitor. Ordered by competitor then page id, so a caller grouping
 * by `competitorId` gets each competitor's pages back in the same
 * crawl/insertion order `listCompetitorPages` would.
 */
export function listAllCompetitorPagesWithCompetitor(): CompetitorPageWithCompetitor[] {
  return db
    .select({
      id: schema.competitorPages.id,
      competitorId: schema.competitorPages.competitorId,
      url: schema.competitorPages.url,
      path: schema.competitorPages.path,
      title: schema.competitorPages.title,
      metaDescription: schema.competitorPages.metaDescription,
      h1: schema.competitorPages.h1,
      h2sJson: schema.competitorPages.h2sJson,
      wordCount: schema.competitorPages.wordCount,
      topic: schema.competitorPages.topic,
      fetchedAt: schema.competitorPages.fetchedAt,
      competitorName: schema.competitors.name,
      isSelf: schema.competitors.isSelf,
    })
    .from(schema.competitorPages)
    .innerJoin(schema.competitors, eq(schema.competitors.id, schema.competitorPages.competitorId))
    .orderBy(asc(schema.competitorPages.competitorId), asc(schema.competitorPages.id))
    .all()
    .map((r) => ({
      id: r.id,
      competitorId: r.competitorId,
      url: r.url,
      path: r.path,
      title: r.title,
      metaDescription: r.metaDescription,
      h1: r.h1,
      h2s: parseJsonStringArray(r.h2sJson ?? "[]"),
      wordCount: r.wordCount,
      topic: r.topic,
      fetchedAt: r.fetchedAt.getTime(),
      competitorName: r.competitorName,
      isSelf: r.isSelf,
    }));
}
