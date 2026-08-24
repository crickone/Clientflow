// Pure ad-diff: diffs a competitor's previously-active ad set (from
// `store.activeAdIds`, once Task 3 adds it) against the ads a fresh
// `searchCompetitorAds` call (T1, adLibrary.ts) just returned, producing the
// rows to upsert plus the `new_ad`/`ad_stopped` change events for the feed.
// No I/O, no DB, no network (Market Research P2, Task 2) — same shape as
// P1's changeDetect.ts, this is the "what changed" heart of the ads slice.
//
// `nowIso` is a parameter, not `Date.now()` internally — keeps this a pure,
// deterministic function callers can unit-test with plain literals (see
// adDiff.test.ts) and call for real with the actual current time.

import type { AdLite } from "./adLibrary";
import type { NewEvent } from "./store";

/**
 * An ad only counts as `new_ad` if its `startedAt` is within this many days
 * of `nowIso` — see `diffAds`' doc for the seed-safety reasoning this
 * default exists for.
 */
export const NEW_AD_RECENT_WINDOW_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * True when `startedAt` (an AdLite's `ad_delivery_start_time`, ISO) is
 * within `windowDays` of `nowMs` — an absolute-value comparison, not just
 * "at most N days before now". Symmetric on purpose: "started within N days
 * of now" reads as a window centred on now, so a startedAt a few hours
 * ahead of `nowMs` (clock skew between this call and whenever Meta stamped
 * the ad) still counts as recent rather than being rejected on a technicality.
 *
 * Missing or unparseable `startedAt` is never "recent" (returns false) —
 * this is what makes "upsert without an event" safe for ads Meta didn't
 * give a start date for (see test 7 in adDiff.test.ts).
 */
function isRecentlyStarted(startedAt: string | undefined, nowMs: number, windowDays: number): boolean {
  if (!startedAt) return false;
  const startedMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startedMs)) return false;
  const ageDays = Math.abs(nowMs - startedMs) / MS_PER_DAY;
  return ageDays <= windowDays;
}

/**
 * Mirrors the brief's rule verbatim: an ad is active when `stoppedAt` is
 * absent, OR present but strictly in the future relative to `nowMs`;
 * anything else — present and now-or-earlier, or present but unparseable —
 * is NOT active. An unparseable-but-present `stoppedAt` deliberately falls
 * to "not active" rather than "active": the conservative side, so a
 * malformed timestamp can't quietly hide a stopped ad from the feed forever.
 */
function isActive(ad: AdLite, nowMs: number): boolean {
  if (!ad.stoppedAt) return true;
  const stoppedMs = new Date(ad.stoppedAt).getTime();
  if (!Number.isFinite(stoppedMs)) return false;
  return stoppedMs > nowMs;
}

