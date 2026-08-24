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
  type Metric,
} from "./store";
import { detectChanges } from "./changeDetect";
import { discoverCompetitors } from "./discovery";
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
 */

export type RefreshResult = { ok: true; refreshed: number; events: number } | { ok: false; error: string };

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

    return { ok: true, refreshed, events };
  } catch (err) {
    console.error("[research/refresh] refreshTenant failed:", err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
