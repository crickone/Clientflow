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
 * (places/spend/store) plus two pure helpers. The actual "did we get the
 * radius filter and the new-vs-existing diff right" logic lives in
 * `partitionNearby`, and "is this discovered place actually the tenant's OWN
 * gym" lives in `isSameBusiness` — both pure functions with no fetch/db/
 * tenant dependency, so they can be unit-tested directly with plain literals
 * — see discovery.test.ts. Exercising the orchestration end-to-end would
 * additionally require stubbing the `./places` module's exported functions
 * under the test runner's CJS/tsx compile, which has no clean seam (no DI,
 * ESM named exports); rather than force that, the orchestration stays thin
 * enough that its correctness follows from the (separately covered) pieces
 * it calls in a fixed order.
 *
 * Self-detection (Market Research P1.1): a tenant's own gym otherwise shows
 * up indistinguishable from a real competitor (and can even "win" a
 * highlight like Top Rated). `isSameBusiness` decides whether a discovered
 * place IS the tenant's own business — see its own doc comment for the
 * match rule — and `discoverCompetitors` flags at most one `kept` place per
 * run as `isSelf` (the nearest match, if more than one somehow qualifies).
 * Best-effort: no match -> nothing is flagged, same as today.
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

// ── self-detection (Market Research P1.1) ──────────────────────────────

const DEFAULT_SELF_MAX_DISTANCE_KM = 0.2;
const DEFAULT_SELF_MIN_TOKEN_OVERLAP = 0.6;

/** Legal/corporate suffixes that carry no identity signal for a name match — stripped before comparing. Deliberately does NOT strip meaningful business words (gym/fitness/health/club/centre): those are often the actual distinguishing part of a small business's name. */
const LEGAL_NAME_SUFFIXES = new Set([
  "ltd",
  "limited",
  "llc",
  "llp",
  "inc",
  "incorporated",
  "plc",
  "co",
  "company",
  "corp",
  "corporation",
]);

/**
 * lowercase, "&" -> "and", punctuation stripped, whitespace collapsed, legal
 * suffixes dropped -> a single space-joined token string ready for
 * containment/overlap comparison. Never returns "" for a non-blank input
 * that survives punctuation-stripping (falls back to the un-stripped token
 * list if removing suffixes would empty it out, e.g. a place literally
 * named "Ltd").
 */
function normalizeBusinessName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const tokens = cleaned.split(" ");
  const withoutSuffixes = tokens.filter((t) => !LEGAL_NAME_SUFFIXES.has(t));
  return (withoutSuffixes.length > 0 ? withoutSuffixes : tokens).join(" ");
}

/**
 * Do two already-normalised name strings refer to the same business? Exact
 * equality always matches; short of that, either name's full token set
 * being a subset of the other's (order-independent — survives Google
 * reordering or appending a town name), or a high token-overlap ratio
 * (most of the shorter name's words present in the other — survives minor
 * rewordings without full containment either way).
 *
 * Below 2 tokens on the shorter side, only exact equality counts: a single
 * generic shared word (e.g. "gym") would otherwise look like a match by
 * pure subset/overlap math against almost anything nearby. A false
 * positive here wrongly hides a real competitor from the tenant, which is
 * worse than the false negative of not auto-flagging a very tersely-named
 * profile — see the module doc's "best-effort" framing.
 */
function isCloseNameMatch(a: string, b: string, minTokenOverlap: number): boolean {
  if (a === b) return true;
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return false;
  if (Math.min(setA.size, setB.size) < 2) return false;

  const isSubset = (small: Set<string>, big: Set<string>) => [...small].every((t) => big.has(t));
  if (isSubset(setA, setB) || isSubset(setB, setA)) return true;

  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared++;
  return shared / Math.min(setA.size, setB.size) >= minTokenOverlap;
}

export interface IsSameBusinessOptions {
  /** Max distance (km) for a discovered place to still count as "at the tenant's own address". Default ~0.2km — Google's pin for a business and the tenant's own geocoded address should land almost exactly on top of each other; a genuine next-door competitor is already outside this margin. */
  maxDistanceKm?: number;
  /** Min token-overlap ratio (shared tokens / the shorter name's token count) to count as a name match when neither name fully contains the other. Default 0.6. */
  minTokenOverlap?: number;
}

