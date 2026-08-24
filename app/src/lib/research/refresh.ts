import "server-only";

import { placesConfigured, placeDetails } from "./places";
import {
  assertUnderResearchCap,
  recordResearchSpend,
  ResearchCapError,
  UNIT_COST_CENTS,
} from "./spend";
import {
  listCompetitors,
  latestMetric,
  appendMetric,
  replaceReviews,
  addEvent,
  touchRefreshed,
  activeAdIds,
  upsertAd,
  markAdsStopped,
  type Metric,
} from "./store";
import { detectChanges } from "./changeDetect";
import { discoverCompetitors } from "./discovery";
import { adLibraryConfigured, searchCompetitorAds, searchCompetitorAdsByPageId, type AdLite } from "./adLibrary";
import { adPageMatchesCompetitor } from "./adPageMatch";
import { diffAds } from "./adDiff";
import { getCurrentTenant } from "@/lib/db/tenant";

/**
 * Weekly per-tenant refresh runner — Task 7 of Market Research P1. Ties the
 * whole committed engine (places.ts/spend.ts/store.ts/changeDetect.ts/
 * discovery.ts, Tasks 1-6) into the one call a scheduler (Task 9) or an
 * operator's "Rescan now" action (Task 11) actually makes: re-discover gyms
 * near the tenant (opportunistic, on by default), then snapshot every
 * TRACKED competitor's current rating/reviews via Places Details and diff
 * each snapshot against its own previous capture for change events.
 *
 * Runs inside a tenant context (the ambient `db` proxy + getCurrentTenant())
 * — a request's cookie session for "Rescan now", or `runWithTenant()` for
 * the detached scheduler job; like every other file in lib/research, this
 * module never takes a tenantId parameter.
 *
 * Fail-soft end to end, same contract as discovery.ts:
 *  - No Places key configured -> `{ok:false,error:"not_configured"}`,
 *    checked FIRST — before the tenant or the network are ever touched.
 *  - Re-discovery failing (cap reached, no address on file, not configured,
 *    a bad Google response) does NOT abort the refresh: it's logged and the
 *    snapshot loop below still runs over whatever is already on the
 *    watchlist. Discovery already meters its own spend and raises its own
 *    `new_competitor` events — this runner never re-charges or re-emits any
 *    of that, it just doesn't let discovery's failure block the rest of the
 *    cycle.
 *  - The research-spend cap is (re-)checked immediately before EACH
 *    competitor's metered Details call. Once it trips, that's a clean,
 *    silent stop of the loop (`break`) — NOT a failure of the whole run:
 *    whatever was refreshed before the cap tripped this cycle still counts,
 *    and the result is still `{ok:true,...}` with the counts so far. A
 *    tenant simply gets a partial refresh this week and the rest once
 *    spend resets or the cap is raised.
 *  - One competitor's Details call failing (HTTP error, network error — see
 *    places.ts, which itself never throws, only returns `{ok:false}`) is
 *    `continue`d, not fatal: the rest of the watchlist still refreshes.
 *    Spend is charged on SUCCESS only, so a failed call never eats into the
 *    cap (same fix as T5's `discoverCompetitors`/`nearbyGyms` symmetry).
 *  - Any other, truly unexpected error (e.g. a DB write failure) is caught
 *    by the outer try/catch and resolves to `{ok:false,error}` — this
 *    function never throws out.
 *
 * Market Research P2, Task 4 bolts a competitor AD step onto the END of the
 * snapshot loop above: same call, same cadence (a weekly scheduler tick or a
 * manual "Rescan now"), one more source refreshed per cycle. Deliberately a
 * SEPARATE pass over the watchlist, not folded into the per-competitor loop
 * above:
 *  - Gated on its own `adLibraryConfigured()` check (META_AD_LIBRARY_TOKEN),
 *    independent of `placesConfigured()` — the two providers are unrelated,
 *    and a tenant can have either configured without the other. No token ->
 *    the entire ad step is skipped (zero calls, fail-soft): the metrics/
 *    reviews loop above still ran, and this function still returns
 *    `{ok:true,...}` with its normal counts.
 *  - Skips the tenant's own gym (`isSelf`, P1.1 — `listCompetitors({...,
 *    excludeSelf:true})`): self isn't a competitor, so it's never
 *    ad-scanned, even though the metrics loop above DOES still snapshot
 *    self's own rating/reviews (see store.ts's `listCompetitors` doc for why
 *    that loop omits `excludeSelf` while this one passes it).
 *  - Per competitor: read `activeAdIds` (the set active as of the LAST
 *    cycle) BEFORE this cycle's `searchCompetitorAds`/upserts — same
 *    "read-prev-before-writing-next" rule as `latestMetric` above — then
 *    `diffAds` that snapshot (filtered, see below) against the fresh
 *    result, `upsertAd` every returned ad, `markAdsStopped` for anything
 *    that dropped out of the active set, and `addEvent` for any
 *    `new_ad`/`ad_stopped` the diff raised.
 *  - `searchCompetitorAds` failing (a 429, a network error) is `continue`d
 *    exactly like a failed `placeDetails` call above — one competitor's Ad
 *    Library error never stops the rest of the watchlist.
 *  - **Advertiser-page-match filter:** `searchCompetitorAds` queries Meta's
 *    Ad Library by `search_terms=<competitor name>` — a full-text search
 *    over ad COPY, not the advertiser — so `res.ads` can contain other
 *    businesses' ads whose text just happens to share a word with this
 *    competitor's name (the reported live bug: a gym named "...Inspire..."
 *    pulling in Fitbit **Inspire** 3 tracker ads). Every successful result
 *    is filtered through `adPageMatchesCompetitor(ad.pageName, comp.name)`
 *    (adPageMatch.ts) BEFORE `diffAds` ever sees it, so the stored set — and
 *    therefore the AI ad-angle summary and the gallery — only ever contain
 *    ads this competitor's own page actually placed. An empty filtered set
 *    is a normal, honest outcome, not an error.
 *  - **Exact Page-ID ad matching (Task 1):** when a competitor has been
 *    explicitly linked to a Facebook Page (`comp.facebookPageId`, set via
 *    lib/research/store.ts's `setCompetitorFacebookPage` — Task 2's admin
 *    UI), this step calls `searchCompetitorAdsByPageId` instead of
 *    `searchCompetitorAds`, and uses its `res.ads` DIRECTLY — the
 *    `adPageMatchesCompetitor` name filter above is SKIPPED for a linked
 *    competitor, because `search_page_ids` already scopes the query to
 *    exactly that page: Meta's own ground truth for "who placed this ad",
 *    stronger than any name-text heuristic. This also covers a case the
 *    name filter structurally can't: an ad whose copy never mentions the
 *    gym's name at all would fail `adPageMatchesCompetitor` and be dropped
 *    even though it's genuinely this competitor's ad; a linked page id has
 *    no such blind spot. An unlinked competitor (`facebookPageId` null —
 *    the default for every existing and newly-discovered competitor) keeps
 *    the `searchCompetitorAds` + name-filter path above, unchanged.
 *  - The Ad Library API is FREE. `recordResearchSpend(...,
 *    UNIT_COST_CENTS.adlib, "adlib")` still runs on every SUCCESSFUL search
 *    (adlib = 0c) purely so the spend ledger has a uniform row per research
 *    API this app calls — it can never push a tenant over their cap (adding
 *    0 to any total changes nothing), which is also why this step is
 *    deliberately NOT gated behind `assertUnderResearchCap`: an unrelated
 *    Places-spend cap must never block a free API.
 *  - Wrapped in its own try/catch: an unexpected failure anywhere in the ad
 *    step (a bad diff, a DB write error) is logged and swallowed, never
 *    propagated to the outer catch — the metrics/reviews work already done
 *    above by this point must never be thrown away because the ad step had
 *    a bad day.
 *  - Return shape is UNCHANGED — `refreshed`/`events` still describe the
 *    metrics loop only, same contract existing callers already read. The
 *    ad events still land in the `competitor_events` feed table via
 *    `addEvent` regardless (the dashboard reads that table directly, not
 *    this function's return value — see store.ts's `listEvents`).
 */