/**
 * Diffs `prevActiveIds` (the adIds active as of the last fetch) against
 * `current` (this cycle's `searchCompetitorAds` result) for one competitor,
 * returning:
 *
 *  - `upserts`: every ad in `current`, verbatim — ALL of them get
 *    stored/refreshed regardless of whether they're new, unchanged, or
 *    about to be reported as stopped (a row still needs its latest
 *    bodies/stoppedAt/etc. written even when it isn't newsworthy).
 *  - `stoppedAdIds`: adIds that were in `prevActiveIds` but are no longer
 *    active — either missing from `current` entirely, or present but now
 *    `!isActive` (a past `stoppedAt`; see `isActive` above).
 *  - `events`: zero, one, or two `NewEvent`s (one `new_ad`, one
 *    `ad_stopped`) — see below.
 *
 * **new_ad (seed-safety):** an ad in `current` whose id is NOT in
 * `prevActiveIds` counts as newly-launched ONLY if its `startedAt` is
 * within `recentWindowDays` (default `NEW_AD_RECENT_WINDOW_DAYS`,
 * `opts.recentWindowDays` to override) of `nowIso` — see
 * `isRecentlyStarted`. A competitor's first-ever fetch has an EMPTY
 * `prevActiveIds` by definition, so without this recency gate every
 * long-running ad the competitor happens to be running would look "new" —
 * 20 ads, 20 events, on day one. Ads with no `startedAt`, or a `startedAt`
 * outside the window, are still upserted (they're real, current ads) but
 * raise no event. An id already in `prevActiveIds` is NEVER `new_ad`
 * regardless of how recent its `startedAt` looks — "new" means "not
 * previously known", not "recently started".
 *
 * **ad_stopped:** any id in `prevActiveIds` that's no longer active this
 * cycle (see `stoppedAdIds` above).
 *
 * **Batching (de-noise the feed):** every newly-launched ad this cycle
 * collapses into ONE `new_ad` event (not one per ad), and every
 * newly-stopped ad collapses into ONE `ad_stopped` event — a competitor
 * relaunching a 5-ad campaign reads as one feed row ("Iron Gym launched 5
 * new ads"), not five. Singular phrasing ("launched a new ad" / "stopped an
 * ad") is used only when exactly one ad qualifies; 2+ always states the
 * count ("launched 3 new ads" / "stopped 3 ads"). The full detail rides in
 * `detailJson`: `{ ads: [{adId, startedAt}, …] }` for `new_ad`, `{ adIds:
 * […] }` for `ad_stopped`.
 *
 * `occurredAt` on both events defaults to `nowIso` (this is when the CYCLE
 * observed the change, not necessarily the ad's exact start/stop instant —
 * there's no independent per-ad timestamp on the event). `competitorId` is
 * passed straight from the caller onto every event. Never throws — a
 * malformed `startedAt`/`stoppedAt` is handled defensively by
 * `isRecentlyStarted`/`isActive` above rather than propagating a NaN or
 * throwing.
 */
export function diffAds(
  prevActiveIds: Set<string>,
  current: AdLite[],
  competitorId: number,
  competitorName: string,
  nowIso: string,
  opts?: { recentWindowDays?: number },
): { upserts: AdLite[]; stoppedAdIds: string[]; events: NewEvent[] } {
  const recentWindowDays = opts?.recentWindowDays ?? NEW_AD_RECENT_WINDOW_DAYS;
  const nowMs = new Date(nowIso).getTime();

  const currentById = new Map<string, AdLite>();
  for (const item of current) {
    if (!currentById.has(item.adId)) currentById.set(item.adId, item);
  }

  const newlyLaunched: AdLite[] = [];
  for (const item of current) {
    if (prevActiveIds.has(item.adId)) continue; // already known -> never "new", regardless of startedAt
    if (isRecentlyStarted(item.startedAt, nowMs, recentWindowDays)) newlyLaunched.push(item);
  }

  const stoppedAdIds: string[] = [];
  for (const id of prevActiveIds) {
    const match = currentById.get(id);
    if (!match || !isActive(match, nowMs)) stoppedAdIds.push(id);
  }

  const events: NewEvent[] = [];

  if (newlyLaunched.length > 0) {
    events.push({
      competitorId,
      type: "new_ad",
      summary:
        newlyLaunched.length === 1
          ? `${competitorName} launched a new ad`
          : `${competitorName} launched ${newlyLaunched.length} new ads`,
      detailJson: JSON.stringify({
        ads: newlyLaunched.map((item) => ({ adId: item.adId, startedAt: item.startedAt ?? null })),
      }),
      occurredAt: nowIso,
    });
  }

  if (stoppedAdIds.length > 0) {
    events.push({
      competitorId,
      type: "ad_stopped",
      summary:
        stoppedAdIds.length === 1
          ? `${competitorName} stopped an ad`
          : `${competitorName} stopped ${stoppedAdIds.length} ads`,
      detailJson: JSON.stringify({ adIds: stoppedAdIds }),
      occurredAt: nowIso,
    });
  }

  return { upserts: current, stoppedAdIds, events };
}
