// Run: npm test -- src/lib/research/adDiff.test.ts
//
// Task 2 (Market Research P2) — pure ad-diff tests, written FIRST (TDD):
// diffs a competitor's previously-active ad set (T1's AdLite) against the
// ads just fetched into upserts + new_ad/ad_stopped change events. No I/O,
// no DB, no network — every case here is a synchronous, in-memory call.
// Mirrors changeDetect.test.ts's harness (check() + async IIFE).
import assert from "node:assert/strict";

import { diffAds, NEW_AD_RECENT_WINDOW_DAYS } from "./adDiff";
import type { AdLite } from "./adLibrary";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const NAME = "Iron Gym";
const COMPETITOR_ID = 42;
const NOW_ISO = "2026-08-16T12:00:00.000Z";
const NOW_MS = new Date(NOW_ISO).getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

/** `days` before NOW_ISO (negative -> in the future), as an ISO string. */
function daysAgoIso(days: number): string {
  return new Date(NOW_MS - days * DAY_MS).toISOString();
}

/** Fixture builder: a full AdLite with sane defaults, overridable per field.
 *  pageName/pageId default to "" (adLibrary.ts's own tolerant-default for an
 *  ad Meta didn't attribute to a page) -- diffAds/upsertAd are indifferent
 *  to their value, so no test below needs to override them; the
 *  advertiser-page-match FILTER these feed lives in refresh.ts, upstream of
 *  diffAds, not in this pure module. */
function ad(over: Partial<AdLite> = {}): AdLite {
  return {
    adId: "ad_1",
    bodies: ["50% off your first month"],
    platforms: ["facebook", "instagram"],
    snapshotUrl: "https://www.facebook.com/ads/library/?id=ad_1",
    pageName: "",
    pageId: "",
    ...over,
  };
}

type NewAdDetail = { ads: { adId: string; startedAt: string | null }[] };
type StoppedDetail = { adIds: string[] };