export type RefreshResult = { ok: true; refreshed: number; events: number } | { ok: false; error: string };

/**
 * Country for the Meta Ad Library query (Market Research P2, Task 4). P1's
 * own centre/profile signal (`getBusinessProfile().location`, geocoded in
 * discovery.ts's `resolveCentre`) is a freeform address string with no
 * structured country field to read off — there's no clean signal to derive
 * here (see the P2 T4 brief: "if there's no clean country signal, IE is the
 * P1 default"). "IE" mirrors adLibrary.ts's own DEFAULT_COUNTRY — the whole
 * client base is Ireland-only today, the same "for now, becomes per-business
 * later" reasoning lib/whatsapp/phone.ts documents for its own IE default.
 * Kept as an explicit named constant here (rather than just omitting the
 * argument and relying on searchCompetitorAds' own internal fallback) so a
 * later per-tenant country only has to change this one line.
 */
const AD_LIBRARY_COUNTRY = "IE";

export async function refreshTenant(opts?: { radiusKm?: number; rediscover?: boolean }): Promise<RefreshResult> {
  try {
    if (!placesConfigured()) return { ok: false, error: "not_configured" };

    const tenantId = getCurrentTenant().id;

    // Re-discovery is opportunistic and best-effort: default ON, but a
    // failure here must never abort the refresh — the snapshot loop below
    // still has the EXISTING watchlist to work with, which is most of the
    // value of a weekly cycle even on a week discovery itself couldn't run
    // (cap already spent, no address on file, a transient Google error).
    // Discovery meters and logs its own errors; nothing further to charge
    // or raise here.
    if (opts?.rediscover !== false) {
      const discovered = await discoverCompetitors(opts?.radiusKm);
      if (!discovered.ok) {
        console.error(
          "[research/refresh] re-discovery failed, continuing refresh with the existing watchlist:",
          discovered.error,
        );
      }
    }

    let refreshed = 0;
    let events = 0;

    const list = listCompetitors({ trackedOnly: true });
    for (const comp of list) {
      try {
        assertUnderResearchCap(tenantId);
      } catch (err) {
        // Soft stop: the cap is a budget boundary, not a failure. Whatever
        // refreshed before this point this cycle is still a real result.
        if (err instanceof ResearchCapError) break;
        throw err;
      }

      // Read the PREVIOUS capture BEFORE writing the new one — detectChanges
      // needs a real "before" to diff against. Reading this after
      // appendMetric would diff the new snapshot against itself and never
      // find a delta.
      const prev = latestMetric(comp.id);

      const res = await placeDetails(comp.placeId);
      if (!res.ok) {
        // Partial-failure resilient: one competitor's Details error must
        // never stop the rest of the watchlist from refreshing. No spend
        // recorded for a failed call — charge on success only.
        console.error(`[research/refresh] placeDetails failed for competitor ${comp.id} (${comp.placeId}):`, res.error);
        continue;
      }
      recordResearchSpend(tenantId, UNIT_COST_CENTS.details, "details");

      const { detail } = res;
      const ratingMilli = detail.rating == null ? null : Math.round(detail.rating * 1000);
      const reviewCount = detail.reviewCount ?? null;
      const capturedAt = new Date().toISOString();
      const next: Metric = { id: 0, competitorId: comp.id, capturedAt, ratingMilli, reviewCount };

      appendMetric(comp.id, ratingMilli, reviewCount, capturedAt);
      replaceReviews(
        comp.id,
        detail.reviews.map((r) => ({
          externalReviewId: r.externalId,
          author: r.author,
          ratingMilli: r.rating == null ? null : Math.round(r.rating * 1000),
          text: r.text,
          publishedAt: r.publishedAt ?? null,
        })),
        capturedAt,
      );

      const evs = detectChanges(prev, next, comp.name);
      for (const e of evs) addEvent(e);
      events += evs.length;

      touchRefreshed(comp.id, capturedAt);
      refreshed++;
    }

    // ── competitor ad-fetch (Market Research P2, Task 4) ───────────────
    // See the module doc's own section above for the full contract. Kept as
    // a separate pass over the watchlist (not folded into the loop above)
    // and wrapped so it can never take the metrics/reviews work above down
    // with it.
    if (adLibraryConfigured()) {
      try {
        for (const comp of listCompetitors({ trackedOnly: true, excludeSelf: true })) {
          // Read the PREVIOUS cycle's active set BEFORE this cycle's
          // upserts -- diffAds needs a real "before" to diff against, same
          // reasoning as `latestMetric` being read before `appendMetric`
          // above.
          const prevActive = activeAdIds(comp.id);

          // Exact Page-ID ad matching (Task 1): a linked competitor
          // (comp.facebookPageId set via setCompetitorFacebookPage) is
          // fetched by search_page_ids and its ads used DIRECTLY -- see the
          // module doc's "Exact Page-ID ad matching" bullet for why the name
          // filter in the `else` branch below is skipped for this path. An
          // unlinked competitor keeps the original search_terms +
          // adPageMatchesCompetitor path verbatim.
          let ownAds: AdLite[];
          if (comp.facebookPageId) {
            const res = await searchCompetitorAdsByPageId(comp.facebookPageId, AD_LIBRARY_COUNTRY);
            if (!res.ok) {
              // Per-competitor resilient, same contract as the unlinked
              // branch below.
              console.error(
                `[research/refresh] searchCompetitorAdsByPageId failed for competitor ${comp.id} (${comp.name}):`,
                res.error,
              );
              continue;
            }
            // FREE API -- ledger entry only, see the unlinked branch's
            // identical comment below.
            recordResearchSpend(tenantId, UNIT_COST_CENTS.adlib, "adlib");
            // The page id IS the exact match -- no adPageMatchesCompetitor
            // filtering needed or wanted here. This also stores ads whose
            // copy never names the gym at all, which the name filter would
            // otherwise wrongly drop.
            ownAds = res.ads;
          } else {
            const res = await searchCompetitorAds(comp.name, AD_LIBRARY_COUNTRY);
            if (!res.ok) {
              // Per-competitor resilient: one competitor's Ad Library error
              // (e.g. a 429) must never stop the rest of the watchlist. No
              // spend recorded for a failed call -- moot here since the call
              // is free, but kept symmetric with the placeDetails failure
              // above.
              console.error(
                `[research/refresh] searchCompetitorAds failed for competitor ${comp.id} (${comp.name}):`,
                res.error,
              );
              continue;
            }
            // FREE API -- this is a ledger entry for observability only
            // (UNIT_COST_CENTS.adlib is 0c), never a real charge, and
            // deliberately never gated behind assertUnderResearchCap: an
            // unrelated Places-spend cap must not block a free API.
            recordResearchSpend(tenantId, UNIT_COST_CENTS.adlib, "adlib");

            // Advertiser-page-match fix: `searchCompetitorAds` matches ad COPY
            // (Meta's search_terms is full-text over the ad, not the
            // advertiser), so `res.ads` can and does contain other businesses'
            // ads whose text happens to share a word with this competitor's
            // name (the live bug -- see adPageMatch.ts's module doc). Filter
            // down to ads this competitor's OWN page actually placed BEFORE
            // diffAds ever sees them, so the stored set, the AI ad-angle
            // summary (computed from stored ads), and the gallery only ever
            // hold this competitor's own ads. An empty `ownAds` (every result
            // was a false positive) is the correct, honest outcome -- "no ads
            // found" beats junk.
            ownAds = res.ads.filter((a) => adPageMatchesCompetitor(a.pageName, comp.name));
          }

          const nowIso = new Date().toISOString();
          const { upserts, stoppedAdIds, events: adEvents } = diffAds(prevActive, ownAds, comp.id, comp.name, nowIso);
          for (const ad of upserts) upsertAd(comp.id, ad, nowIso);
          if (stoppedAdIds.length > 0) markAdsStopped(comp.id, stoppedAdIds, nowIso);
          for (const e of adEvents) addEvent(e);
        }
      } catch (err) {
        // Never let an unexpected ad-step failure abort the
        // already-successful metrics refresh above.
        console.error("[research/refresh] competitor ad-fetch step failed:", err);
      }
    }

    return { ok: true, refreshed, events };
  } catch (err) {
    console.error("[research/refresh] refreshTenant failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
