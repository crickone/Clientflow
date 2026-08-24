// Run: npm test -- src/lib/research/refresh.test.ts
//
// Task 7 (Market Research P1) tests for lib/research/refresh.ts — the weekly
// per-tenant refresh runner. This is orchestration over the already-tested
// engine (places/spend/store/changeDetect/discovery, Tasks 1-6), so the
// value here is the LOOP semantics, not re-proving each piece:
//
//   1. prev-then-append ordering: a rating change between a pre-seeded
//      "previous" metric and the newly-fetched one produces a change event
//      (which is only possible if `latestMetric` was read BEFORE the new
//      snapshot was appended -- reading it after would diff the new capture
//      against itself and never find a delta).
//   2. rating -> ratingMilli conversion (Math.round(rating*1000)) and the
//      null-passthrough for an unrated place, for both the competitor's own
//      rating and each individual review's rating.
//   3. partial-failure resilience: one competitor's placeDetails HTTP
//      failure does not stop the rest of the watchlist, and is never
//      charged (spend on success only, same rule as T5's discovery fix).
//   4. the research-spend cap as a clean, soft loop-break (not an error
//      result) when it's already reached before the snapshot loop starts.
//   5. `!placesConfigured()` -> `{ok:false,error:"not_configured"}`, checked
//      before the tenant/network are ever touched.
//   6. (bonus) the default-on re-discovery step: a discovery failure is
//      logged and does NOT abort the refresh -- the snapshot loop still
//      runs over the existing watchlist.
//
// Covered end-to-end against a REAL scratch-tenant SQLite file (not mocked
// -- same reasoning as store.test.ts/discovery.test.ts) with `fetch` mocked
// exactly like places.test.ts (save/restore globalThis.fetch; zero live
// network calls). Every scenario gets its OWN scratch tenant so
// research_usage/tenant_research_cap/the watchlist can never bleed between
// scenarios.
//
// ./refresh -> ./discovery/./store -> @/lib/db (the ambient `db` proxy) ->
// @/lib/db/tenant (react `cache`) and -> @/lib/tenants -> @/lib/auth ->
// next/navigation. Same two-part Module._load shim as store.test.ts/
// discovery.test.ts (see either file's comment for the full "why") --
// installed before any static import of the modules under test would be
// hoisted past it, so everything below is a dynamic `requireLocal(...)`
// instead.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in refresh.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

type FetchCall = { url: string; init?: RequestInit };

/** Same technique as places.test.ts/discovery.test.ts: swap globalThis.fetch for the duration of `fn`, recording every call, restoring even if `fn` throws. */
async function withMockFetch<T>(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>,
  fn: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return impl(String(url), init);
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** Sets GOOGLE_PLACES_API_KEY for the duration of `fn`, restoring it after -- `undefined` deletes it entirely. */
async function withApiKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const original = process.env.GOOGLE_PLACES_API_KEY;
  if (value === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
  else process.env.GOOGLE_PLACES_API_KEY = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.GOOGLE_PLACES_API_KEY;
    else process.env.GOOGLE_PLACES_API_KEY = original;
  }
}

/**
 * Sets META_AD_LIBRARY_TOKEN for the duration of `fn`, restoring it after --
 * `undefined` deletes it entirely (used to explicitly PROVE the "no token"
 * scenario 6 rather than merely relying on it being unset by default in this
 * process — same hermeticity reasoning as withApiKey above).
 */
async function withAdLibraryToken<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const original = process.env.META_AD_LIBRARY_TOKEN;
  if (value === undefined) delete process.env.META_AD_LIBRARY_TOKEN;
  else process.env.META_AD_LIBRARY_TOKEN = value;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.META_AD_LIBRARY_TOKEN;
    else process.env.META_AD_LIBRARY_TOKEN = original;
  }
}

const DETAILS_URL = (placeId: string) => `https://places.googleapis.com/v1/places/${placeId}`;
const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const AD_LIBRARY_URL_BASE = "https://graph.facebook.com/v21.0/ads_archive";

/** Matches an ads_archive mock-fetch URL to the competitor `name` it was searched for (via the `search_terms` query param), mirroring adLibrary.test.ts's own request-shape checks. */
function isAdLibraryCallFor(url: string, name: string): boolean {
  return url.startsWith(AD_LIBRARY_URL_BASE) && url.includes(`search_terms=${encodeURIComponent(name)}`);
}