(async () => {
  // ════════════════════════════════════════════════════════════════════
  // Exported default is documented.
  // ════════════════════════════════════════════════════════════════════
  check("NEW_AD_RECENT_WINDOW_DAYS is 30", NEW_AD_RECENT_WINDOW_DAYS === 30);

  // ════════════════════════════════════════════════════════════════════
  // 1. First fetch (prevActiveIds empty), all ads started long ago ->
  //    all upserted, ZERO new_ad events (seed-safety).
  // ════════════════════════════════════════════════════════════════════
  {
    const current = [
      ad({ adId: "old_1", startedAt: daysAgoIso(400) }),
      ad({ adId: "old_2", startedAt: daysAgoIso(900) }),
      ad({ adId: "old_3", startedAt: daysAgoIso(60) }), // outside the 30-day window
    ];
    const result = diffAds(new Set<string>(), current, COMPETITOR_ID, NAME, NOW_ISO);
    check("1. seed: all 3 ads upserted (same array)", result.upserts.length === 3 && result.upserts === current);
    check("1. seed: zero new_ad events (no spam)", result.events.length === 0);
    check("1. seed: no stopped ads either", result.stoppedAdIds.length === 0);
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. First fetch, 2 ads started yesterday (within window) -> ONE
  //    new_ad event ("launched 2 new ads"), both upserted.
  // ════════════════════════════════════════════════════════════════════
  {
    const current = [
      ad({ adId: "new_1", startedAt: daysAgoIso(1) }),
      ad({ adId: "new_2", startedAt: daysAgoIso(1) }),
      ad({ adId: "old_1", startedAt: daysAgoIso(400) }),
    ];
    const result = diffAds(new Set<string>(), current, COMPETITOR_ID, NAME, NOW_ISO);
    check("2. seed+recent: all 3 upserted", result.upserts.length === 3);
    check("2. seed+recent: exactly one new_ad event (batched)", result.events.length === 1);
    check("2. seed+recent: type is new_ad", result.events[0].type === "new_ad");
    check("2. seed+recent: summary batches the count", result.events[0].summary === "Iron Gym launched 2 new ads");
    check("2. seed+recent: competitorId on the event", result.events[0].competitorId === COMPETITOR_ID);
    check("2. seed+recent: occurredAt defaults to nowIso", result.events[0].occurredAt === NOW_ISO);
    const detail = JSON.parse(result.events[0].detailJson!) as NewAdDetail;
    check(
      "2. seed+recent: detailJson lists both new adIds + startedAt, not the old one",
      Array.isArray(detail.ads) &&
        detail.ads.length === 2 &&
        detail.ads.every((a) => typeof a.adId === "string" && typeof a.startedAt === "string") &&
        !detail.ads.some((a) => a.adId === "old_1"),
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. A brand-new ad (id not in prev) started today -> one new_ad
  //    (singular phrasing).
  // ════════════════════════════════════════════════════════════════════
  {
    const prevActiveIds = new Set<string>(["existing_1"]);
    const current = [
      ad({ adId: "existing_1", startedAt: daysAgoIso(200) }),
      ad({ adId: "new_1", startedAt: daysAgoIso(0.2) }), // a few hours ago -> "today"
    ];
    const result = diffAds(prevActiveIds, current, COMPETITOR_ID, NAME, NOW_ISO);
    const newAdEvents = result.events.filter((e) => e.type === "new_ad");
    check("3. exactly one new_ad event", newAdEvents.length === 1);
    check("3. singular phrasing for a single new ad", newAdEvents[0].summary === "Iron Gym launched a new ad");
    check("3. no ad_stopped noise", !result.events.some((e) => e.type === "ad_stopped"));
    check("3. both ads upserted", result.upserts.length === 2);
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. A prev-active id absent from current -> one ad_stopped (id in
  //    stoppedAdIds).
  // ════════════════════════════════════════════════════════════════════
  {
    const prevActiveIds = new Set<string>(["gone_1", "still_here"]);
    const current = [ad({ adId: "still_here", startedAt: daysAgoIso(100) })];
    const result = diffAds(prevActiveIds, current, COMPETITOR_ID, NAME, NOW_ISO);
    check("4. exactly one ad_stopped event", result.events.length === 1 && result.events[0].type === "ad_stopped");
    check(
      "4. stoppedAdIds contains exactly the vanished id",
      result.stoppedAdIds.length === 1 && result.stoppedAdIds[0] === "gone_1",
    );
    check("4. singular phrasing for a single stop", result.events[0].summary === "Iron Gym stopped an ad");
    check(
      "4. still-present ad upserted and NOT counted as stopped",
      result.upserts.some((a) => a.adId === "still_here") && !result.stoppedAdIds.includes("still_here"),
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. Unchanged (all current ids were in prev, none newly started,
  //    none vanished) -> no events. Also proves: an id already in
  //    prevActiveIds is NEVER new_ad, even with a recent startedAt.
  // ════════════════════════════════════════════════════════════════════
  {
    const prevActiveIds = new Set<string>(["a1", "a2"]);
    const current = [
      ad({ adId: "a1", startedAt: daysAgoIso(200) }),
      ad({ adId: "a2", startedAt: daysAgoIso(1) }), // recent, but already known
    ];
    const result = diffAds(prevActiveIds, current, COMPETITOR_ID, NAME, NOW_ISO);
    check("5. unchanged -> no events at all", result.events.length === 0);
    check("5. unchanged -> no stopped ids", result.stoppedAdIds.length === 0);
    check("5. unchanged -> both still upserted", result.upserts.length === 2);
  }

  // ════════════════════════════════════════════════════════════════════
  // 6. Both a new launch AND a stop in the same cycle -> both events.
  // ════════════════════════════════════════════════════════════════════
  {
    const prevActiveIds = new Set<string>(["staying", "leaving"]);
    const current = [
      ad({ adId: "staying", startedAt: daysAgoIso(300) }),
      ad({ adId: "brand_new", startedAt: daysAgoIso(2) }),
    ];
    const result = diffAds(prevActiveIds, current, COMPETITOR_ID, NAME, NOW_ISO);
    check("6. exactly two events", result.events.length === 2);
    check("6. contains a new_ad event", result.events.some((e) => e.type === "new_ad"));
    check("6. contains an ad_stopped event", result.events.some((e) => e.type === "ad_stopped"));
    check(
      "6. stoppedAdIds has exactly 'leaving'",
      result.stoppedAdIds.length === 1 && result.stoppedAdIds[0] === "leaving",
    );
    check("6. occurredAt defaults to nowIso on every event", result.events.every((e) => e.occurredAt === NOW_ISO));
  }

  // ════════════════════════════════════════════════════════════════════
  // 7. An ad with no startedAt (unknown) -> upserted, no new_ad event.
  // ════════════════════════════════════════════════════════════════════
  {
    const current = [ad({ adId: "mystery" })]; // no startedAt
    const result = diffAds(new Set<string>(), current, COMPETITOR_ID, NAME, NOW_ISO);
    check("7. no-startedAt ad is upserted", result.upserts.length === 1);
    check("7. no-startedAt ad raises no new_ad event", result.events.length === 0);
  }

  // ════════════════════════════════════════════════════════════════════
  // Extra robustness/boundary coverage beyond the 7-case table above.
  // ════════════════════════════════════════════════════════════════════

  // A prev-active id still present but now has a PAST stoppedAt -> counts
  // as ad_stopped too (not just "absent from current").
  {
    const prevActiveIds = new Set<string>(["will_stop"]);
    const current = [ad({ adId: "will_stop", startedAt: daysAgoIso(50), stoppedAt: daysAgoIso(2) })];
    const result = diffAds(prevActiveIds, current, COMPETITOR_ID, NAME, NOW_ISO);
    check(
      "present-but-past-stoppedAt counts as ad_stopped",
      result.stoppedAdIds.length === 1 && result.stoppedAdIds[0] === "will_stop",
    );
    check("still upserted even though stopped", result.upserts.length === 1);
    check("no new_ad noise (id was already known)", !result.events.some((e) => e.type === "new_ad"));
  }

  // A prev-active id still present with a FUTURE stoppedAt -> still active,
  // not stopped ("absent or in the future = active").
  {
    const prevActiveIds = new Set<string>(["still_running"]);
    const current = [ad({ adId: "still_running", startedAt: daysAgoIso(50), stoppedAt: daysAgoIso(-10) })];
    const result = diffAds(prevActiveIds, current, COMPETITOR_ID, NAME, NOW_ISO);
    check(
      "future stoppedAt -> still active, no ad_stopped",
      result.stoppedAdIds.length === 0 && result.events.length === 0,
    );
  }

  // stoppedAt exactly == nowIso -> NOT active (boundary: "future" is strict).
  {
    const prevActiveIds = new Set<string>(["boundary_stop"]);
    const current = [ad({ adId: "boundary_stop", startedAt: daysAgoIso(50), stoppedAt: NOW_ISO })];
    const result = diffAds(prevActiveIds, current, COMPETITOR_ID, NAME, NOW_ISO);
    check(
      "stoppedAt exactly == nowIso is NOT active (boundary), counted as stopped",
      result.stoppedAdIds.includes("boundary_stop"),
    );
  }

  // 3 stops in one cycle -> ONE batched event, plural phrasing, ids in detailJson.
  {
    const prevActiveIds = new Set<string>(["s1", "s2", "s3"]);
    const current: AdLite[] = [];
    const result = diffAds(prevActiveIds, current, COMPETITOR_ID, NAME, NOW_ISO);
    check("3 stops -> exactly one ad_stopped event", result.events.length === 1 && result.events[0].type === "ad_stopped");
    check("3 stops -> plural phrasing with count", result.events[0].summary === "Iron Gym stopped 3 ads");
    check("3 stops -> competitorId on the event", result.events[0].competitorId === COMPETITOR_ID);
    check(
      "3 stops -> stoppedAdIds has all 3",
      result.stoppedAdIds.length === 3 && ["s1", "s2", "s3"].every((id) => result.stoppedAdIds.includes(id)),
    );
    const detail = JSON.parse(result.events[0].detailJson!) as StoppedDetail;
    check(
      "3 stops -> detailJson.adIds has all 3",
      Array.isArray(detail.adIds) && detail.adIds.length === 3 && ["s1", "s2", "s3"].every((id) => detail.adIds.includes(id)),
    );
    check("3 stops -> upserts empty (nothing in current)", result.upserts.length === 0);
  }

  // opts.recentWindowDays: shrinking the window excludes an ad the default
  // would have included.
  {
    const current = [ad({ adId: "n1", startedAt: daysAgoIso(10) })];
    const withDefault = diffAds(new Set<string>(), current, COMPETITOR_ID, NAME, NOW_ISO);
    check("default 30-day window includes a 10-day-old ad", withDefault.events.some((e) => e.type === "new_ad"));
    const withShrunk = diffAds(new Set<string>(), current, COMPETITOR_ID, NAME, NOW_ISO, { recentWindowDays: 5 });
    check(
      "recentWindowDays:5 excludes the same 10-day-old ad",
      !withShrunk.events.some((e) => e.type === "new_ad"),
    );
  }

  // opts.recentWindowDays: widening the window includes an ad the default
  // would have excluded.
  {
    const current = [ad({ adId: "n1", startedAt: daysAgoIso(40) })];
    const withDefault = diffAds(new Set<string>(), current, COMPETITOR_ID, NAME, NOW_ISO);
    check("default 30-day window excludes a 40-day-old ad", !withDefault.events.some((e) => e.type === "new_ad"));
    const withWidened = diffAds(new Set<string>(), current, COMPETITOR_ID, NAME, NOW_ISO, { recentWindowDays: 60 });
    check(
      "recentWindowDays:60 includes the same 40-day-old ad",
      withWidened.events.some((e) => e.type === "new_ad"),
    );
  }

  // Boundary: exactly AT the window (inclusive <=).
  {
    const current = [ad({ adId: "exact30", startedAt: daysAgoIso(30) })];
    const result = diffAds(new Set<string>(), current, COMPETITOR_ID, NAME, NOW_ISO);
    check("exactly at the 30-day boundary counts as recent (inclusive)", result.events.some((e) => e.type === "new_ad"));
  }

  // Just past the window -> excluded.
  {
    const current = [ad({ adId: "over30", startedAt: daysAgoIso(31) })];
    const result = diffAds(new Set<string>(), current, COMPETITOR_ID, NAME, NOW_ISO);
    check("31 days ago (just over the window) -> no new_ad", !result.events.some((e) => e.type === "new_ad"));
  }

  // Garbage/unparseable timestamps never throw, and resolve to the
  // conservative side (not recent; not active).
  {
    const prevActiveIds = new Set<string>(["garbage2"]);
    const current = [
      ad({ adId: "garbage1", startedAt: "not-a-date" }),
      ad({ adId: "garbage2", startedAt: daysAgoIso(50), stoppedAt: "also-not-a-date" }),
    ];
    let result: ReturnType<typeof diffAds> | undefined;
    assert.doesNotThrow(() => {
      result = diffAds(prevActiveIds, current, COMPETITOR_ID, NAME, NOW_ISO);
    });
    check("garbage timestamps never throw", result !== undefined);
    check("garbage startedAt on a brand-new ad -> not treated as recent", !result!.events.some((e) => e.type === "new_ad"));
    check(
      "garbage stoppedAt on a known ad -> treated as not-active (conservative) -> ad_stopped",
      result!.stoppedAdIds.includes("garbage2"),
    );
    check("both still upserted despite garbage fields", result!.upserts.length === 2);
  }

  // Empty input all around -> empty everything, never throws.
  {
    const result = diffAds(new Set<string>(), [], COMPETITOR_ID, NAME, NOW_ISO);
    check(
      "empty prev + empty current -> empty upserts/stoppedAdIds/events",
      result.upserts.length === 0 && result.stoppedAdIds.length === 0 && result.events.length === 0,
    );
  }

  console.log(`\nadDiff: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
