import "server-only";

import {
  placesConfigured,
  geocodeAddress,
  nearbyGyms,
  type PlaceLite,
} from "./places";
import { haversineKm, type LatLng } from "./distance";
import {
  assertUnderResearchCap,
  recordResearchSpend,
  ResearchCapError,
  UNIT_COST_CENTS,
} from "./spend";
import { upsertCompetitor, listCompetitors, addEvent } from "./store";
import { getBusinessProfile } from "@/lib/businessProfile";
import { readKey, setKey } from "@/lib/settings";
import { getCurrentTenant } from "@/lib/db/tenant";

/**
 * Competitor discovery — Task 5 of Market Research P1. Wires the committed
 * foundation (places.ts/distance.ts/spend.ts/store.ts, Tasks 1-4) into "find
 * the gyms near this tenant and put them on the watchlist": geocode the
 * tenant's own address once (cached thereafter), ask Places Nearby for gyms
 * around that centre, filter to the requested radius, upsert every kept
 * place onto the watchlist, and raise a `new_competitor` event for any
 * placeId the watchlist hasn't seen before.
 *
 * Fail-soft end to end, matching places.ts's own contract: every failure
 * mode — unconfigured, no address on file, cap reached, a bad geocode/nearby
 * response, or a genuinely unexpected error — resolves to
 * `{ok:false,error}` rather than throwing. Callers (a UI action, or later a
 * scheduler) can render `error` directly or map it to a friendlier string;
 * it is never surfaced to the end tenant as a stack trace.
 *
 * Metered like every other Places/Geocoding call site: `assertUnderResearchCap`
 * immediately before a paid call, `recordResearchSpend` after — both keyed on
 * `getCurrentTenant().id`, so this module (like store.ts) never takes a
 * tenantId parameter; the caller establishes the ambient tenant (a request's
 * cookie session, or `runWithTenant()` for a detached job) before calling in.
 *
 * Testability: `discoverCompetitors` itself is intentionally thin — a
 * straight-line pipe through already-independently-tested foundation calls
 * (places/spend/store) plus one pure helper. The actual "did we get the
 * radius filter and the new-vs-existing diff right" logic lives in
 * `partitionNearby`, a pure function with no fetch/db/tenant dependency, so
 * it can be unit-tested directly with plain literals — see discovery.test.ts.
 * Exercising the orchestration end-to-end would additionally require
 * stubbing the `./places` module's exported functions under the test
 * runner's CJS/tsx compile, which has no clean seam (no DI, ESM named
 * exports); rather than force that, the orchestration stays thin enough that
 * its correctness follows from the (separately covered) pieces it calls in
 * a fixed order.
 */

const RESEARCH_CENTRE_KEY = "research_centre";
const DEFAULT_RADIUS_KM = 20;

type CachedCentre = { lat: number; lng: number; geocodedAt: string };

export type DiscoverResult =
  | { ok: true; count: number; centre: LatLng }
  | { ok: false; error: string };

/** One Nearby result annotated with its great-circle distance from the centre. */
export type NearbyPlace = PlaceLite & { distanceKm: number };

export type PartitionResult = {
  /** Places within `radiusKm` of `centre` (order preserved from the input). */
  kept: NearbyPlace[];
  /** placeIds among `kept` that were NOT in `existingIds` — i.e. genuinely new. */
  newPlaceIds: Set<string>;
};

/**
 * Pure: radius filter + new-vs-existing diff, the two pieces of
 * `discoverCompetitors` step 4 worth testing in isolation. No fetch, no db,
 * no tenant — just arithmetic over the arguments given.
 *
 * A place farther than `radiusKm` (computed via haversineKm from `centre`)
 * is dropped. Everything kept is checked against `existingIds` (a snapshot
 * of the watchlist's placeIds taken BEFORE this run) to produce `newPlaceIds`
 * — a Set, so a placeId that (hypothetically) appears twice in `places`
 * still yields at most one "new" entry, matching the "raise the event only
 * once per competitor" requirement without the caller needing its own dedup.
 */
export function partitionNearby(
  places: PlaceLite[],
  centre: LatLng,
  radiusKm: number,
  existingIds: Set<string>,
): PartitionResult {
  const kept: NearbyPlace[] = [];
  const newPlaceIds = new Set<string>();
  for (const place of places) {
    const distanceKm = haversineKm(centre, place);
    if (distanceKm > radiusKm) continue;
    kept.push({ ...place, distanceKm });
    if (!existingIds.has(place.placeId)) newPlaceIds.add(place.placeId);
  }
  return { kept, newPlaceIds };
}

