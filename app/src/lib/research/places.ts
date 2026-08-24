import "server-only";

/**
 * Google Places (New) + Geocoding client — Task 1 of Market Research P1 (a
 * competitor dashboard under Marketing). This is the FOUNDATION file every
 * later research task builds on: nothing else in lib/research exists yet.
 * Raw `fetch` only, no SDK — the same deliberate choice as MailgunSender
 * (lib/marketing/sender/mailgun.ts) and falClient.ts (lib/ai/image/
 * falClient.ts): one small file, so a future provider swap or API-version
 * bump never has to fight someone else's SDK shape.
 *
 * Fail-soft by design: `placesConfigured()` gates on GOOGLE_PLACES_API_KEY
 * alone, and every exported function checks it FIRST — before any `fetch`
 * — so an unconfigured deployment returns `{ok:false,error:"not_configured"}`
 * synchronously-fast and never touches the network (see the "missing key"
 * tests in places.test.ts, which assert zero fetch calls). Every function's
 * body past that gate is wrapped in try/catch, so a network error, a non-2xx
 * response, or a malformed body all become a typed `{ok:false,error}` too —
 * this module NEVER throws. No retries here, deliberately (per the brief) —
 * callers decide whether/how to retry.
 *
 * Two distinct Google APIs, two different auth shapes:
 *  - Geocoding API (legacy, stable): plain GET + a `key` query param; JSON
 *    body with a top-level `status` ("OK" | "ZERO_RESULTS" | ...) that's
 *    passed through verbatim as the error string on anything but "OK".
 *  - Places API (New): `X-Goog-Api-Key` header + an explicit
 *    `X-Goog-FieldMask` header — the New API returns NOTHING per place
 *    unless the caller asks for each field by name, unlike the legacy
 *    Places API. searchNearby is a POST with a JSON body; place Details is
 *    a plain GET.
 *
 * Ratings pass through as Google's raw float (e.g. 4.3) — NOT rounded or
 * scaled here; a later store-layer task converts to an integer `ratingMilli`
 * for safe DB storage/sorting. This client's job is just an honest, typed
 * mirror of what Google returned. `rating`/reviewCount fields are genuinely
 * optional throughout — Google omits both for a place with no ratings yet —
 * so a missing value is left `undefined`, never coerced to 0 (0 would
 * misrepresent "unrated" as "rated zero").
 */

const GEOCODE_ENDPOINT = "https://maps.googleapis.com/maps/api/geocode/json";
const PLACES_BASE = "https://places.googleapis.com/v1";

const NOT_CONFIGURED_ERROR = "not_configured";

/** Google's hard max for searchNearby's circle radius — a caller-supplied radiusKm beyond this would otherwise make Google reject the whole request instead of just clamping to the practical max. */
const MAX_RADIUS_METERS = 50000;

const NEARBY_FIELD_MASK =
  "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount";
const DETAILS_FIELD_MASK = "id,displayName,formattedAddress,rating,userRatingCount,reviews";

export function placesConfigured(): boolean {
  return !!process.env.GOOGLE_PLACES_API_KEY;
}

