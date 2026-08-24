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

const DETAILS_URL = (placeId: string) => `https://places.googleapis.com/v1/places/${placeId}`;
const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { schema } = requireLocal("../db") as typeof import("../db");
  const { upsertCompetitor, listCompetitors, appendMetric, latestMetric, listEvents } =
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

  console.log(`\nrefresh: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