/** Reads + validates the cached centre KV value; null if absent or malformed. */
function readCachedCentre(): LatLng | null {
  const cached = readKey<CachedCentre | null>(RESEARCH_CENTRE_KEY, null);
  if (!cached || typeof cached.lat !== "number" || typeof cached.lng !== "number") return null;
  return { lat: cached.lat, lng: cached.lng };
}

/**
 * The tenant's research centre, from the cache ONLY — never geocodes. A pure
 * read, safe to call anywhere (e.g. to decide whether to show a "centre not
 * set yet" state) without risking a metered call or a network round trip.
 */
export async function getResearchCentre(): Promise<LatLng | null> {
  return readCachedCentre();
}

/**
 * Resolves the tenant's research centre: cached KV hit first (no charge, no
 * network); otherwise geocode the business profile's address once and cache
 * the result. Spend is recorded only when geocodeAddress actually returns a
 * usable centre — a REQUEST_DENIED/ZERO_RESULTS/network failure charges
 * nothing (mirrors the brief's "on ok, cache + recordResearchSpend; on fail
 * → {ok:false,error}" wording for this step exactly). `assertUnderResearchCap`
 * is called immediately before the metered geocode call and may throw
 * `ResearchCapError`, which `discoverCompetitors`'s outer try/catch maps to
 * `{ok:false,error:"cap_reached"}` — this helper deliberately does not catch
 * it itself.
 */
async function resolveCentre(
  tenantId: number,
): Promise<{ ok: true; centre: LatLng } | { ok: false; error: string }> {
  const cached = readCachedCentre();
  if (cached) return { ok: true, centre: cached };

  const address = getBusinessProfile().location.trim();
  if (!address) return { ok: false, error: "no_address" };

  assertUnderResearchCap(tenantId);
  const geo = await geocodeAddress(address);
  if (!geo.ok) return { ok: false, error: geo.error };

  recordResearchSpend(tenantId, UNIT_COST_CENTS.geocode, "geocode");
  const centre: LatLng = { lat: geo.lat, lng: geo.lng };
  const toCache: CachedCentre = { lat: centre.lat, lng: centre.lng, geocodedAt: new Date().toISOString() };
  setKey(RESEARCH_CENTRE_KEY, toCache);
  return { ok: true, centre };
}

/**
 * Find gyms near the tenant's centre and upsert them onto the watchlist,
 * raising a `new_competitor` event for each placeId the watchlist hasn't
 * seen before. `radiusKm` defaults to 20.
 *
 * Never throws: `ResearchCapError` (from either metered step) resolves to
 * `{ok:false,error:"cap_reached"}`, and any other unexpected error is logged
 * server-side and resolves to `{ok:false,error:<message>}` — see the module
 * doc for the full fail-soft contract.
 *
 * Unlike the geocode step above, the Nearby call's spend is recorded right
 * after the call regardless of its outcome (matching this step's wording in
 * the brief, which — unlike the geocode step — does not gate
 * recordResearchSpend behind "on ok"): a non-2xx/error response from Google
 * still represents a request Google received and may bill for, so it still
 * counts against the tenant's monthly cap.
 */
export async function discoverCompetitors(radiusKm: number = DEFAULT_RADIUS_KM): Promise<DiscoverResult> {
  try {
    if (!placesConfigured()) return { ok: false, error: "not_configured" };

    const tenantId = getCurrentTenant().id;

    const resolved = await resolveCentre(tenantId);
    if (!resolved.ok) return resolved;
    const centre = resolved.centre;

    assertUnderResearchCap(tenantId);
    const nearby = await nearbyGyms(centre.lat, centre.lng, radiusKm);
    recordResearchSpend(tenantId, UNIT_COST_CENTS.nearby, "nearby");
    if (!nearby.ok) return { ok: false, error: nearby.error };

    // Snapshot BEFORE upserting anything this run, so a place discovered
    // earlier in this same loop can never make a later duplicate read as
    // "already existing".
    const existingIds = new Set(listCompetitors().map((c) => c.placeId));
    const { kept, newPlaceIds } = partitionNearby(nearby.places, centre, radiusKm, existingIds);

    for (const place of kept) {
      if (newPlaceIds.has(place.placeId)) {
        addEvent({
          competitorId: null,
          type: "new_competitor",
          summary: `New gym nearby: ${place.name} (${place.distanceKm.toFixed(1)}km)`,
        });
      }
      upsertCompetitor({
        placeId: place.placeId,
        name: place.name,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
        distanceKm: place.distanceKm,
        source: "google",
        addedBy: "auto",
      });
    }

    return { ok: true, count: kept.length, centre };
  } catch (err) {
    if (err instanceof ResearchCapError) return { ok: false, error: "cap_reached" };
    console.error("[research/discovery] discoverCompetitors failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
