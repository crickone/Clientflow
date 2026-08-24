// Run: npm test -- src/lib/research/discovery.test.ts
//
// Task 5 (Market Research P1) tests for lib/research/discovery.ts. Two parts:
//
//  1. partitionNearby — the pure radius-filter + new-vs-existing-diff helper
//     — tested directly with plain literals, no shim or mocking needed at
//     all (same style as distance.test.ts: it's pure arithmetic over its
//     arguments).
//  2. discoverCompetitors / getResearchCentre — the thin orchestration built
//     on top of it. Covered end-to-end against a REAL scratch-tenant SQLite
//     file (not mocked — same reasoning as store.test.ts) with `fetch`
//     mocked exactly like places.test.ts (save/restore globalThis.fetch;
//     zero live network calls). Every scenario gets its OWN scratch tenant
//     so research_usage/tenant_research_cap/the watchlist/the cached centre
//     can never bleed between scenarios.
//
// ./discovery -> ./store -> @/lib/db (the ambient `db` proxy) -> @/lib/db/tenant
// (react `cache`) and -> @/lib/tenants -> @/lib/auth -> next/navigation. Same
// two-part Module._load shim as store.test.ts/campaigns.test.ts/forms.test.ts
// (see any of those files' comment for the full "why") — installed before any
// static import of the modules under test would be hoisted past it, so
// everything below is a dynamic `requireLocal(...)` instead.
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
        throw new Error("next/navigation.redirect() stub called unexpectedly in discovery.test.ts");
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

/** Same technique as places.test.ts: swap globalThis.fetch for the duration of `fn`, recording every call, restoring even if `fn` throws. */
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