/**
 * Pure: is `placeName` (a Google-discovered place) actually the tenant's
 * OWN business (`businessName`, from the business profile), rather than a
 * genuine nearby competitor? Two independent gates, BOTH required:
 *
 *  1. Distance: `distanceKm <= maxDistanceKm` (default ~0.2km).
 *  2. Name: normalised (lowercase, "&"->"and", punctuation stripped, legal
 *     suffixes like "Ltd"/"LLC" dropped) equal, one containing the other, or
 *     a high token-overlap — see `isCloseNameMatch`.
 *
 * Distance alone is NOT sufficient (a coffee shop sharing the tenant's
 * building must never match) and name alone is NOT sufficient (the same
 * business name 5km away is a coincidence, not the tenant's own gym) — both
 * gates independently guard against a false positive, which is the costlier
 * mistake here: it would wrongly hide a real competitor from the tenant.
 * Fails closed on blank input (an empty placeName/businessName can never
 * match anything) and NEVER throws — discovery treats "no match" as
 * "nothing flagged", the current, pre-this-feature behaviour.
 */
export function isSameBusiness(
  placeName: string,
  businessName: string,
  distanceKm: number,
  opts?: IsSameBusinessOptions,
): boolean {
  const maxDistanceKm = opts?.maxDistanceKm ?? DEFAULT_SELF_MAX_DISTANCE_KM;
  const minTokenOverlap = opts?.minTokenOverlap ?? DEFAULT_SELF_MIN_TOKEN_OVERLAP;

  // Written as a negated `<=` (not `distanceKm > maxDistanceKm`) so a NaN/
  // malformed distanceKm fails closed here rather than silently falling
  // through to the name check below.
  if (!(distanceKm <= maxDistanceKm)) return false;

  const a = normalizeBusinessName(placeName);
  const b = normalizeBusinessName(businessName);
  if (!a || !b) return false;

  return isCloseNameMatch(a, b, minTokenOverlap);
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
 * Both metered Google calls (geocode + Nearby) charge the tenant's monthly cap
 * ONLY on success — a failed/non-2xx response isn't billed by Google, and
 * over-counting would trip the cap early. See the inline comment at the Nearby
 * call below and the "nearby spend NOT recorded on failure" case in
 * discovery.test.ts.
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
    // Charge only on success — symmetric with the geocode step above (a failed
    // Google call isn't billed, and over-counting would trip the cap early).
    if (!nearby.ok) return { ok: false, error: nearby.error };
    recordResearchSpend(tenantId, UNIT_COST_CENTS.nearby, "nearby");

    // Snapshot BEFORE upserting anything this run, so a place discovered
    // earlier in this same loop can never make a later duplicate read as
    // "already existing".
    const existingIds = new Set(listCompetitors().map((c) => c.placeId));
    const { kept, newPlaceIds } = partitionNearby(nearby.places, centre, radiusKm, existingIds);

    // Self-detection (P1.1): find the SINGLE nearest `kept` place that is
    // the tenant's own gym (isSameBusiness), if any — "at most one, nearest
    // best match" even in the unlikely case more than one place qualifies.
    // Blank businessName -> isSameBusiness never matches anything, so this
    // degrades to "nothing flagged" exactly like today when the profile
    // hasn't got a name set.
    const businessName = getBusinessProfile().businessName.trim();
    let selfPlaceId: string | null = null;
    let selfDistanceKm = Infinity;
    for (const place of kept) {
      if (isSameBusiness(place.name, businessName, place.distanceKm) && place.distanceKm < selfDistanceKm) {
        selfPlaceId = place.placeId;
        selfDistanceKm = place.distanceKm;
      }
    }

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
        isSelf: place.placeId === selfPlaceId,
      });
    }

    return { ok: true, count: kept.length, centre };
  } catch (err) {
    if (err instanceof ResearchCapError) return { ok: false, error: "cap_reached" };
    console.error("[research/discovery] discoverCompetitors failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