/** Mirrors placesConfigured()'s exact truthiness check, so the two can never disagree (one saying "configured" while the other refuses). */
function apiKey(): string | null {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  return key ? key : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Best-effort, bounded error detail from a non-2xx response — never throws. Mirrors safeErrorText in lib/marketing/sender/mailgun.ts. */
async function safeErrorText(res: Response): Promise<string> {
  try {
    const text = (await res.text()).trim();
    return (text || res.statusText || `HTTP ${res.status}`).slice(0, 500);
  } catch {
    return res.statusText || `HTTP ${res.status}`;
  }
}

// --- tiny unknown-payload guard (no `any`) — mirrors mailgun.ts's prop() ---
function prop(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

export type PlaceLite = {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  rating?: number;
  reviewCount?: number;
};

export type ReviewLite = {
  externalId: string;
  author: string;
  rating?: number;
  text: string;
  publishedAt?: string;
};

export type PlaceDetail = {
  placeId: string;
  name: string;
  address: string;
  rating?: number;
  reviewCount?: number;
  reviews: ReviewLite[];
};

/**
 * Maps one Places API (New) `places[]` entry to PlaceLite. Requires id +
 * displayName.text + a numeric location to be usable at all (an entry
 * missing any of those is dropped rather than fabricated — mirrors
 * mapDnsRecords's per-entry defensive mapping in mailgun.ts, so one
 * malformed entry never fails the whole nearbyGyms call). `formattedAddress`
 * falls back to "" (Google always sends it for a real place, but a pin is
 * still useful without it). rating/userRatingCount are left undefined when
 * absent — see the module doc for why.
 */
function mapPlaceLite(raw: unknown): PlaceLite | null {
  const placeId = prop(raw, "id");
  const name = prop(prop(raw, "displayName"), "text");
  const location = prop(raw, "location");
  const lat = prop(location, "latitude");
  const lng = prop(location, "longitude");
  if (typeof placeId !== "string" || typeof name !== "string" || typeof lat !== "number" || typeof lng !== "number") {
    return null;
  }
  const address = prop(raw, "formattedAddress");
  const place: PlaceLite = { placeId, name, address: typeof address === "string" ? address : "", lat, lng };
  const rating = prop(raw, "rating");
  if (typeof rating === "number") place.rating = rating;
  const reviewCount = prop(raw, "userRatingCount");
  if (typeof reviewCount === "number") place.reviewCount = reviewCount;
  return place;
}

/**
 * Maps one Places API (New) `reviews[]` entry to ReviewLite. `name` (the
 * review's resource name, e.g. "places/ID/reviews/REVIEW_ID") is the only
 * stable per-review id the API exposes, so it's used verbatim as
 * externalId. `text.text` is preferred over `originalText.text` (the
 * latter is the reviewer's original-language text when Google auto-
 * translated `text`) — either is tolerated. A review missing its id or
 * text is dropped rather than fabricated.
 */
function mapReviewLite(raw: unknown): ReviewLite | null {
  const externalId = prop(raw, "name");
  const textValue = prop(prop(raw, "text"), "text") ?? prop(prop(raw, "originalText"), "text");
  if (typeof externalId !== "string" || typeof textValue !== "string") return null;
  const authorName = prop(prop(raw, "authorAttribution"), "displayName");
  const review: ReviewLite = {
    externalId,
    author: typeof authorName === "string" ? authorName : "",
    text: textValue,
  };
  const rating = prop(raw, "rating");
  if (typeof rating === "number") review.rating = rating;
  const publishedAt = prop(raw, "publishTime");
  if (typeof publishedAt === "string") review.publishedAt = publishedAt;
  return review;
}

export async function geocodeAddress(
  address: string,
): Promise<{ ok: true; lat: number; lng: number } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) return { ok: false, error: NOT_CONFIGURED_ERROR };
  try {
    const url = `${GEOCODE_ENDPOINT}?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    if (!res.ok) {
      return { ok: false, error: `geocodeAddress failed (${res.status}): ${await safeErrorText(res)}` };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const status = typeof data.status === "string" ? data.status : "UNKNOWN_ERROR";
    // Google's own status field, passed through verbatim — e.g. "ZERO_RESULTS", "OVER_QUERY_LIMIT", "REQUEST_DENIED".
    if (status !== "OK") return { ok: false, error: status };
    const results = Array.isArray(data.results) ? data.results : [];
    const location = prop(prop(results[0], "geometry"), "location");
    const lat = prop(location, "lat");
    const lng = prop(location, "lng");
    if (typeof lat !== "number" || typeof lng !== "number") {
      return { ok: false, error: "geocodeAddress: malformed response (no results[0].geometry.location)" };
    }
    return { ok: true, lat, lng };
  } catch (err) {
    return { ok: false, error: `geocodeAddress failed: ${errorMessage(err)}` };
  }
}

export async function nearbyGyms(
  lat: number,
  lng: number,
  radiusKm: number,
): Promise<{ ok: true; places: PlaceLite[] } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) return { ok: false, error: NOT_CONFIGURED_ERROR };
  try {
    const radiusMeters = Math.min(radiusKm * 1000, MAX_RADIUS_METERS);
    const res = await fetch(`${PLACES_BASE}/places:searchNearby`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": NEARBY_FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes: ["gym"],
        maxResultCount: 20,
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: radiusMeters },
        },
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `nearbyGyms failed (${res.status}): ${await safeErrorText(res)}` };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const rawPlaces = Array.isArray(data.places) ? data.places : [];
    const places: PlaceLite[] = [];
    for (const raw of rawPlaces) {
      const mapped = mapPlaceLite(raw);
      if (mapped) places.push(mapped);
    }
    return { ok: true, places };
  } catch (err) {
    return { ok: false, error: `nearbyGyms failed: ${errorMessage(err)}` };
  }
}

export async function placeDetails(
  placeId: string,
): Promise<{ ok: true; detail: PlaceDetail } | { ok: false; error: string }> {
  const key = apiKey();
  if (!key) return { ok: false, error: NOT_CONFIGURED_ERROR };
  try {
    const res = await fetch(`${PLACES_BASE}/places/${encodeURIComponent(placeId)}`, {
      headers: {
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": DETAILS_FIELD_MASK,
      },
    });
    if (!res.ok) {
      return { ok: false, error: `placeDetails failed (${res.status}): ${await safeErrorText(res)}` };
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const id = prop(data, "id");
    const name = prop(prop(data, "displayName"), "text");
    if (typeof id !== "string" || typeof name !== "string") {
      return { ok: false, error: "placeDetails: malformed response (no id/displayName.text)" };
    }
    const address = prop(data, "formattedAddress");
    const rawReviews = Array.isArray(data.reviews) ? data.reviews : [];
    const reviews: ReviewLite[] = [];
    for (const raw of rawReviews) {
      const mapped = mapReviewLite(raw);
      if (mapped) reviews.push(mapped);
    }
    const detail: PlaceDetail = {
      placeId: id,
      name,
      address: typeof address === "string" ? address : "",
      reviews,
    };
    const rating = prop(data, "rating");
    if (typeof rating === "number") detail.rating = rating;
    const reviewCount = prop(data, "userRatingCount");
    if (typeof reviewCount === "number") detail.reviewCount = reviewCount;
    return { ok: true, detail };
  } catch (err) {
    return { ok: false, error: `placeDetails failed: ${errorMessage(err)}` };
  }
}
