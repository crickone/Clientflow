// Run: npm test -- src/lib/research/places.test.ts
//
// Task 1 (Market Research P1) unit tests for the Google Places (New) +
// Geocoding client. Zero live network calls: every scenario temporarily
// replaces `globalThis.fetch` (save the original, restore in `finally`) —
// same technique openrouter.test.ts uses for OpenRouterProvider.streamTurn,
// since geocodeAddress/nearbyGyms/placeDetails call the ambient `fetch`
// directly with no dependency-injection seam (by design, per the brief).
import assert from "node:assert/strict";

import {
  geocodeAddress,
  nearbyGyms,
  placeDetails,
  placesConfigured,
} from "./places";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

type FetchCall = { url: string; init?: RequestInit };

/**
 * Installs a mock `fetch` for the duration of `fn`, recording every call
 * (url + init), then restores the original fetch even if `fn` throws.
 */
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
  // ════════════════════════════════════════════════════════════════════
  // placesConfigured()
  // ════════════════════════════════════════════════════════════════════
  await withApiKey(undefined, async () => {
    check("placesConfigured(): false when GOOGLE_PLACES_API_KEY is unset", placesConfigured() === false);
  });
  await withApiKey("test-places-key", async () => {
    check("placesConfigured(): true when GOOGLE_PLACES_API_KEY is set", placesConfigured() === true);
  });

  // ════════════════════════════════════════════════════════════════════
  // Missing key -> every method {ok:false,error:"not_configured"}, and
  // NEVER calls fetch at all (fail-soft gate happens before any network).
  // ════════════════════════════════════════════════════════════════════
  await withApiKey(undefined, async () => {
    await withMockFetch(
      () => {
        throw new Error("fetch must not be called when unconfigured");
      },
      async (calls) => {
        const geo = await geocodeAddress("1 Main St, Clonmel");
        check("geocodeAddress: not_configured", geo.ok === false && geo.error === "not_configured");

        const nearby = await nearbyGyms(52.35, -7.7, 5);
        check("nearbyGyms: not_configured", nearby.ok === false && nearby.error === "not_configured");

        const details = await placeDetails("place-123");
        check("placeDetails: not_configured", details.ok === false && details.error === "not_configured");

        check("missing key: zero fetch calls made", calls.length === 0);
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // geocodeAddress — happy path
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-key", async () => {
    await withMockFetch(
      () =>
        new Response(
          JSON.stringify({
            status: "OK",
            results: [{ geometry: { location: { lat: 52.3547, lng: -7.7009 } } }],
          }),
          { status: 200 },
        ),
      async (calls) => {
        const result = await geocodeAddress("Clonmel, Co. Tipperary");
        check("geocodeAddress: ok:true", result.ok === true);
        if (result.ok) {
          check("geocodeAddress: lat parsed", result.lat === 52.3547);
          check("geocodeAddress: lng parsed", result.lng === -7.7009);
        }
        check(
          "geocodeAddress: hits the geocode endpoint",
          calls[0].url.startsWith("https://maps.googleapis.com/maps/api/geocode/json"),
        );
        check(
          "geocodeAddress: url includes encoded address",
          calls[0].url.includes(encodeURIComponent("Clonmel, Co. Tipperary")),
        );
        check("geocodeAddress: url includes key", calls[0].url.includes("key=test-key"));
      },
    );
  });

  // status:"ZERO_RESULTS" -> {ok:false, error:"ZERO_RESULTS"} (status passed through verbatim)
  await withApiKey("test-key", async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ status: "ZERO_RESULTS", results: [] }), { status: 200 }),
      async () => {
        const result = await geocodeAddress("a place that does not exist");
        check("geocodeAddress: ZERO_RESULTS -> ok:false", result.ok === false);
        check("geocodeAddress: ZERO_RESULTS -> error is the raw status", !result.ok && result.error === "ZERO_RESULTS");
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // nearbyGyms — happy path + missing rating/reviewCount + request shape
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-key", async () => {
    await withMockFetch(
      () =>
        new Response(
          JSON.stringify({
            places: [
              {
                id: "place-1",
                displayName: { text: "Iron Gym" },
                formattedAddress: "1 Main St, Clonmel",
                location: { latitude: 52.35, longitude: -7.7 },
                rating: 4.5,
                userRatingCount: 120,
              },
              {
                id: "place-2",
                displayName: { text: "Unrated Gym" },
                formattedAddress: "2 Side St, Clonmel",
                location: { latitude: 52.36, longitude: -7.71 },
                // no rating / userRatingCount -- Google omits both for an unrated place
              },
            ],
          }),
          { status: 200 },
        ),
      async (calls) => {
        const result = await nearbyGyms(52.35, -7.7, 5);
        check("nearbyGyms: ok:true", result.ok === true);
        if (result.ok) {
          check("nearbyGyms: maps 2 places", result.places.length === 2);
          const [rated, unrated] = result.places;
          check("nearbyGyms: placeId <- id", rated.placeId === "place-1");
          check("nearbyGyms: name <- displayName.text", rated.name === "Iron Gym");
          check("nearbyGyms: address <- formattedAddress", rated.address === "1 Main St, Clonmel");
          check("nearbyGyms: lat <- location.latitude", rated.lat === 52.35);
          check("nearbyGyms: lng <- location.longitude", rated.lng === -7.7);
          check("nearbyGyms: rating <- rating", rated.rating === 4.5);
          check("nearbyGyms: reviewCount <- userRatingCount", rated.reviewCount === 120);
          check("nearbyGyms: missing rating -> undefined (not 0)", unrated.rating === undefined);
          check("nearbyGyms: missing userRatingCount -> undefined (not 0)", unrated.reviewCount === undefined);
        }

        const call = calls[0];
        check("nearbyGyms: POSTs to places:searchNearby", call.url === "https://places.googleapis.com/v1/places:searchNearby");
        check("nearbyGyms: method is POST", call.init?.method === "POST");
        const headers = call.init?.headers as Record<string, string>;
        check("nearbyGyms: Content-Type header", headers["Content-Type"] === "application/json");
        check("nearbyGyms: X-Goog-Api-Key header", headers["X-Goog-Api-Key"] === "test-key");
        check(
          "nearbyGyms: X-Goog-FieldMask header",
          headers["X-Goog-FieldMask"] ===
            "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount",
        );

        const body = JSON.parse(String(call.init?.body));
        check("nearbyGyms: body.includedTypes", JSON.stringify(body.includedTypes) === JSON.stringify(["gym"]));
        check("nearbyGyms: body.maxResultCount", body.maxResultCount === 20);
        check(
          "nearbyGyms: body circle center",
          body.locationRestriction.circle.center.latitude === 52.35 &&
            body.locationRestriction.circle.center.longitude === -7.7,
        );
        check("nearbyGyms: body radius in meters (5km -> 5000m)", body.locationRestriction.circle.radius === 5000);
      },
    );
  });

  // radius capped at 50000m regardless of how large radiusKm is
  await withApiKey("test-key", async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ places: [] }), { status: 200 }),
      async (calls) => {
        const result = await nearbyGyms(52.35, -7.7, 100); // 100km -> would be 100000m uncapped
        check("nearbyGyms: empty places array still ok:true", result.ok === true);
        const body = JSON.parse(String(calls[0].init?.body));
        check("nearbyGyms: radius capped at 50000m", body.locationRestriction.circle.radius === 50000);
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // placeDetails — happy path (incl. originalText fallback) + missing reviews
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-key", async () => {
    await withMockFetch(
      () =>
        new Response(
          JSON.stringify({
            id: "place-1",
            displayName: { text: "Iron Gym" },
            formattedAddress: "1 Main St, Clonmel",
            rating: 4.5,
            userRatingCount: 120,
            reviews: [
              {
                name: "places/place-1/reviews/abc",
                authorAttribution: { displayName: "Jane Doe" },
                rating: 5,
                text: { text: "Great gym!" },
                publishTime: "2026-01-01T00:00:00Z",
              },
              {
                name: "places/place-1/reviews/def",
                authorAttribution: { displayName: "John Roe" },
                rating: 3,
                // no `text`, only `originalText` -- Google's translation fallback
                originalText: { text: "C'etait correct" },
                publishTime: "2026-02-01T00:00:00Z",
              },
            ],
          }),
          { status: 200 },
        ),
      async (calls) => {
        const result = await placeDetails("place-1");
        check("placeDetails: ok:true", result.ok === true);
        if (result.ok) {
          check("placeDetails: placeId", result.detail.placeId === "place-1");
          check("placeDetails: name", result.detail.name === "Iron Gym");
          check("placeDetails: address", result.detail.address === "1 Main St, Clonmel");
          check("placeDetails: rating", result.detail.rating === 4.5);
          check("placeDetails: reviewCount", result.detail.reviewCount === 120);
          check("placeDetails: 2 reviews mapped", result.detail.reviews.length === 2);
          const [r1, r2] = result.detail.reviews;
          check("placeDetails: review externalId <- name", r1.externalId === "places/place-1/reviews/abc");
          check("placeDetails: review author <- authorAttribution.displayName", r1.author === "Jane Doe");
          check("placeDetails: review text <- text.text", r1.text === "Great gym!");
          check("placeDetails: review rating", r1.rating === 5);
          check("placeDetails: review publishedAt <- publishTime", r1.publishedAt === "2026-01-01T00:00:00Z");
          check("placeDetails: review text falls back to originalText.text", r2.text === "C'etait correct");
        }

        const call = calls[0];
        check("placeDetails: GET url includes placeId", call.url === "https://places.googleapis.com/v1/places/place-1");
        check("placeDetails: no method override (GET)", call.init?.method === undefined);
        const headers = call.init?.headers as Record<string, string> | undefined;
        check("placeDetails: X-Goog-Api-Key header", headers?.["X-Goog-Api-Key"] === "test-key");
        check(
          "placeDetails: X-Goog-FieldMask header",
          headers?.["X-Goog-FieldMask"] === "id,displayName,formattedAddress,rating,userRatingCount,reviews",
        );
      },
    );
  });

  // Missing `reviews` entirely -> [] (never undefined, never throws)
  await withApiKey("test-key", async () => {
    await withMockFetch(
      () =>
        new Response(
          JSON.stringify({
            id: "place-2",
            displayName: { text: "No Reviews Gym" },
            formattedAddress: "3 Third St, Clonmel",
            // no `reviews` key at all, no rating/userRatingCount
          }),
          { status: 200 },
        ),
      async () => {
        const result = await placeDetails("place-2");
        check("placeDetails: missing reviews -> ok:true", result.ok === true);
        if (result.ok) {
          check("placeDetails: missing reviews -> []", Array.isArray(result.detail.reviews) && result.detail.reviews.length === 0);
          check("placeDetails: missing rating -> undefined", result.detail.rating === undefined);
          check("placeDetails: missing userRatingCount -> undefined", result.detail.reviewCount === undefined);
        }
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // HTTP 500 and a throwing fetch both resolve to {ok:false,...} — NEVER throw.
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-key", async () => {
    await withMockFetch(
      () => new Response("internal server error", { status: 500, statusText: "Internal Server Error" }),
      async () => {
        const geo = await geocodeAddress("x");
        check("geocodeAddress: HTTP 500 -> ok:false", geo.ok === false);

        const nearby = await nearbyGyms(1, 1, 1);
        check("nearbyGyms: HTTP 500 -> ok:false", nearby.ok === false);

        const details = await placeDetails("x");
        check("placeDetails: HTTP 500 -> ok:false", details.ok === false);
      },
    );
  });

  await withApiKey("test-key", async () => {
    await withMockFetch(
      () => {
        throw new TypeError("network down");
      },
      async () => {
        await assert.doesNotReject(async () => {
          const geo = await geocodeAddress("x");
          check("geocodeAddress: fetch throws -> ok:false (never throws)", geo.ok === false);
        });
        await assert.doesNotReject(async () => {
          const nearby = await nearbyGyms(1, 1, 1);
          check("nearbyGyms: fetch throws -> ok:false (never throws)", nearby.ok === false);
        });
        await assert.doesNotReject(async () => {
          const details = await placeDetails("x");
          check("placeDetails: fetch throws -> ok:false (never throws)", details.ok === false);
        });
      },
    );
  });

  console.log(`\nplaces: ${passed} checks passed.`);
})();
