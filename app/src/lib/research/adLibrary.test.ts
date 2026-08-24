// Run: npm test -- src/lib/research/adLibrary.test.ts
//
// Task 1 (Market Research P2) unit tests for the Meta Ad Library (`ads_archive`)
// client. Zero live network calls: every scenario temporarily replaces
// `globalThis.fetch` (save the original, restore in `finally`) — the exact
// `withMockFetch`/`withApiKey` helpers from places.test.ts, replicated here
// for META_AD_LIBRARY_TOKEN (same reasoning as adLibrary.ts keeping its own
// prop()/errorMessage() rather than importing places.ts's: one small
// self-contained file per client).
import assert from "node:assert/strict";

import { adLibraryConfigured, searchCompetitorAds } from "./adLibrary";

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

/** Sets META_AD_LIBRARY_TOKEN for the duration of `fn`, restoring it after — `undefined` deletes it entirely. */
async function withApiKey<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
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

(async () => {
  // ════════════════════════════════════════════════════════════════════
  // adLibraryConfigured()
  // ════════════════════════════════════════════════════════════════════
  await withApiKey(undefined, async () => {
    check("adLibraryConfigured(): false when META_AD_LIBRARY_TOKEN is unset", adLibraryConfigured() === false);
  });
  await withApiKey("test-ad-library-token", async () => {
    check("adLibraryConfigured(): true when META_AD_LIBRARY_TOKEN is set", adLibraryConfigured() === true);
  });

  // ════════════════════════════════════════════════════════════════════
  // Missing token -> {ok:false,error:"not_configured"}, and NEVER calls
  // fetch at all (fail-soft gate happens before any network).
  // ════════════════════════════════════════════════════════════════════
  await withApiKey(undefined, async () => {
    await withMockFetch(
      () => {
        throw new Error("fetch must not be called when unconfigured");
      },
      async (calls) => {
        const result = await searchCompetitorAds("Iron Gym Clonmel");
        check(
          "searchCompetitorAds: not_configured",
          result.ok === false && result.error === "not_configured",
        );
        check("missing token: zero fetch calls made", calls.length === 0);
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // searchCompetitorAds — happy path: maps a data[] fixture, tolerates a
  // second ad missing bodies/platforms/stop-time, drops a malformed entry.
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-token", async () => {
    await withMockFetch(
      () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "ad-1",
                ad_creative_bodies: ["Join now and get your first month free!"],
                ad_creative_link_titles: ["Iron Gym Clonmel"],
                ad_creative_link_captions: ["ironGymClonmel.ie"],
                ad_delivery_start_time: "2026-01-01T00:00:00Z",
                ad_delivery_stop_time: "2026-02-01T00:00:00Z",
                publisher_platforms: ["facebook", "instagram"],
                ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=ad-1",
                page_name: "Iron Gym Clonmel",
                page_id: "1234567890",
              },
              {
                id: "ad-2",
                ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=ad-2",
                // no bodies / titles / captions / platforms / start / stop / page_name / page_id -- Meta omits all of these sometimes
              },
              {
                // no `id` -- malformed, must be dropped rather than fabricated
                ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=missing-id",
              },
            ],
          }),
          { status: 200 },
        ),
      async (calls) => {
        const result = await searchCompetitorAds("Iron Gym Clonmel");
        check("searchCompetitorAds: ok:true", result.ok === true);
        if (result.ok) {
          check("searchCompetitorAds: malformed entry (no id) dropped -> 2 ads mapped, not 3", result.ads.length === 2);
          const [full, partial] = result.ads;
          check("searchCompetitorAds: adId <- id", full.adId === "ad-1");
          check(
            "searchCompetitorAds: bodies <- ad_creative_bodies",
            full.bodies.length === 1 && full.bodies[0] === "Join now and get your first month free!",
          );
          check("searchCompetitorAds: linkTitle <- ad_creative_link_titles[0]", full.linkTitle === "Iron Gym Clonmel");
          check("searchCompetitorAds: linkCaption <- ad_creative_link_captions[0]", full.linkCaption === "ironGymClonmel.ie");
          check(
            "searchCompetitorAds: platforms <- publisher_platforms",
            JSON.stringify(full.platforms) === JSON.stringify(["facebook", "instagram"]),
          );
          check(
            "searchCompetitorAds: snapshotUrl <- ad_snapshot_url",
            full.snapshotUrl === "https://www.facebook.com/ads/archive/render_ad/?id=ad-1",
          );
          check("searchCompetitorAds: startedAt <- ad_delivery_start_time", full.startedAt === "2026-01-01T00:00:00Z");
          check("searchCompetitorAds: stoppedAt <- ad_delivery_stop_time", full.stoppedAt === "2026-02-01T00:00:00Z");
          check("searchCompetitorAds: imageUrl never populated (no source field requested)", full.imageUrl === undefined);
          check("searchCompetitorAds: pageName <- page_name", full.pageName === "Iron Gym Clonmel");
          check("searchCompetitorAds: pageId <- page_id", full.pageId === "1234567890");

          check("searchCompetitorAds: partial ad still maps (id + snapshotUrl only)", partial.adId === "ad-2");
          check("searchCompetitorAds: missing bodies -> [] (not undefined)", Array.isArray(partial.bodies) && partial.bodies.length === 0);
          check("searchCompetitorAds: missing platforms -> [] (not undefined)", Array.isArray(partial.platforms) && partial.platforms.length === 0);
          check("searchCompetitorAds: missing linkTitle -> undefined", partial.linkTitle === undefined);
          check("searchCompetitorAds: missing linkCaption -> undefined", partial.linkCaption === undefined);
          check("searchCompetitorAds: missing startedAt -> undefined", partial.startedAt === undefined);
          check("searchCompetitorAds: missing stoppedAt (still active) -> undefined", partial.stoppedAt === undefined);
          check("searchCompetitorAds: missing page_name -> '' (required field, tolerant default, not undefined)", partial.pageName === "");
          check("searchCompetitorAds: missing page_id -> '' (required field, tolerant default, not undefined)", partial.pageId === "");
        }

        // ── request shape ──
        const call = calls[0];
        const [base, query] = call.url.split("?");
        check("searchCompetitorAds: hits the ads_archive endpoint", base === "https://graph.facebook.com/v21.0/ads_archive");
        check("searchCompetitorAds: GET (no method override)", call.init?.method === undefined);
        check("searchCompetitorAds: ad_type=ALL", query.includes("ad_type=ALL"));
        check(
          "searchCompetitorAds: ad_reached_countries defaults to IE (JSON array, encoded)",
          query.includes(`ad_reached_countries=${encodeURIComponent(JSON.stringify(["IE"]))}`),
        );
        check(
          "searchCompetitorAds: search_terms is url-encoded",
          query.includes(`search_terms=${encodeURIComponent("Iron Gym Clonmel")}`),
        );
        check(
          "searchCompetitorAds: fields mask (incl. page_name/page_id for the advertiser-page-match filter)",
          query.includes(
            `fields=${encodeURIComponent(
              "id,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms,ad_snapshot_url,page_name,page_id",
            )}`,
          ),
        );
        check("searchCompetitorAds: limit=25", query.includes("limit=25"));
        check("searchCompetitorAds: access_token", query.includes("access_token=test-token"));
      },
    );
  });

  // Explicit country overrides the "IE" default.
  await withApiKey("test-token", async () => {
    await withMockFetch(
      () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
      async (calls) => {
        const result = await searchCompetitorAds("Some Competitor", "FR");
        check("searchCompetitorAds: empty data[] -> ok:true, ads:[]", result.ok === true && (result as { ok: true; ads: unknown[] }).ads.length === 0);
        const query = calls[0].url.split("?")[1];
        check(
          "searchCompetitorAds: explicit country reflected in ad_reached_countries",
          query.includes(`ad_reached_countries=${encodeURIComponent(JSON.stringify(["FR"]))}`),
        );
      },
    );
  });

  // ════════════════════════════════════════════════════════════════════
  // Failure modes — Meta {error:{message}} body (even on a 200), HTTP 429,
  // and a throwing fetch all resolve to {ok:false,...} — NEVER throw.
  // ════════════════════════════════════════════════════════════════════
  await withApiKey("test-token", async () => {
    await withMockFetch(
      () =>
        new Response(
          JSON.stringify({ error: { message: "Invalid OAuth access token.", code: 190 } }),
          { status: 200 }, // Meta can ride an `error` object on a 200 -- checked BEFORE res.ok
        ),
      async () => {
        const result = await searchCompetitorAds("Iron Gym Clonmel");
        check("searchCompetitorAds: Meta {error:{message}} body -> ok:false", result.ok === false);
        check(
          "searchCompetitorAds: error message passed through verbatim",
          !result.ok && result.error === "Invalid OAuth access token.",
        );
      },
    );
  });

  await withApiKey("test-token", async () => {
    await withMockFetch(
      () => new Response("Please reduce the amount of calls.", { status: 429, statusText: "Too Many Requests" }),
      async () => {
        const result = await searchCompetitorAds("Iron Gym Clonmel");
        check("searchCompetitorAds: HTTP 429 -> ok:false", result.ok === false);
      },
    );
  });

  await withApiKey("test-token", async () => {
    await withMockFetch(
      () => {
        throw new TypeError("network down");
      },
      async () => {
        await assert.doesNotReject(async () => {
          const result = await searchCompetitorAds("Iron Gym Clonmel");
          check("searchCompetitorAds: fetch throws -> ok:false (never throws)", result.ok === false);
        });
      },
    );
  });

  console.log(`\nadLibrary: ${passed} checks passed.`);
})();