/** Sets GOOGLE_PLACES_API_KEY for the duration of `fn`, restoring it after — `undefined` deletes it entirely. */
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

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { listCompetitors, listEvents } = requireLocal("./store") as typeof import("./store");
  const { setBusinessProfile } = requireLocal("../businessProfile") as typeof import("../businessProfile");
  const { setKey } = requireLocal("../settings") as typeof import("../settings");
  const { researchSpentCents, UNIT_COST_CENTS } = requireLocal("./spend") as typeof import("./spend");
  const { haversineKm } = requireLocal("./distance") as typeof import("./distance");
  const { partitionNearby, discoverCompetitors, getResearchCentre } = requireLocal("./discovery") as typeof import("./discovery");

  // ════════════════════════════════════════════════════════════════════
  // partitionNearby — pure: radius filter + new-vs-existing diff
  // ════════════════════════════════════════════════════════════════════
  {
    const centre = { lat: 52.35, lng: -7.7 };
    const near = { placeId: "near-1", name: "Near Gym", address: "1 Near St", lat: 52.351, lng: -7.701 };
    const far = { placeId: "far-1", name: "Far Gym", address: "1 Far St", lat: 53.0, lng: -7.0 };

    // fixture sanity, relative to a 5km radius used below
    check("fixture sanity: near < 5km from centre", haversineKm(centre, near) < 5);
    check("fixture sanity: far > 5km from centre", haversineKm(centre, far) > 5);

    const { kept, newPlaceIds } = partitionNearby([near, far], centre, 5, new Set());
    check("partitionNearby: drops the far place", kept.length === 1);
    check("partitionNearby: keeps the near place", kept[0]?.placeId === "near-1");
    check("partitionNearby: annotates the kept place with distanceKm", typeof kept[0]?.distanceKm === "number" && kept[0].distanceKm < 5);
    check("partitionNearby: distanceKm matches a direct haversineKm call", kept[0].distanceKm === haversineKm(centre, near));
    check("partitionNearby: a kept, unknown place is reported as new", newPlaceIds.has("near-1"));
    check("partitionNearby: a dropped (out-of-radius) place is never reported as new, even though it's also unknown", !newPlaceIds.has("far-1"));

    // an existing placeId is still kept if in radius, but not reported as new
    const { kept: kept2, newPlaceIds: new2 } = partitionNearby([near], centre, 5, new Set(["near-1"]));
    check("partitionNearby: an already-known placeId is still kept (radius filtering is independent of newness)", kept2.length === 1);
    check("partitionNearby: an already-known placeId is NOT reported as new", !new2.has("near-1"));

    // exact-boundary: distance == radiusKm is KEPT (<=, not <)
    const edgePlace = { placeId: "edge-1", name: "Edge Gym", address: "x", lat: 52.36, lng: -7.7 };
    const dEdge = haversineKm(centre, edgePlace);
    const { kept: keptAtBoundary } = partitionNearby([edgePlace], centre, dEdge, new Set());
    check("partitionNearby: a place exactly AT the radius boundary is kept (<=, not <)", keptAtBoundary.length === 1);
    const { kept: keptJustOverBoundary } = partitionNearby([edgePlace], centre, dEdge - 0.0001, new Set());
    check("partitionNearby: a place just OVER the radius boundary is dropped", keptJustOverBoundary.length === 0);

    // a duplicate placeId in the input still yields exactly one newPlaceIds entry (Set semantics) —
    // this is what makes the "raise the event only once per new competitor" guarantee hold.
    const dupe = { placeId: "dup-1", name: "Dup Gym", address: "x", lat: 52.351, lng: -7.701 };
    const { kept: keptDup, newPlaceIds: newDup } = partitionNearby([dupe, { ...dupe }], centre, 5, new Set());
    check("partitionNearby: a duplicate placeId still yields exactly ONE newPlaceIds entry", newDup.size === 1 && newDup.has("dup-1"));
    check("partitionNearby: both copies are independently kept -- the caller's Set-membership check is what dedupes the event, not `kept`", keptDup.length === 2);

    // empty input
    const emptyResult = partitionNearby([], centre, 5, new Set());
    check("partitionNearby: empty places -> empty kept + empty newPlaceIds", emptyResult.kept.length === 0 && emptyResult.newPlaceIds.size === 0);

    // rating/reviewCount pass through untouched alongside the new distanceKm field
    const rated = { placeId: "rated-1", name: "Rated Gym", address: "x", lat: 52.351, lng: -7.701, rating: 4.2, reviewCount: 88 };
    const { kept: keptRated } = partitionNearby([rated], centre, 5, new Set());
    check("partitionNearby: passes through rating unchanged", keptRated[0]?.rating === 4.2);
    check("partitionNearby: passes through reviewCount unchanged", keptRated[0]?.reviewCount === 88);
  }

  console.log(`\npartitionNearby: ${passed} checks passed so far.`);

  // ════════════════════════════════════════════════════════════════════
  // discoverCompetitors / getResearchCentre — orchestration, against a real
  // scratch tenant per scenario + a mocked `fetch`.
  // ════════════════════════════════════════════════════════════════════

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

  /** Seeds the `research_centre` KV cache directly, bypassing geocodeAddress entirely. */
  function cacheCentre(tid: number, lat: number, lng: number): void {
    runWithTenant(tid, () => setKey("research_centre", { lat, lng, geocodedAt: "2026-08-01T00:00:00.000Z" }));
  }

  const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
  const NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";

  // ── not_configured: short-circuits before touching the tenant or the network ──
  await withApiKey(undefined, async () => {
    await withMockFetch(
      () => {
        throw new Error("fetch must not be called when Places is not configured");
      },
      async (calls) => {
        const result = await discoverCompetitors();
        check("discoverCompetitors: not_configured", result.ok === false && result.error === "not_configured");
        check("discoverCompetitors: not_configured makes zero fetch calls", calls.length === 0);
      },
    );
  });

  // ── no_address: configured, but the tenant has no cached centre AND no business-profile address ──
  await withApiKey("test-key", async () => {
    const slug = "discovery-test-no-address";
    const tid = makeScratchTenant(slug);
    try {
      await withMockFetch(
        () => {
          throw new Error("fetch must not be called when there is no address to geocode");
        },
        async (calls) => {
          const result = await runWithTenant(tid, async () => discoverCompetitors());
          check("discoverCompetitors: no_address", result.ok === false && result.error === "no_address");
          check("discoverCompetitors: no_address makes zero fetch calls", calls.length === 0);
          const centre = await runWithTenant(tid, async () => getResearchCentre());
          check("getResearchCentre: still null after a no_address run (never geocoded, nothing cached)", centre === null);
        },
      );
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  });

  // ── first-time run: geocodes the business-profile address, caches the centre, charges both meters ──
  await withApiKey("test-key", async () => {
    const slug = "discovery-test-geocode";
    const tid = makeScratchTenant(slug);
    try {
      runWithTenant(tid, () =>
        setBusinessProfile({
          businessName: "Test Gym",
          tagline: "",
          location: "1 Main St, Clonmel, Co. Tipperary",
          phone: "",
          website: "",
          email: "",
          brief: "",
          voiceNotes: "",
          marketingBrain: "",
          policies: "",
          faqs: [],
        }),
      );

      await withMockFetch(
        (url) => {
          if (url.startsWith(GEOCODE_URL)) {
            return new Response(
              JSON.stringify({ status: "OK", results: [{ geometry: { location: { lat: 52.35, lng: -7.7 } } }] }),
              { status: 200 },
            );
          }
          if (url === NEARBY_URL) {
            return new Response(JSON.stringify({ places: [] }), { status: 200 });
          }
          throw new Error(`unexpected fetch: ${url}`);
        },
        async (calls) => {
          const before = researchSpentCents(tid);
          const result = await runWithTenant(tid, async () => discoverCompetitors());
          check("discoverCompetitors: geocodes + returns ok:true", result.ok === true);
          if (result.ok) {
            check("discoverCompetitors: centre <- the geocode result", result.centre.lat === 52.35 && result.centre.lng === -7.7);
            check("discoverCompetitors: count is 0 when Nearby returns no places", result.count === 0);
          }
          check(
            "discoverCompetitors: hits geocode THEN nearby, in that order",
            calls.length === 2 && calls[0].url.startsWith(GEOCODE_URL) && calls[1].url === NEARBY_URL,
          );

          const cached = await runWithTenant(tid, async () => getResearchCentre());
          check(
            "getResearchCentre: reads back the just-cached centre",
            cached !== null && cached.lat === 52.35 && cached.lng === -7.7,
          );

          const after = researchSpentCents(tid);
          check(
            "discoverCompetitors: charges BOTH geocode + nearby on a first-time (uncached) run",
            after - before === UNIT_COST_CENTS.geocode + UNIT_COST_CENTS.nearby,
          );
        },
      );
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  });

  // ── cached centre: skips geocode entirely; filters by radius; upserts + events only the new, in-radius place; a re-run doesn't re-raise the event ──
  await withApiKey("test-key", async () => {
    const slug = "discovery-test-happy-path";
    const tid = makeScratchTenant(slug);
    try {
      cacheCentre(tid, 52.35, -7.7);

      await withMockFetch(
        (url) => {
          if (url.startsWith(GEOCODE_URL)) throw new Error("geocode must not be called when the centre is already cached");
          if (url === NEARBY_URL) {
            return new Response(
              JSON.stringify({
                places: [
                  {
                    id: "place-near",
                    displayName: { text: "Iron Gym Clonmel" },
                    formattedAddress: "1 Near St, Clonmel",
                    location: { latitude: 52.351, longitude: -7.701 },
                  },
                  {
                    id: "place-far",
                    displayName: { text: "Far Away Fitness" },
                    formattedAddress: "1 Far St",
                    location: { latitude: 53.0, longitude: -7.0 },
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
          const result = await runWithTenant(tid, async () => discoverCompetitors(5));
          check("discoverCompetitors: happy path ok:true", result.ok === true);
          if (result.ok) {
            check("discoverCompetitors: filters the far place, keeps + counts only the near one", result.count === 1);
            check("discoverCompetitors: centre <- the cached value", result.centre.lat === 52.35 && result.centre.lng === -7.7);
          }
          check("discoverCompetitors: only ONE fetch call (nearby) — geocode skipped", calls.length === 1 && calls[0].url === NEARBY_URL);

          const after = researchSpentCents(tid);
          check("discoverCompetitors: only nearby spend recorded (no geocode charge)", after - before === UNIT_COST_CENTS.nearby);

          const watchlist = runWithTenant(tid, () => listCompetitors());
          check(
            "discoverCompetitors: upserts exactly the one in-radius place",
            watchlist.length === 1 && watchlist[0].placeId === "place-near",
          );
          check(
            "discoverCompetitors: upserted with source google / addedBy auto",
            watchlist[0].source === "google" && watchlist[0].addedBy === "auto",
          );
          check("discoverCompetitors: the out-of-radius place was never upserted", !watchlist.some((c) => c.placeId === "place-far"));

          const events = runWithTenant(tid, () => listEvents());
          check(
            "discoverCompetitors: exactly one new_competitor event, for the kept place only",
            events.length === 1 && events[0].type === "new_competitor",
          );
          check(
            "discoverCompetitors: event summary names the gym + its distance",
            events[0].summary.startsWith("New gym nearby: Iron Gym Clonmel (") && events[0].summary.endsWith("km)"),
          );
          check("discoverCompetitors: event carries no competitorId", events[0].competitorId === null);
        },
      );

      // Re-running with the same place already on the watchlist must NOT re-raise the event.
      await withMockFetch(
        (url) => {
          if (url === NEARBY_URL) {
            return new Response(
              JSON.stringify({
                places: [
                  {
                    id: "place-near",
                    displayName: { text: "Iron Gym Clonmel" },
                    formattedAddress: "1 Near St, Clonmel",
                    location: { latitude: 52.351, longitude: -7.701 },
                  },
                ],
              }),
              { status: 200 },
            );
          }
          throw new Error(`unexpected fetch: ${url}`);
        },
        async () => {
          const result = await runWithTenant(tid, async () => discoverCompetitors(5));
          check("discoverCompetitors: re-run ok:true", result.ok === true);
          if (result.ok) check("discoverCompetitors: re-run still counts the (now pre-existing) place", result.count === 1);
          const events = runWithTenant(tid, () => listEvents());
          check("discoverCompetitors: re-discovering an already-known place raises NO new event", events.length === 1);
        },
      );
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  });

  // ── nearbyGyms failure propagates verbatim; spend is still recorded (a request Google received) ──
  await withApiKey("test-key", async () => {
    const slug = "discovery-test-nearby-fail";
    const tid = makeScratchTenant(slug);
    try {
      cacheCentre(tid, 52.35, -7.7);

      await withMockFetch(
        () => new Response("quota exceeded", { status: 429, statusText: "Too Many Requests" }),
        async () => {
          const before = researchSpentCents(tid);
          const result = await runWithTenant(tid, async () => discoverCompetitors());
          check("discoverCompetitors: nearbyGyms HTTP failure -> ok:false", result.ok === false);
          const after = researchSpentCents(tid);
          check(
            "discoverCompetitors: nearby spend is still recorded on failure",
            after - before === UNIT_COST_CENTS.nearby,
          );
        },
      );
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  });

  // ── cap_reached: a thrown ResearchCapError is caught, never thrown out ──
  await withApiKey("test-key", async () => {
    const slug = "discovery-test-cap";
    const tid = makeScratchTenant(slug);
    try {
      cacheCentre(tid, 52.35, -7.7);
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
          const result = await runWithTenant(tid, async () => discoverCompetitors());
          check("discoverCompetitors: cap_reached", result.ok === false && result.error === "cap_reached");
          check("discoverCompetitors: cap_reached makes zero fetch calls", calls.length === 0);
        },
      );
    } finally {
      cleanupScratchTenant(slug, tid);
    }
  });

  console.log(`\ndiscovery: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