/** Exact Page-ID ad matching (Task 1) counterpart to isAdLibraryCallFor above -- matches a mock-fetch URL to the `pageId` it was searched for via the `search_page_ids` query param. */
function isAdLibraryCallForPageId(url: string, pageId: string): boolean {
  return (
    url.startsWith(AD_LIBRARY_URL_BASE) &&
    url.includes(`search_page_ids=${encodeURIComponent(JSON.stringify([pageId]))}`)
  );
}

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { schema } = requireLocal("../db") as typeof import("../db");
  const { upsertCompetitor, listCompetitors, appendMetric, latestMetric, listEvents, upsertAd, listAds, setCompetitorFacebookPage } =
    requireLocal("./store") as typeof import("./store");
  const { setKey } = requireLocal("../settings") as typeof import("../settings");
  const { researchSpentCents, UNIT_COST_CENTS } = requireLocal("./spend") as typeof import("./spend");
  const { refreshTenant } = requireLocal("./refresh") as typeof import("./refresh");

  function makeScratchTenant(slug: string): number {
    const dbFile = `tenants/${slug}/${slug}.db`;
    controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
    const t = controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
      .get(slug, slug, dbFile) as { id: number };
    return t.id;
  }

  function cleanupScratchTenant(slug: string, tid: number): void {
    controlSqlite.prepare("DELETE FROM research_usage WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenant_research_cap WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  /** Seeds the `research_centre` KV cache directly, bypassing geocodeAddress entirely (mirrors discovery.test.ts's cacheCentre). */
  function cacheCentre(tid: number, lat: number, lng: number): void {
    runWithTenant(tid, () => setKey("research_centre", { lat, lng, geocodedAt: "2026-08-01T00:00:00.000Z" }));
  }

  function reviewRowsFor(tid: number, competitorId: number) {
    return getTenantDbById(tid)
      .select()
      .from(schema.competitorReviews)
      .all()
      .filter((r) => r.competitorId === competitorId);
  }

  // ════════════════════════════════════════════════════════════════════
  // 1. Happy path: 2 tracked competitors, mocked details ok.
  //    - refreshed === 2, reviews replaced for both.
  //    - Competitor A has a PRE-SEEDED prev metric with a lower rating +
  //      review count than the mocked "next" -> proves prev is read BEFORE
  //      appendMetric (a rating_up AND a review_spike event fire) and
  //      proves the rating*1000 conversion (4.3 -> 4300) + a review's own
  //      rating conversion (5 -> 5000) + a review's missing rating -> null.
  //    - Competitor B has NO prior metric (first-ever capture: no event)
  //      and NO rating/reviewCount in Google's response at all -> proves
  //      the `== null` -> null passthrough (not 0).
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-key", async () => {
    const slug = "refresh-test-happy";
    const tid = makeScratchTenant(slug);
    try {
      const idA = runWithTenant(tid, () =>
        upsertCompetitor({
          placeId: "place-a",
          name: "Gym A",
          address: "1 A St, Clonmel",
          lat: 52.351,
          lng: -7.701,
          distanceKm: 1.0,
        }),
      );
      const idB = runWithTenant(tid, () =>
        upsertCompetitor({
          placeId: "place-b",
          name: "Gym B",
          address: "2 B St, Clonmel",
          lat: 52.36,
          lng: -7.71,
          distanceKm: 2.0,
        }),
      );
      // Competitor A's "previous" weekly capture -- rating 4.0, 50 reviews.
      runWithTenant(tid, () => appendMetric(idA, 4000, 50, "2026-08-01T00:00:00.000Z"));

      await withMockFetch(
        (url) => {
          if (url === DETAILS_URL("place-a")) {
            return new Response(
              JSON.stringify({
                id: "place-a",
                displayName: { text: "Gym A" },
                formattedAddress: "1 A St, Clonmel",
                rating: 4.3,
                userRatingCount: 65,
                reviews: [
                  {
                    name: "places/place-a/reviews/r1",
                    authorAttribution: { displayName: "Sam" },
                    rating: 5,
                    text: { text: "Great gym" },
                    publishTime: "2026-08-10T00:00:00Z",
                  },
                  {
                    name: "places/place-a/reviews/r2",
                    authorAttribution: { displayName: "Anon" },
                    // no rating, no publishTime -- both must round-trip as null
                    text: { text: "It was ok" },
                  },
                ],
              }),
              { status: 200 },
            );
          }
          if (url === DETAILS_URL("place-b")) {
            return new Response(
              JSON.stringify({
                id: "place-b",
                displayName: { text: "Gym B" },
                formattedAddress: "2 B St, Clonmel",
                // no rating, no userRatingCount, no reviews at all
              }),
              { status: 200 },
            );
          }
          throw new Error(`unexpected fetch: ${url}`);
        },
        async (calls) => {
          const before = researchSpentCents(tid);
          const result = await runWithTenant(tid, async () => refreshTenant({ rediscover: false }));

          check("happy path: ok:true", result.ok === true);
          if (result.ok) {
            check("happy path: refreshed === 2", result.refreshed === 2);
            check(
              "happy path: events === 2 (rating_up + review_spike for A; B is a first-ever capture, no event)",
              result.events === 2,
            );
          }

          check(
            "happy path: exactly 2 fetch calls, one per tracked competitor",
            calls.length === 2 && calls.some((c) => c.url === DETAILS_URL("place-a")) && calls.some((c) => c.url === DETAILS_URL("place-b")),
          );
          check("happy path: rediscover:false makes no geocode/nearby calls", !calls.some((c) => c.url === NEARBY_URL || c.url.startsWith(GEOCODE_URL)));

          const after = researchSpentCents(tid);
          check(
            "happy path: spend charged exactly once per successful details call",
            after - before === 2 * UNIT_COST_CENTS.details,
          );

          const latestA = runWithTenant(tid, () => latestMetric(idA))!;
          check("happy path: A's rating converts 4.3 -> ratingMilli 4300", latestA.ratingMilli === 4300);
          check("happy path: A's reviewCount <- Google's userRatingCount", latestA.reviewCount === 65);
          check("happy path: A's capturedAt moved on from the pre-seeded prev", latestA.capturedAt !== "2026-08-01T00:00:00.000Z");

          const latestB = runWithTenant(tid, () => latestMetric(idB))!;
          check("happy path: B's missing rating -> ratingMilli null (not 0)", latestB.ratingMilli === null);
          check("happy path: B's missing userRatingCount -> reviewCount null (not 0)", latestB.reviewCount === null);

          const reviewsA = reviewRowsFor(tid, idA);
          check("happy path: A's reviews replaced -- 2 rows", reviewsA.length === 2);
          const r1 = reviewsA.find((r) => r.externalReviewId === "places/place-a/reviews/r1")!;
          check("happy path: review rating converts 5 -> ratingMilli 5000", r1.ratingMilli === 5000);
          check("happy path: review publishedAt <- publishTime", r1.publishedAt === "2026-08-10T00:00:00Z");
          const r2 = reviewsA.find((r) => r.externalReviewId === "places/place-a/reviews/r2")!;
          check("happy path: a review missing rating -> ratingMilli null", r2.ratingMilli === null);
          check("happy path: a review missing publishTime -> publishedAt null", r2.publishedAt === null);

          const reviewsB = reviewRowsFor(tid, idB);
          check("happy path: B's reviews replaced -- 0 rows (Google sent none)", reviewsB.length === 0);

          const events = runWithTenant(tid, () => listEvents());
          check(
            "happy path: a rating_up event fired for A (4.0 -> 4.3)",
            events.some((e) => e.competitorId === idA && e.type === "rating_up"),
          );
          check(
            "happy path: a review_spike event fired for A (50 -> 65, delta 15 >= 10)",
            events.some((e) => e.competitorId === idA && e.type === "review_spike"),
          );
          check(
            "happy path: no event fired for B (first-ever capture, no prev to diff against)",
            !events.some((e) => e.competitorId === idB),
          );

          const rowA = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idA)!;
          const rowB = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idB)!;
          check("happy path: touchRefreshed set A's lastRefreshedAt", rowA.lastRefreshedAt === latestA.capturedAt);
          check("happy path: touchRefreshed set B's lastRefreshedAt", rowB.lastRefreshedAt === latestB.capturedAt);
        },
      );
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 2. Partial-failure resilience: one competitor's placeDetails HTTP call
  //    fails -- the other is still processed, and the failed one is never
  //    charged. The failing competitor is nearer (processed FIRST, per
  //    listCompetitors' nearest-first ordering) specifically to prove a
  //    failure doesn't break the loop -- only the cap does.
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-key", async () => {
    const slug = "refresh-test-partial-fail";
    const tid = makeScratchTenant(slug);
    try {
      const idBad = runWithTenant(tid, () =>
        upsertCompetitor({
          placeId: "place-bad",
          name: "Flaky Gym",
          address: "1 Bad St",
          lat: 52.351,
          lng: -7.701,
          distanceKm: 0.5,
        }),
      );
      const idOk = runWithTenant(tid, () =>
        upsertCompetitor({
          placeId: "place-ok",
          name: "Reliable Gym",
          address: "2 Ok St",
          lat: 52.36,
          lng: -7.71,
          distanceKm: 1.5,
        }),
      );

      await withMockFetch(
        (url) => {
          if (url === DETAILS_URL("place-bad")) {
            return new Response("server error", { status: 500, statusText: "Internal Server Error" });
          }
          if (url === DETAILS_URL("place-ok")) {
            return new Response(
              JSON.stringify({
                id: "place-ok",
                displayName: { text: "Reliable Gym" },
                formattedAddress: "2 Ok St",
                rating: 4.1,
                userRatingCount: 20,
                reviews: [],
              }),
              { status: 200 },
            );
          }
          throw new Error(`unexpected fetch: ${url}`);
        },
        async (calls) => {
          const before = researchSpentCents(tid);
          const result = await runWithTenant(tid, async () => refreshTenant({ rediscover: false }));

          check("partial failure: ok:true (a per-competitor failure is not a whole-run failure)", result.ok === true);
          if (result.ok) {
            check("partial failure: refreshed === 1 (only the succeeding competitor)", result.refreshed === 1);
          }
          check("partial failure: BOTH competitors were attempted", calls.length === 2);

          const after = researchSpentCents(tid);
          check(
            "partial failure: spend charged ONLY for the successful call (charge on success only)",
            after - before === UNIT_COST_CENTS.details,
          );

          check("partial failure: the failed competitor has no new metric", runWithTenant(tid, () => latestMetric(idBad)) === null);
          const latestOk = runWithTenant(tid, () => latestMetric(idOk))!;
          check("partial failure: the successful competitor's metric was recorded", latestOk.ratingMilli === 4100 && latestOk.reviewCount === 20);

          const rowBad = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idBad)!;
          const rowOk = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idOk)!;
          check("partial failure: the failed competitor's lastRefreshedAt is untouched", rowBad.lastRefreshedAt === null);
          check("partial failure: the successful competitor's lastRefreshedAt was set", rowOk.lastRefreshedAt !== null);
        },
      );
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 3. Cap already reached before the snapshot loop starts -> a clean,
  //    soft break (ok:true with counts so far), never an error result.
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-key", async () => {
    const slug = "refresh-test-cap";
    const tid = makeScratchTenant(slug);
    try {
      const idX = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "place-x", name: "Gym X", address: "1 X St", lat: 52.351, lng: -7.701, distanceKm: 0.5 }),
      );
      const idY = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "place-y", name: "Gym Y", address: "2 Y St", lat: 52.36, lng: -7.71, distanceKm: 1.5 }),
      );
      controlSqlite
        .prepare(
          "INSERT INTO tenant_research_cap (tenant_id, cap_cents) VALUES (?, 0) ON CONFLICT(tenant_id) DO UPDATE SET cap_cents = excluded.cap_cents",
        )
        .run(tid);

      await withMockFetch(
        () => {
          throw new Error("fetch must not be called once the research cap is already reached");
        },
        async (calls) => {
          const result = await runWithTenant(tid, async () => refreshTenant({ rediscover: false }));
          check("cap reached: ok:true (a soft stop, not an error)", result.ok === true);
          if (result.ok) {
            check("cap reached: refreshed === 0", result.refreshed === 0);
            check("cap reached: events === 0", result.events === 0);
          }
          check("cap reached: zero fetch calls (breaks before the first placeDetails call)", calls.length === 0);
          check("cap reached: neither competitor got a metric", runWithTenant(tid, () => latestMetric(idX)) === null && runWithTenant(tid, () => latestMetric(idY)) === null);
        },
      );
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 4. Not configured -> {ok:false,"not_configured"}, checked before the
  //    tenant or network are ever touched (no runWithTenant wrapper at all
  //    -- a bug that reordered the checks would throw TenantResolutionError
  //    instead, which this test would also catch via the error string).
  // ════════════════════════════════════════════════════════════════════
  await withApiKey(undefined, async () => {
    await withMockFetch(
      () => {
        throw new Error("fetch must not be called when Places is not configured");
      },
      async (calls) => {
        const result = await refreshTenant();
        check("not_configured: ok:false", result.ok === false && result.error === "not_configured");
        check("not_configured: zero fetch calls", calls.length === 0);
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // 5. (bonus) Default rediscover:true runs discovery first; a discovery
  //    failure is logged and does NOT abort the refresh -- the snapshot
  //    loop still runs over the existing watchlist.
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-key", async () => {
    const slug = "refresh-test-rediscover-fail";
    const tid = makeScratchTenant(slug);
    try {
      cacheCentre(tid, 52.35, -7.7);
      const idA = runWithTenant(tid, () =>
        upsertCompetitor({ placeId: "place-a", name: "Gym A", address: "1 A St", lat: 52.351, lng: -7.701, distanceKm: 1.0 }),
      );

      await withMockFetch(
        (url) => {
          if (url === NEARBY_URL) return new Response("quota exceeded", { status: 429, statusText: "Too Many Requests" });
          if (url === DETAILS_URL("place-a")) {
            return new Response(
              JSON.stringify({ id: "place-a", displayName: { text: "Gym A" }, formattedAddress: "1 A St", reviews: [] }),
              { status: 200 },
            );
          }
          throw new Error(`unexpected fetch: ${url}`);
        },
        async (calls) => {
          const result = await runWithTenant(tid, async () => refreshTenant());
          check("rediscover-fail: ok:true (discovery failure does not abort the refresh)", result.ok === true);
          if (result.ok) check("rediscover-fail: the snapshot loop still ran (refreshed === 1)", result.refreshed === 1);
          check(
            "rediscover-fail: default rediscover:true DID call nearby before the details loop",
            calls.length === 2 && calls[0].url === NEARBY_URL && calls[1].url === DETAILS_URL("place-a"),
          );
        },
      );
      const idOnly = runWithTenant(tid, () => listCompetitors());
      check("rediscover-fail: discovery's failure added no new competitors, existing one untouched", idOnly.length === 1 && idOnly[0].id === idA);
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  });

  // ════════════════════════════════════════════════════════════════════
  // 6. Task 4 (Market Research P2) -- competitor ad-fetch step.
  //    Token configured, one tracked non-self competitor. The mocked Ad
  //    Library search returns TWO ads: "keep-1" (already active from a
  //    PRE-SEEDED prior cycle, started long ago) and "fresh-1" (brand new,
  //    started a couple of days ago -- within the 30-day recency window).
  //    This proves several things at once:
  //     - the metrics/reviews loop still runs untouched (refreshed === 1)
  //     - a new_ad event fires for fresh-1 ONLY (singular phrasing)
  //     - "keep-1" raises NO event -- which only holds if `activeAdIds` was
  //       read BEFORE this cycle's upserts (reading it AFTER would make
  //       fresh-1 look "already known" and suppress the very event this
  //       test checks for -- see refresh.ts's doc comment)
  //     - the free Ad Library call adds ZERO extra spend (adlib = 0c)
  // ════════════════════════════════════════════════════════════════════
  await withAdLibraryToken("test-ad-token", async () => {
    await withApiKey("test-key", async () => {
      const slug = "refresh-test-ads-new";
      const tid = makeScratchTenant(slug);
      try {
        const compId = runWithTenant(tid, () =>
          upsertCompetitor({
            placeId: "place-iron",
            name: "Iron Gym",
            address: "1 Iron St, Clonmel",
            lat: 52.351,
            lng: -7.701,
            distanceKm: 1.0,
          }),
        );
        // Pre-seed "keep-1" as already-active from a PRIOR cycle -- old
        // startedAt (irrelevant to recency: it's already known, so it can
        // never be new_ad regardless of how its startedAt looks).
        runWithTenant(tid, () =>
          upsertAd(
            compId,
            {
              adId: "keep-1",
              bodies: [],
              platforms: [],
              snapshotUrl: "https://fb.example/keep-1",
              startedAt: "2020-01-01T00:00:00.000Z",
              pageName: "Iron Gym",
              pageId: "iron-gym-page-1",
            },
            "2020-01-02T00:00:00.000Z",
          ),
        );

        const recentIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

        await withMockFetch(
          (url) => {
            if (url === DETAILS_URL("place-iron")) {
              return new Response(
                JSON.stringify({ id: "place-iron", displayName: { text: "Iron Gym" }, formattedAddress: "1 Iron St, Clonmel", reviews: [] }),
                { status: 200 },
              );
            }
            if (isAdLibraryCallFor(url, "Iron Gym")) {
              return new Response(
                JSON.stringify({
                  data: [
                    {
                      id: "keep-1",
                      ad_snapshot_url: "https://fb.example/keep-1",
                      ad_delivery_start_time: "2020-01-01T00:00:00Z",
                      page_name: "Iron Gym",
                    },
                    {
                      id: "fresh-1",
                      ad_creative_bodies: ["50% off your first month"],
                      publisher_platforms: ["facebook"],
                      ad_snapshot_url: "https://fb.example/fresh-1",
                      ad_delivery_start_time: recentIso,
                      page_name: "Iron Gym",
                    },
                    // Advertiser-page-match fix (the reported live bug,
                    // reproduced here): Meta's search_terms is a full-text
                    // search over ad COPY, so an entirely unrelated
                    // business's ad can ride along in `data[]` just because
                    // its text shares a word ("gym") with the competitor's
                    // name. This one must be filtered OUT before it ever
                    // reaches diffAds/upsertAd -- see the assertions below.
                    {
                      id: "unrelated-fitbit",
                      ad_creative_bodies: ["Track your health and fitness goals with the new Fitbit."],
                      publisher_platforms: ["facebook"],
                      ad_snapshot_url: "https://fb.example/unrelated-fitbit",
                      ad_delivery_start_time: recentIso,
                      page_name: "Fitbit",
                    },
                  ],
                }),
                { status: 200 },
              );
            }
            throw new Error(`unexpected fetch: ${url}`);
          },
          async (calls) => {
            const before = researchSpentCents(tid);
            const result = await runWithTenant(tid, async () => refreshTenant({ rediscover: false }));

            check("ads/new: ok:true", result.ok === true);
            if (result.ok) {
              check("ads/new: metrics loop unaffected -- refreshed === 1", result.refreshed === 1);
            }
            check(
              "ads/new: exactly 2 fetch calls (1 details + 1 ad-library)",
              calls.length === 2 && calls.some((c) => c.url === DETAILS_URL("place-iron")) && calls.some((c) => isAdLibraryCallFor(c.url, "Iron Gym")),
            );

            const after = researchSpentCents(tid);
            check(
              "ads/new: the free Ad Library call adds ZERO extra spend on top of the details charge",
              after - before === UNIT_COST_CENTS.details,
            );

            const ads = runWithTenant(tid, () => listAds(compId));
            check(
              "ads/new: only the 2 page-matched ads stored -- the unrelated Fitbit ad never reaches diffAds/upsertAd",
              ads.length === 2,
            );
            check(
              "ads/new: the advertiser-page-match filter drops unrelated-fitbit (page 'Fitbit' doesn't match competitor 'Iron Gym')",
              !ads.some((a) => a.adId === "unrelated-fitbit"),
            );
            const fresh = ads.find((a) => a.adId === "fresh-1")!;
            check("ads/new: fresh-1 upserted + active", !!fresh && fresh.active === true);
            check("ads/new: fresh-1's startedAt round-trips", fresh.startedAt === recentIso);
            check("ads/new: fresh-1's bodies round-trip", fresh.bodies.length === 1 && fresh.bodies[0] === "50% off your first month");
            check("ads/new: fresh-1's pageName round-trips (shown on the AdCard as 'by Iron Gym')", fresh.pageName === "Iron Gym");
            const keep = ads.find((a) => a.adId === "keep-1")!;
            check("ads/new: keep-1 still active (present in this cycle's results too)", !!keep && keep.active === true);

            const events = runWithTenant(tid, () => listEvents());
            const newAdEvents = events.filter((e) => e.competitorId === compId && e.type === "new_ad");
            check("ads/new: exactly one new_ad event", newAdEvents.length === 1);
            check("ads/new: singular phrasing (only fresh-1 qualifies)", newAdEvents[0]?.summary === "Iron Gym launched a new ad");
            const detail = JSON.parse(newAdEvents[0]!.detailJson!) as { ads: { adId: string }[] };
            check(
              "ads/new: new_ad detailJson names fresh-1 only, NOT keep-1 (proves activeAdIds was read BEFORE the upsert)",
              detail.ads.length === 1 && detail.ads[0].adId === "fresh-1",
            );
            check(
              "ads/new: no ad_stopped noise (keep-1 is still present/active)",
              !events.some((e) => e.competitorId === compId && e.type === "ad_stopped"),
            );
          },
        );
      } finally {
        cleanupScratchTenant(slug, tid);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 7. Task 4 -- a competitor's previously-active ad vanishes from this
  //    cycle's Ad Library results -> ad_stopped event + markAdsStopped
  //    (active flips false, stoppedAt gets stamped).
  // ════════════════════════════════════════════════════════════════════
  await withAdLibraryToken("test-ad-token", async () => {
    await withApiKey("test-key", async () => {
      const slug = "refresh-test-ads-stopped";
      const tid = makeScratchTenant(slug);
      try {
        const compId = runWithTenant(tid, () =>
          upsertCompetitor({
            placeId: "place-oldschool",
            name: "Old School Gym",
            address: "1 Old St, Clonmel",
            lat: 52.351,
            lng: -7.701,
            distanceKm: 1.0,
          }),
        );
        runWithTenant(tid, () =>
          upsertAd(
            compId,
            {
              adId: "gone-1",
              bodies: [],
              platforms: [],
              snapshotUrl: "https://fb.example/gone-1",
              startedAt: "2026-01-01T00:00:00.000Z",
              pageName: "Old School Gym",
              pageId: "old-school-page-1",
            },
            "2026-01-02T00:00:00.000Z",
          ),
        );

        await withMockFetch(
          (url) => {
            if (url === DETAILS_URL("place-oldschool")) {
              return new Response(
                JSON.stringify({ id: "place-oldschool", displayName: { text: "Old School Gym" }, formattedAddress: "1 Old St, Clonmel", reviews: [] }),
                { status: 200 },
              );
            }
            if (isAdLibraryCallFor(url, "Old School Gym")) {
              return new Response(JSON.stringify({ data: [] }), { status: 200 }); // the ad is gone
            }
            throw new Error(`unexpected fetch: ${url}`);
          },
          async () => {
            const result = await runWithTenant(tid, async () => refreshTenant({ rediscover: false }));
            check("ads/stopped: ok:true", result.ok === true);

            const ads = runWithTenant(tid, () => listAds(compId));
            const gone = ads.find((a) => a.adId === "gone-1")!;
            check("ads/stopped: markAdsStopped flipped active to false", !!gone && gone.active === false);
            check("ads/stopped: stoppedAt was stamped", gone.stoppedAt !== null);

            const events = runWithTenant(tid, () => listEvents());
            const stoppedEvents = events.filter((e) => e.competitorId === compId && e.type === "ad_stopped");
            check("ads/stopped: exactly one ad_stopped event", stoppedEvents.length === 1);
            check("ads/stopped: singular phrasing", stoppedEvents[0]?.summary === "Old School Gym stopped an ad");
            const detail = JSON.parse(stoppedEvents[0]!.detailJson!) as { adIds: string[] };
            check("ads/stopped: detailJson names gone-1", detail.adIds.length === 1 && detail.adIds[0] === "gone-1");
            check(
              "ads/stopped: no new_ad noise",
              !events.some((e) => e.competitorId === compId && e.type === "new_ad"),
            );
          },
        );
      } finally {
        cleanupScratchTenant(slug, tid);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 8. Task 4 -- per-competitor resilience: one competitor's
  //    searchCompetitorAds 429s, the OTHER is still fetched/upserted. The
  //    metrics loop for BOTH still succeeds (refreshed === 2), proving the
  //    ad step's failure is fully contained and doesn't touch it.
  // ════════════════════════════════════════════════════════════════════
  await withAdLibraryToken("test-ad-token", async () => {
    await withApiKey("test-key", async () => {
      const slug = "refresh-test-ads-429";
      const tid = makeScratchTenant(slug);
      try {
        const idBad = runWithTenant(tid, () =>
          upsertCompetitor({ placeId: "place-ads-bad", name: "Flaky Ads Gym", address: "1 Bad Ads St", lat: 52.351, lng: -7.701, distanceKm: 0.5 }),
        );
        const idOk = runWithTenant(tid, () =>
          upsertCompetitor({ placeId: "place-ads-ok", name: "Steady Ads Gym", address: "2 Ok Ads St", lat: 52.36, lng: -7.71, distanceKm: 1.5 }),
        );

        const recentIso = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

        await withMockFetch(
          (url) => {
            if (url === DETAILS_URL("place-ads-bad")) {
              return new Response(
                JSON.stringify({ id: "place-ads-bad", displayName: { text: "Flaky Ads Gym" }, formattedAddress: "1 Bad Ads St", reviews: [] }),
                { status: 200 },
              );
            }
            if (url === DETAILS_URL("place-ads-ok")) {
              return new Response(
                JSON.stringify({ id: "place-ads-ok", displayName: { text: "Steady Ads Gym" }, formattedAddress: "2 Ok Ads St", reviews: [] }),
                { status: 200 },
              );
            }
            if (isAdLibraryCallFor(url, "Flaky Ads Gym")) {
              return new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
            }
            if (isAdLibraryCallFor(url, "Steady Ads Gym")) {
              return new Response(
                JSON.stringify({
                  data: [
                    {
                      id: "ok-ad-1",
                      ad_snapshot_url: "https://fb.example/ok-ad-1",
                      ad_delivery_start_time: recentIso,
                      page_name: "Steady Ads Gym",
                    },
                  ],
                }),
                { status: 200 },
              );
            }
            throw new Error(`unexpected fetch: ${url}`);
          },
          async (calls) => {
            const result = await runWithTenant(tid, async () => refreshTenant({ rediscover: false }));
            check("ads/429: ok:true (a per-competitor ad-fetch failure is not a whole-run failure)", result.ok === true);
            if (result.ok) {
              check("ads/429: BOTH competitors' metrics still refreshed", result.refreshed === 2);
            }
            check(
              "ads/429: both competitors' Ad Library search was attempted",
              calls.some((c) => isAdLibraryCallFor(c.url, "Flaky Ads Gym")) && calls.some((c) => isAdLibraryCallFor(c.url, "Steady Ads Gym")),
            );

            check("ads/429: the failing competitor has NO ad rows", runWithTenant(tid, () => listAds(idBad)).length === 0);
            const okAds = runWithTenant(tid, () => listAds(idOk));
            check("ads/429: the succeeding competitor's ad WAS upserted", okAds.length === 1 && okAds[0].adId === "ok-ad-1");

            const events = runWithTenant(tid, () => listEvents());
            check(
              "ads/429: a new_ad event fired for the succeeding competitor",
              events.some((e) => e.competitorId === idOk && e.type === "new_ad"),
            );
            check(
              "ads/429: no ad event at all for the failing competitor",
              !events.some((e) => e.competitorId === idBad && (e.type === "new_ad" || e.type === "ad_stopped")),
            );
          },
        );
      } finally {
        cleanupScratchTenant(slug, tid);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 9. Task 4 -- no META_AD_LIBRARY_TOKEN -> the entire ad step is skipped
  //    (fail-soft, zero ad-library fetch calls, zero ad rows), while the
  //    metrics/reviews loop still refreshes normally.
  // ════════════════════════════════════════════════════════════════════
  await withAdLibraryToken(undefined, async () => {
    await withApiKey("test-key", async () => {
      const slug = "refresh-test-ads-no-token";
      const tid = makeScratchTenant(slug);
      try {
        const compId = runWithTenant(tid, () =>
          upsertCompetitor({ placeId: "place-no-token", name: "No Token Gym", address: "1 No Token St", lat: 52.351, lng: -7.701, distanceKm: 1.0 }),
        );

        await withMockFetch(
          (url) => {
            if (url === DETAILS_URL("place-no-token")) {
              return new Response(
                JSON.stringify({ id: "place-no-token", displayName: { text: "No Token Gym" }, formattedAddress: "1 No Token St", reviews: [] }),
                { status: 200 },
              );
            }
            throw new Error(`unexpected fetch (ad step must be skipped entirely with no token): ${url}`);
          },
          async (calls) => {
            const result = await runWithTenant(tid, async () => refreshTenant({ rediscover: false }));
            check("ads/no-token: ok:true", result.ok === true);
            if (result.ok) {
              check("ads/no-token: metrics loop still refreshes normally", result.refreshed === 1);
            }
            check("ads/no-token: exactly 1 fetch call (details only -- zero ad-library calls)", calls.length === 1);
            check("ads/no-token: zero ad rows stored", runWithTenant(tid, () => listAds(compId)).length === 0);
            check(
              "ads/no-token: no ad events raised",
              !runWithTenant(tid, () => listEvents()).some((e) => e.competitorId === compId && (e.type === "new_ad" || e.type === "ad_stopped")),
            );
          },
        );
      } finally {
        cleanupScratchTenant(slug, tid);
      }
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // 10. Exact Page-ID ad matching (Task 1) -- a competitor LINKED to a
  //     Facebook Page (facebookPageId set via setCompetitorFacebookPage) is
  //     fetched via search_page_ids and its ads are stored DIRECTLY, with NO
  //     adPageMatchesCompetitor name filter -- proven by an ad whose
  //     page_name would FAIL the name filter (it shares no token with the
  //     competitor's name) still getting stored for the LINKED competitor.
  //     A second, UNLINKED competitor in the same run keeps the original
  //     search_terms + name-filter path -- its equivalent mismatched-name ad
  //     is correctly dropped, proving the routing is per-competitor, not
  //     global.
  // ════════════════════════════════════════════════════════════════════
  await withAdLibraryToken("test-ad-token", async () => {
    await withApiKey("test-key", async () => {
      const slug = "refresh-test-pageid-exact";
      const tid = makeScratchTenant(slug);
      try {
        const idLinked = runWithTenant(tid, () =>
          upsertCompetitor({
            placeId: "place-linked",
            name: "Linked Gym",
            address: "1 Linked St, Clonmel",
            lat: 52.351,
            lng: -7.701,
            distanceKm: 1.0,
          }),
        );
        runWithTenant(tid, () => setCompetitorFacebookPage(idLinked, "999888777", "Linked Gym Official"));

        const idUnlinked = runWithTenant(tid, () =>
          upsertCompetitor({
            placeId: "place-unlinked",
            name: "Unlinked Gym",
            address: "2 Unlinked St, Clonmel",
            lat: 52.36,
            lng: -7.71,
            distanceKm: 2.0,
          }),
        );

        const recentIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

        await withMockFetch(
          (url) => {
            if (url === DETAILS_URL("place-linked")) {
              return new Response(
                JSON.stringify({
                  id: "place-linked",
                  displayName: { text: "Linked Gym" },
                  formattedAddress: "1 Linked St, Clonmel",
                  reviews: [],
                }),
                { status: 200 },
              );
            }
            if (url === DETAILS_URL("place-unlinked")) {
              return new Response(
                JSON.stringify({
                  id: "place-unlinked",
                  displayName: { text: "Unlinked Gym" },
                  formattedAddress: "2 Unlinked St, Clonmel",
                  reviews: [],
                }),
                { status: 200 },
              );
            }
            if (isAdLibraryCallForPageId(url, "999888777")) {
              return new Response(
                JSON.stringify({
                  data: [
                    {
                      id: "exact-1",
                      ad_creative_bodies: ["Some generic seasonal promo copy"],
                      publisher_platforms: ["facebook"],
                      ad_snapshot_url: "https://fb.example/exact-1",
                      ad_delivery_start_time: recentIso,
                      // Deliberately a page_name that would FAIL
                      // adPageMatchesCompetitor("Totally Different Brand",
                      // "Linked Gym") -- proves the linked path stores it
                      // anyway because the name filter is skipped entirely.
                      page_name: "Totally Different Brand",
                      page_id: "999888777",
                    },
                  ],
                }),
                { status: 200 },
              );
            }
            if (isAdLibraryCallFor(url, "Unlinked Gym")) {
              return new Response(
                JSON.stringify({
                  data: [
                    {
                      id: "mismatched-1",
                      ad_creative_bodies: ["Unrelated ad copy"],
                      publisher_platforms: ["facebook"],
                      ad_snapshot_url: "https://fb.example/mismatched-1",
                      ad_delivery_start_time: recentIso,
                      // Same "unrelated brand" page_name -- for the UNLINKED
                      // competitor this must still be filtered OUT (the
                      // original adPageMatchesCompetitor path is untouched).
                      page_name: "Totally Different Brand",
                    },
                  ],
                }),
                { status: 200 },
              );
            }
            throw new Error(`unexpected fetch: ${url}`);
          },
          async (calls) => {
            const before = researchSpentCents(tid);
            const result = await runWithTenant(tid, async () => refreshTenant({ rediscover: false }));

            check("pageid-exact: ok:true", result.ok === true);
            if (result.ok) {
              check("pageid-exact: metrics loop unaffected -- refreshed === 2", result.refreshed === 2);
            }

            check(
              "pageid-exact: the linked competitor was fetched via search_page_ids",
              calls.some((c) => isAdLibraryCallForPageId(c.url, "999888777")),
            );
            check(
              "pageid-exact: the linked competitor was NOT fetched via search_terms",
              !calls.some((c) => isAdLibraryCallFor(c.url, "Linked Gym")),
            );
            check(
              "pageid-exact: the unlinked competitor was still fetched via search_terms (original path unchanged)",
              calls.some((c) => isAdLibraryCallFor(c.url, "Unlinked Gym")),
            );

            const after = researchSpentCents(tid);
            check(
              "pageid-exact: both free Ad Library calls (page-id + name) add ZERO extra spend on top of the two details charges",
              after - before === 2 * UNIT_COST_CENTS.details,
            );

            const linkedAds = runWithTenant(tid, () => listAds(idLinked));
            check(
              "pageid-exact: the linked competitor's ad is stored even though its page_name would fail the name filter (filter skipped on the linked path)",
              linkedAds.length === 1 && linkedAds[0].adId === "exact-1",
            );
            check(
              "pageid-exact: the stored ad's pageName round-trips verbatim (not re-checked against the competitor's own name)",
              linkedAds[0].pageName === "Totally Different Brand",
            );

            const unlinkedAds = runWithTenant(tid, () => listAds(idUnlinked));
            check(
              "pageid-exact: the unlinked competitor's mismatched-page-name ad is correctly filtered OUT (original path unchanged)",
              unlinkedAds.length === 0,
            );
          },
        );
      } finally {
        cleanupScratchTenant(slug, tid);
      }
    });
  });

  console.log(`\nrefresh: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
