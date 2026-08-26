// Run: npm test -- src/lib/research/store.test.ts
//
// Market Research P1 (Task 4 — competitor watchlist + weekly metrics +
// review sample + change feed). TDD round-trip coverage for lib/research/
// store.ts's whole exported surface, against a real scratch-tenant SQLite
// file (not mocked) — same reasoning + shim as marketing/campaigns.test.ts
// (this task's closest sibling: a brand-new tenant-table store). Covers:
//   1. upsertCompetitor: a fresh placeId inserts; the SAME placeId again
//      updates in place (same id, no dup row) but leaves firstSeenAt,
//      tracked, and muted untouched.
//   2. listCompetitors: nearest-first ordering, and trackedOnly excluding
//      both tracked=false AND muted=true rows.
//   3. setCompetitorFlags/setCompetitorThemes/touchRefreshed: partial
//      updates (one flag at a time leaves the other untouched).
//   4. appendMetric / latestMetric / metricHistory: ordering is by
//      capturedAt (not insertion order), ratingMilli survives as an exact
//      integer, null ratings round-trip as null (not 0), and
//      metricHistory's limit is respected.
//   5. replaceReviews: wholesale swap (old rows gone, new rows in),
//      including swapping down to zero reviews. Plus (5b) getReviews (added
//      for Task 8 — lib/research/summary.ts's AI review-themes helper): the
//      StoredReview shape round-trips exactly (no id/competitorId/capturedAt
//      leaking through), insertion order (id asc) is preserved, and it
//      tracks every replaceReviews swap including down to [].
//   6. addEvent / listEvents / markEventsSeen: newest-first ordering,
//      unseenOnly filtering, marking flips seen without deleting anything,
//      and an omitted occurredAt defaults to ~now.
//   7. A light DDL smoke test: the indexes ensureTenantTables declares
//      actually exist.
//
// ./store -> @/lib/db (the ambient `db` proxy) -> @/lib/db/tenant (react
// `cache`) and -> @/lib/tenants -> @/lib/auth -> next/navigation. Same
// two-part shim as src/lib/marketing/campaigns.test.ts / src/lib/forms.test.ts
// (see either file's comment for the full "why"). Installed via a dynamic
// require (below) rather than a static import, since a static
// `import ... from "./store"` would be hoisted and evaluated before this
// shim runs.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
// Type-only — erased at compile time (esbuild/tsx strips `import type`
// entirely), so this never touches the Module._load shim below the way a
// value import of "./store" itself would.
import type { AdLite } from "./adLibrary";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in store.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById, openTenantDb } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { schema } = requireLocal("../db") as typeof import("../db");
  const {
    upsertCompetitor,
    listCompetitors,
    getSelfCompetitor,
    setCompetitorFlags,
    setCompetitorThemes,
    touchRefreshed,
    appendMetric,
    latestMetric,
    metricHistory,
    replaceReviews,
    getReviews,
    addEvent,
    listEvents,
    markEventsSeen,
    upsertAd,
    listAds,
    activeAdIds,
    markAdsStopped,
    setCompetitorAdAngle,
    setCompetitorFacebookPage,
    clearCompetitorFacebookPage,
    setCompetitorWebsite,
    setCompetitorContentScannedAt,
    setCompetitorContentTopics,
    replaceCompetitorPages,
    listCompetitorPages,
    listAllCompetitorPagesWithCompetitor,
  } = requireLocal("./store") as typeof import("./store");

  // ── scratch tenant (control row + a real tenant db file) ──
  const slug = "research-store-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Research Store Test", dbFile) as { id: number };
  const tid = t.id;

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  try {
    // ── 1. upsertCompetitor: insert, then re-upsert the same placeId ──
    const idA = runWithTenant(tid, () =>
      upsertCompetitor({
        placeId: "places/AAA",
        name: "Anytime Fitness Clonmel",
        address: "1 Main St, Clonmel",
        lat: 52.355,
        lng: -7.7,
        distanceKm: 1.25,
        addedBy: "manual",
      }),
    );
    assert.equal(typeof idA, "number");

    let listed = runWithTenant(tid, () => listCompetitors());
    assert.equal(listed.length, 1, "one row after the first upsert");
    let rowA = listed[0];
    assert.equal(rowA.id, idA);
    assert.equal(rowA.placeId, "places/AAA");
    assert.equal(rowA.name, "Anytime Fitness Clonmel");
    assert.equal(rowA.source, "google", "source defaults to 'google' when not given");
    assert.equal(rowA.addedBy, "manual");
    assert.equal(rowA.tracked, true, "tracked defaults to true");
    assert.equal(rowA.muted, false, "muted defaults to false");
    assert.equal(rowA.isSelf, false, "isSelf defaults to false when omitted");
    assert.equal(typeof rowA.isSelf, "boolean", "isSelf round-trips as a real boolean, not 0/1");
    assert.equal(rowA.themesJson, null);
    assert.equal(rowA.lastRefreshedAt, null);
    assert.ok(rowA.firstSeenAt.length > 0, "firstSeenAt is set on insert");
    const firstSeenAtOriginal = rowA.firstSeenAt;

    // Mute it, then re-upsert the SAME placeId with different discovery
    // fields — must update in place (same id, still exactly one row) but
    // must NOT reset firstSeenAt or un-mute it.
    runWithTenant(tid, () => setCompetitorFlags(idA, { muted: true }));
    const idAAgain = runWithTenant(tid, () =>
      upsertCompetitor({
        placeId: "places/AAA",
        name: "Anytime Fitness Clonmel (renamed)",
        address: "1 Main St, Clonmel, Co. Tipperary",
        lat: 52.3551,
        lng: -7.7001,
        distanceKm: 1.3,
        source: "manual-add",
      }),
    );
    assert.equal(idAAgain, idA, "same placeId -> same id, no new row");

    listed = runWithTenant(tid, () => listCompetitors());
    assert.equal(listed.length, 1, "still exactly one row for this placeId — the upsert did not duplicate it");
    rowA = listed[0];
    assert.equal(rowA.name, "Anytime Fitness Clonmel (renamed)", "mutable fields update in place");
    assert.equal(rowA.distanceKm, 1.3);
    assert.equal(rowA.source, "manual-add");
    assert.equal(rowA.firstSeenAt, firstSeenAtOriginal, "firstSeenAt is preserved across a re-upsert");
    assert.equal(rowA.muted, true, "muted is preserved across a re-upsert (not reset by re-discovery)");

    // isSelf, unlike muted/tracked/firstSeenAt above, IS re-derived on every
    // upsert (it's discovery's fresh isSameBusiness verdict, not an
    // operator-owned flag) — setting it true, then re-upserting WITHOUT it,
    // clears it back to false rather than "sticking".
    runWithTenant(tid, () => upsertCompetitor({ placeId: "places/AAA", name: rowA.name, address: rowA.address, lat: rowA.lat, lng: rowA.lng, distanceKm: rowA.distanceKm, isSelf: true }));
    rowA = runWithTenant(tid, () => listCompetitors()).find((r) => r.id === idA)!;
    assert.equal(rowA.isSelf, true, "isSelf is set by upsert's conflict-update path, not just on first insert");
    runWithTenant(tid, () => upsertCompetitor({ placeId: "places/AAA", name: rowA.name, address: rowA.address, lat: rowA.lat, lng: rowA.lng, distanceKm: rowA.distanceKm }));
    rowA = runWithTenant(tid, () => listCompetitors()).find((r) => r.id === idA)!;
    assert.equal(rowA.isSelf, false, "an upsert that omits isSelf clears a previously-true flag back to false (re-derived fresh every run, not sticky)");

    // ── 2. listCompetitors: nearest-first ordering + trackedOnly ──
    const idB = runWithTenant(tid, () =>
      upsertCompetitor({
        placeId: "places/BBB",
        name: "PureGym Clonmel",
        address: "2 Main St, Clonmel",
        lat: 52.356,
        lng: -7.701,
        distanceKm: 0.4,
      }),
    );
    const idC = runWithTenant(tid, () =>
      upsertCompetitor({
        placeId: "places/CCC",
        name: "Snap Fitness Clonmel",
        address: "3 Main St, Clonmel",
        lat: 52.357,
        lng: -7.702,
        distanceKm: 3.9,
      }),
    );
    runWithTenant(tid, () => setCompetitorFlags(idC, { tracked: false }));

    const all = runWithTenant(tid, () => listCompetitors());
    assert.deepEqual(
      all.map((r) => r.placeId),
      ["places/BBB", "places/AAA", "places/CCC"],
      "unfiltered list is ordered nearest-first (0.4, 1.3, 3.9) and includes muted/untracked rows",
    );

    const trackedOnlyList = runWithTenant(tid, () => listCompetitors({ trackedOnly: true }));
    assert.deepEqual(
      trackedOnlyList.map((r) => r.placeId),
      ["places/BBB"],
      "trackedOnly excludes both the muted row (AAA) and the untracked row (CCC)",
    );

    // ── 2b. excludeSelf + getSelfCompetitor (Market Research P1.1) ──
    assert.equal(runWithTenant(tid, () => getSelfCompetitor()), null, "no isSelf=true row yet -> null");

    runWithTenant(tid, () =>
      upsertCompetitor({
        placeId: "places/BBB",
        name: "PureGym Clonmel",
        address: "2 Main St, Clonmel",
        lat: 52.356,
        lng: -7.701,
        distanceKm: 0.4,
        isSelf: true,
      }),
    );

    const self = runWithTenant(tid, () => getSelfCompetitor());
    assert.ok(self !== null && self.placeId === "places/BBB", "getSelfCompetitor returns the (only) isSelf=true row");

    const withoutSelf = runWithTenant(tid, () => listCompetitors({ excludeSelf: true }));
    assert.deepEqual(
      withoutSelf.map((r) => r.placeId),
      ["places/AAA", "places/CCC"],
      "excludeSelf drops the self row (BBB) but keeps nearest-first ordering of the rest",
    );

    const trackedExcludeSelf = runWithTenant(tid, () => listCompetitors({ trackedOnly: true, excludeSelf: true }));
    assert.deepEqual(
      trackedExcludeSelf.map((r) => r.placeId),
      [],
      "trackedOnly + excludeSelf compose: BBB is tracked but self (excluded), AAA is muted, CCC is untracked -- nothing qualifies",
    );

    // Clear BBB's isSelf back off (a fresh upsert that omits it) so the
    // sections below aren't surprised by it carrying isSelf=true forward.
    runWithTenant(tid, () =>
      upsertCompetitor({
        placeId: "places/BBB",
        name: "PureGym Clonmel",
        address: "2 Main St, Clonmel",
        lat: 52.356,
        lng: -7.701,
        distanceKm: 0.4,
      }),
    );
    assert.equal(runWithTenant(tid, () => getSelfCompetitor()), null, "cleared back to no self match");

    // ── 3. setCompetitorFlags / setCompetitorThemes / touchRefreshed ──
    runWithTenant(tid, () => setCompetitorFlags(idB, { muted: true }));
    let rowB = runWithTenant(tid, () => listCompetitors()).find((r) => r.id === idB)!;
    assert.equal(rowB.muted, true);
    assert.equal(rowB.tracked, true, "flipping muted alone leaves tracked untouched");

    runWithTenant(tid, () => setCompetitorFlags(idB, { tracked: false }));
    rowB = runWithTenant(tid, () => listCompetitors()).find((r) => r.id === idB)!;
    assert.equal(rowB.tracked, false);
    assert.equal(rowB.muted, true, "flipping tracked alone leaves muted untouched");

    runWithTenant(tid, () =>
      setCompetitorThemes(idB, JSON.stringify(["clean", "friendly staff"]), "2026-08-10T00:00:00.000Z"),
    );
    runWithTenant(tid, () => touchRefreshed(idB, "2026-08-16T09:00:00.000Z"));
    rowB = runWithTenant(tid, () => listCompetitors()).find((r) => r.id === idB)!;
    assert.deepEqual(JSON.parse(rowB.themesJson!), ["clean", "friendly staff"]);
    assert.equal(rowB.themesAt, "2026-08-10T00:00:00.000Z");
    assert.equal(rowB.lastRefreshedAt, "2026-08-16T09:00:00.000Z");

    // ── 4. appendMetric / latestMetric / metricHistory ──
    // Inserted deliberately OUT of chronological order, to prove ordering is
    // by capturedAt (not insertion order).
    runWithTenant(tid, () => appendMetric(idA, 4200, 120, "2026-08-01"));
    runWithTenant(tid, () => appendMetric(idA, 4567, 133, "2026-08-15"));
    runWithTenant(tid, () => appendMetric(idA, 4300, 128, "2026-08-08"));

    const latest = runWithTenant(tid, () => latestMetric(idA))!;
    assert.equal(latest.capturedAt, "2026-08-15", "latestMetric picks the newest capturedAt, not the last-inserted row");
    assert.equal(latest.ratingMilli, 4567);
    assert.equal(typeof latest.ratingMilli, "number");
    assert.ok(Number.isInteger(latest.ratingMilli), "ratingMilli round-trips as an exact integer, not a float");

    const history = runWithTenant(tid, () => metricHistory(idA));
    assert.deepEqual(
      history.map((m) => m.capturedAt),
      ["2026-08-15", "2026-08-08", "2026-08-01"],
      "metricHistory is newest-first",
    );

    const cappedHistory = runWithTenant(tid, () => metricHistory(idA, 2));
    assert.deepEqual(
      cappedHistory.map((m) => m.capturedAt),
      ["2026-08-15", "2026-08-08"],
      "limit caps the result to the N newest",
    );

    assert.equal(runWithTenant(tid, () => latestMetric(idB)), null, "a competitor with no metrics yet reads as null, not throwing");
    assert.deepEqual(runWithTenant(tid, () => metricHistory(idB)), [], "same for metricHistory — empty array, not throwing");

    // A null-rating capture (e.g. Google briefly has no rating) round-trips as null, not 0.
    runWithTenant(tid, () => appendMetric(idB, null, null, "2026-08-15"));
    const bLatest = runWithTenant(tid, () => latestMetric(idB))!;
    assert.equal(bLatest.ratingMilli, null);
    assert.equal(bLatest.reviewCount, null);

    // ── 5. replaceReviews: wholesale swap ──
    runWithTenant(tid, () =>
      replaceReviews(
        idA,
        [
          { externalReviewId: "r1", author: "Sam", ratingMilli: 5000, text: "Great gym", publishedAt: "2026-07-01T00:00:00.000Z" },
          { externalReviewId: "r2", author: "Jo", ratingMilli: 3000, text: "It's fine", publishedAt: null },
        ],
        "2026-08-01",
      ),
    );
    let reviewRows = getTenantDbById(tid).select().from(schema.competitorReviews).all();
    assert.equal(reviewRows.length, 2);
    assert.deepEqual(reviewRows.map((r) => r.externalReviewId).sort(), ["r1", "r2"]);
    const r1 = reviewRows.find((r) => r.externalReviewId === "r1")!;
    assert.equal(r1.author, "Sam");
    assert.equal(r1.ratingMilli, 5000);
    assert.equal(r1.text, "Great gym");
    assert.equal(r1.publishedAt, "2026-07-01T00:00:00.000Z");
    assert.equal(r1.capturedAt, "2026-08-01");
    const r2 = reviewRows.find((r) => r.externalReviewId === "r2")!;
    assert.equal(r2.publishedAt, null, "a review with no publishedAt stores null, not a placeholder string");

    // ── 5b. getReviews (Task 8's additive read helper) ──
    // Insertion order (id asc) preserved -> [r1, r2], matching the order
    // replaceReviews's `reviews` array was given in, i.e. Google's own
    // relevance ordering, not re-sorted by rating/date.
    let gotA = runWithTenant(tid, () => getReviews(idA));
    assert.deepEqual(gotA.map((r) => r.externalReviewId), ["r1", "r2"]);
    assert.deepEqual(gotA[0], {
      externalReviewId: "r1",
      author: "Sam",
      ratingMilli: 5000,
      text: "Great gym",
      publishedAt: "2026-07-01T00:00:00.000Z",
    });
    assert.deepEqual(
      Object.keys(gotA[0]).sort(),
      ["author", "externalReviewId", "publishedAt", "ratingMilli", "text"],
      "getReviews returns exactly the StoredReview shape -- no id/competitorId/capturedAt leaking through",
    );
    assert.deepEqual(runWithTenant(tid, () => getReviews(idB)), [], "a competitor with no sample yet reads as [], not throwing");

    // Swap again with a different, smaller set — the OLD rows must be gone.
    runWithTenant(tid, () =>
      replaceReviews(
        idA,
        [{ externalReviewId: "r3", author: "Pat", ratingMilli: 4000, text: "Good value", publishedAt: null }],
        "2026-08-08",
      ),
    );
    reviewRows = getTenantDbById(tid).select().from(schema.competitorReviews).all();
    assert.equal(reviewRows.length, 1, "the previous review set was fully replaced, not appended to");
    assert.equal(reviewRows[0].externalReviewId, "r3");
    assert.equal(reviewRows[0].capturedAt, "2026-08-08");
    gotA = runWithTenant(tid, () => getReviews(idA));
    assert.deepEqual(gotA.map((r) => r.externalReviewId), ["r3"], "getReviews reflects the wholesale swap, not the old r1/r2 sample");

    // Swap down to zero reviews.
    runWithTenant(tid, () => replaceReviews(idA, [], "2026-08-15"));
    reviewRows = getTenantDbById(tid).select().from(schema.competitorReviews).all();
    assert.equal(reviewRows.length, 0, "an empty review set clears the sample entirely");
    assert.deepEqual(runWithTenant(tid, () => getReviews(idA)), [], "getReviews reflects the clear too");

    // ── 6. addEvent / listEvents / markEventsSeen ──
    // Three events with fully-explicit, distinct occurredAt values, so the
    // ordering assertions below are independent of the real wall clock.
    runWithTenant(tid, () =>
      addEvent({ competitorId: idA, type: "rating_up", summary: "Rating rose 4.2 -> 4.6", occurredAt: "2026-08-15T09:00:00.000Z" }),
    );
    runWithTenant(tid, () =>
      addEvent({ competitorId: idB, type: "review_spike", summary: "12 new reviews this week", occurredAt: "2026-08-12T09:00:00.000Z" }),
    );
    runWithTenant(tid, () =>
      addEvent({
        competitorId: null,
        type: "new_competitor",
        summary: "New gym discovered: Snap Fitness Clonmel",
        detailJson: JSON.stringify({ placeId: "places/CCC" }),
        occurredAt: "2026-08-10T09:00:00.000Z",
      }),
    );

    let events = runWithTenant(tid, () => listEvents());
    assert.equal(events.length, 3);
    assert.deepEqual(
      events.map((e) => e.summary),
      ["Rating rose 4.2 -> 4.6", "12 new reviews this week", "New gym discovered: Snap Fitness Clonmel"],
      "listEvents is newest-first",
    );

    const newCompetitorEvent = events.find((e) => e.type === "new_competitor")!;
    assert.equal(newCompetitorEvent.competitorId, null, "a new_competitor event can carry a null competitorId");
    assert.deepEqual(JSON.parse(newCompetitorEvent.detailJson!), { placeId: "places/CCC" });
    assert.equal(newCompetitorEvent.seen, false, "a fresh event starts unseen");
    assert.equal(typeof newCompetitorEvent.seen, "boolean", "seen round-trips as a real boolean, not 0/1");

    const limited = runWithTenant(tid, () => listEvents({ limit: 1 }));
    assert.equal(limited.length, 1);
    assert.equal(limited[0].summary, "Rating rose 4.2 -> 4.6", "limit keeps just the newest");

    // markEventsSeen + unseenOnly
    const ratingUpEvent = events.find((e) => e.type === "rating_up")!;
    const reviewSpikeEvent = events.find((e) => e.type === "review_spike")!;
    runWithTenant(tid, () => markEventsSeen([ratingUpEvent.id, newCompetitorEvent.id]));

    const unseen = runWithTenant(tid, () => listEvents({ unseenOnly: true }));
    assert.deepEqual(unseen.map((e) => e.id), [reviewSpikeEvent.id], "unseenOnly excludes the two just marked seen");

    events = runWithTenant(tid, () => listEvents());
    assert.equal(events.length, 3, "marking seen doesn't delete anything");
    assert.ok(events.find((e) => e.id === ratingUpEvent.id)!.seen, "marked event now reads seen=true");

    // markEventsSeen with an empty array is a safe no-op.
    runWithTenant(tid, () => markEventsSeen([]));
    assert.equal(runWithTenant(tid, () => listEvents({ unseenOnly: true })).length, 1, "empty markEventsSeen([]) changes nothing");

    // An omitted occurredAt defaults to ~now — checked in isolation (own
    // bounds against Date.now(), not mixed into the ordering assertions
    // above, so this can never depend on how "now" compares to the fixed
    // 2026-08-xx literals used elsewhere in this file).
    const beforeAdd = Date.now();
    runWithTenant(tid, () => addEvent({ competitorId: idA, type: "rating_down", summary: "defaults-occurredAt probe" }));
    const afterAdd = Date.now();
    const defaultedEvent = runWithTenant(tid, () => listEvents()).find((e) => e.summary === "defaults-occurredAt probe")!;
    const occurredMs = Date.parse(defaultedEvent.occurredAt);
    assert.ok(occurredMs >= beforeAdd && occurredMs <= afterAdd, "an omitted occurredAt defaults to ~now");

    // ── 7. DDL smoke test: the indexes ensureTenantTables declares exist ──
    const { sqlite } = openTenantDb(dbFile);
    const indexNames = (name: string) =>
      (
        sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=?").all(name) as {
          name: string;
        }[]
      ).map((r) => r.name);
    assert.ok(indexNames("competitors").includes("idx_competitors_place_id"));
    assert.ok(indexNames("competitors").includes("idx_competitors_distance"));
    assert.ok(indexNames("competitor_metrics").includes("idx_competitor_metrics_competitor"));
    assert.ok(indexNames("competitor_reviews").includes("idx_competitor_reviews_competitor"));
    assert.ok(indexNames("competitor_events").includes("idx_competitor_events_occurred"));
    assert.ok(indexNames("competitor_events").includes("idx_competitor_events_seen"));
    assert.ok(indexNames("competitor_ads").includes("idx_competitor_ads_competitor_ad"));
    assert.ok(indexNames("competitor_ads").includes("idx_competitor_ads_competitor"));
    assert.ok(indexNames("competitor_pages").includes("idx_competitor_pages_competitor"));

    // ── 8. competitor ads (Market Research P2, Task 3) ──
    const adA: AdLite = {
      adId: "ad-1",
      bodies: ["Summer offer!", "Join today"],
      linkTitle: "Join Now",
      linkCaption: "example.com",
      platforms: ["facebook", "instagram"],
      snapshotUrl: "https://facebook.com/ads/library/?id=ad-1",
      startedAt: "2026-08-01T00:00:00.000Z",
      pageName: "Iron Gym Official",
      pageId: "1000000001",
    };

    runWithTenant(tid, () => upsertAd(idA, adA, "2026-08-10T00:00:00.000Z"));
    let ads = runWithTenant(tid, () => listAds(idA));
    assert.equal(ads.length, 1, "one row after the first upsertAd");
    let adRowA = ads[0];
    assert.equal(adRowA.competitorId, idA);
    assert.equal(adRowA.adId, "ad-1");
    assert.deepEqual(adRowA.bodies, ["Summer offer!", "Join today"], "bodies round-trips as a real array, not a JSON string");
    assert.deepEqual(adRowA.platforms, ["facebook", "instagram"], "platforms round-trips as a real array too");
    assert.equal(adRowA.linkTitle, "Join Now");
    assert.equal(adRowA.linkCaption, "example.com");
    assert.equal(adRowA.snapshotUrl, "https://facebook.com/ads/library/?id=ad-1");
    assert.equal(adRowA.startedAt, "2026-08-01T00:00:00.000Z");
    assert.equal(adRowA.stoppedAt, null);
    assert.equal(adRowA.active, true, "active defaults to true on insert");
    assert.equal(typeof adRowA.active, "boolean", "active round-trips as a real boolean, not 0/1");
    assert.equal(adRowA.imageUrl, null);
    assert.equal(adRowA.pageName, "Iron Gym Official", "pageName round-trips (advertiser-page-match fix)");
    assert.equal(adRowA.pageId, "1000000001", "pageId round-trips too");
    assert.equal(adRowA.firstSeenAt, "2026-08-10T00:00:00.000Z");
    assert.equal(adRowA.lastSeenAt, "2026-08-10T00:00:00.000Z");
    const adAFirstSeen = adRowA.firstSeenAt;

    // A second ad with NO startedAt at all -- proves the JSON [] default for
    // an ad with no copy/platforms, and feeds the "nulls sort last" ordering
    // check below. pageName/pageId: "" mirrors what mapAdLite (adLibrary.ts)
    // actually sends when Meta doesn't return page_name/page_id for an ad --
    // required fields on AdLite, but "" rather than absent.
    const adNoDate: AdLite = {
      adId: "ad-nodate",
      bodies: [],
      platforms: [],
      snapshotUrl: "https://facebook.com/ads/library/?id=ad-nodate",
      pageName: "",
      pageId: "",
    };
    runWithTenant(tid, () => upsertAd(idA, adNoDate, "2026-08-10T00:00:00.000Z"));
    const noDateRow = runWithTenant(tid, () => listAds(idA)).find((a) => a.adId === "ad-nodate")!;
    assert.deepEqual(noDateRow.bodies, [], "an empty bodies array round-trips as [], not null");
    assert.deepEqual(noDateRow.platforms, []);
    assert.equal(noDateRow.startedAt, null);
    assert.equal(noDateRow.pageName, "", "an ad upserted with pageName '' round-trips as '', not null");
    assert.equal(noDateRow.pageId, "", "same for pageId");

    // A third ad with a LATER startedAt than adA.
    const adNewer: AdLite = {
      adId: "ad-2",
      bodies: ["New promo"],
      platforms: ["facebook"],
      snapshotUrl: "https://facebook.com/ads/library/?id=ad-2",
      startedAt: "2026-08-05T00:00:00.000Z",
      pageName: "Iron Gym Official",
      pageId: "1000000001",
    };
    runWithTenant(tid, () => upsertAd(idA, adNewer, "2026-08-10T00:00:00.000Z"));

    ads = runWithTenant(tid, () => listAds(idA));
    assert.deepEqual(
      ads.map((a) => a.adId),
      ["ad-2", "ad-1", "ad-nodate"],
      "listAds is newest-first by startedAt (2026-08-05 > 2026-08-01), with the no-startedAt row sorted last",
    );

    // Re-upsert ad-1 (same competitorId+adId) with different mutable fields
    // -- must update in place (still exactly 3 rows total) but keep
    // firstSeenAt, and set active back to true even though this upsert also
    // carries a (past) stoppedAt.
    runWithTenant(tid, () =>
      upsertAd(
        idA,
        {
          adId: "ad-1",
          bodies: ["Updated copy"],
          platforms: ["facebook"],
          snapshotUrl: "https://facebook.com/ads/library/?id=ad-1-v2",
          startedAt: "2026-08-01T00:00:00.000Z",
          stoppedAt: "2026-08-20T00:00:00.000Z",
          imageUrl: "https://example.com/creative.png",
          pageName: "Iron Gym (Rebrand)",
          pageId: "1000000009",
        },
        "2026-08-12T00:00:00.000Z",
      ),
    );
    ads = runWithTenant(tid, () => listAds(idA));
    assert.equal(ads.length, 3, "re-upserting the same (competitorId, adId) updates in place -- no dup row");
    adRowA = ads.find((a) => a.adId === "ad-1")!;
    assert.deepEqual(adRowA.bodies, ["Updated copy"], "mutable fields update in place");
    assert.equal(adRowA.snapshotUrl, "https://facebook.com/ads/library/?id=ad-1-v2");
    assert.equal(adRowA.stoppedAt, "2026-08-20T00:00:00.000Z");
    assert.equal(adRowA.imageUrl, "https://example.com/creative.png");
    assert.equal(adRowA.pageName, "Iron Gym (Rebrand)", "pageName is a mutable field too -- updates in place on re-upsert");
    assert.equal(adRowA.pageId, "1000000009", "pageId updates in place too");
    assert.equal(adRowA.lastSeenAt, "2026-08-12T00:00:00.000Z", "lastSeenAt advances to the re-upsert's `at`");
    assert.equal(adRowA.firstSeenAt, adAFirstSeen, "firstSeenAt is preserved across a re-upsert");
    assert.equal(adRowA.active, true, "active is unconditionally true on upsert, even though this row also carries a stoppedAt");

    // ── activeAdIds ──
    assert.deepEqual(
      [...runWithTenant(tid, () => activeAdIds(idA))].sort(),
      ["ad-1", "ad-2", "ad-nodate"],
      "activeAdIds reflects every currently-active row for this competitor",
    );

    // ── markAdsStopped ──
    runWithTenant(tid, () => markAdsStopped(idA, ["ad-2", "ad-nodate"], "2026-08-13T00:00:00.000Z"));
    ads = runWithTenant(tid, () => listAds(idA));
    assert.equal(ads.find((a) => a.adId === "ad-2")!.active, false, "markAdsStopped flips active to false");
    assert.equal(
      ads.find((a) => a.adId === "ad-2")!.stoppedAt,
      "2026-08-13T00:00:00.000Z",
      "markAdsStopped stamps stoppedAt when it wasn't already set",
    );
    assert.equal(ads.find((a) => a.adId === "ad-nodate")!.active, false);
    assert.equal(ads.find((a) => a.adId === "ad-nodate")!.stoppedAt, "2026-08-13T00:00:00.000Z");
    assert.equal(ads.find((a) => a.adId === "ad-1")!.active, true, "ad-1 (not in the stopped list) stays active");

    // markAdsStopped must NOT clobber an already-set stoppedAt: ad-1 already
    // carries stoppedAt = 2026-08-20 from the re-upsert above.
    runWithTenant(tid, () => markAdsStopped(idA, ["ad-1"], "2026-09-01T00:00:00.000Z"));
    const ad1Restopped = runWithTenant(tid, () => listAds(idA)).find((a) => a.adId === "ad-1")!;
    assert.equal(ad1Restopped.active, false);
    assert.equal(
      ad1Restopped.stoppedAt,
      "2026-08-20T00:00:00.000Z",
      "markAdsStopped preserves an existing stoppedAt rather than overwriting it",
    );

    // markAdsStopped with an empty array is a safe no-op (mirrors
    // markEventsSeen([])'s contract).
    runWithTenant(tid, () => markAdsStopped(idA, [], "2026-09-02T00:00:00.000Z"));
    assert.equal(
      runWithTenant(tid, () => activeAdIds(idA)).size,
      0,
      "empty markAdsStopped([]) changes nothing -- all 3 ads were already inactive",
    );

    // Re-upserting a stopped ad flips it back to active=true (see upsertAd's doc).
    runWithTenant(tid, () => upsertAd(idA, adNewer, "2026-09-03T00:00:00.000Z"));
    assert.equal(
      runWithTenant(tid, () => listAds(idA)).find((a) => a.adId === "ad-2")!.active,
      true,
      "re-upserting a previously-stopped ad sets active back to true",
    );

    // ── listAds({ activeOnly }) ──
    assert.deepEqual(
      runWithTenant(tid, () => listAds(idA, { activeOnly: true })).map((a) => a.adId),
      ["ad-2"],
      "activeOnly filters to just the currently-active row(s)",
    );

    // A second competitor's ads never leak into idA's results, and an
    // untouched competitor reads back empty rather than throwing.
    runWithTenant(tid, () =>
      upsertAd(
        idB,
        {
          adId: "ad-b1",
          bodies: [],
          platforms: [],
          snapshotUrl: "https://facebook.com/ads/library/?id=ad-b1",
          pageName: "",
          pageId: "",
        },
        "2026-08-10T00:00:00.000Z",
      ),
    );
    assert.deepEqual(
      runWithTenant(tid, () => listAds(idA))
        .map((a) => a.adId)
        .sort(),
      ["ad-1", "ad-2", "ad-nodate"],
      "listAds is scoped to the given competitorId only -- idB's ad doesn't leak in",
    );
    assert.equal(runWithTenant(tid, () => activeAdIds(idB)).size, 1);
    assert.deepEqual(runWithTenant(tid, () => listAds(idC)), [], "a competitor with no ads yet reads as [], not throwing");
    assert.deepEqual(runWithTenant(tid, () => activeAdIds(idC)), new Set(), "same for activeAdIds -- empty Set, not throwing");

    // ── pre-existing row simulation (advertiser-page-match fix's migration
    //    contract) -- a row written by code from BEFORE page_name/page_id
    //    existed has NULL in both columns at the SQL level (nullable, no
    //    default). Bypass upsertAd with a raw INSERT (same underlying
    //    connection openTenantDb cached above, so it's immediately visible
    //    to listAds through the ambient `db` proxy too) to reproduce exactly
    //    that, and prove it reads back as "" rather than null or throwing --
    //    see store.ts's toStoredAd + the migration note in lib/db/tenant.ts.
    //    "Only won't match the new filter until re-fetched" (refresh.ts) is
    //    a refresh.test.ts/adPageMatch.test.ts concern, not this store's. ──
    sqlite
      .prepare(
        `INSERT INTO competitor_ads
           (competitor_id, ad_id, bodies, platforms, snapshot_url, active, first_seen_at, last_seen_at)
         VALUES (?, ?, '[]', '[]', ?, 1, ?, ?)`,
      )
      .run(
        idC,
        "pre-migration-ad",
        "https://facebook.com/ads/library/?id=pre-migration-ad",
        "2026-08-01T00:00:00.000Z",
        "2026-08-01T00:00:00.000Z",
      );
    const preMigrationRow = runWithTenant(tid, () => listAds(idC)).find((a) => a.adId === "pre-migration-ad")!;
    assert.ok(preMigrationRow, "a raw pre-migration row (page_name/page_id columns never written) is still read back, not dropped");
    assert.equal(preMigrationRow.pageName, "", "NULL page_name (pre-migration row) reads back as '', not null and not throwing");
    assert.equal(preMigrationRow.pageId, "", "NULL page_id reads back as '' too");

    // ── setCompetitorAdAngle (cached on competitors.adAngleJson/adAngleAt, readable via listCompetitors) ──
    let compA = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idA)!;
    assert.equal(compA.adAngleJson, null, "adAngleJson is null before any ad-angle summary has run");
    assert.equal(compA.adAngleAt, null);

    runWithTenant(tid, () =>
      setCompetitorAdAngle(idA, JSON.stringify({ angle: "urgency + social proof" }), "2026-08-14T00:00:00.000Z"),
    );
    compA = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idA)!;
    assert.deepEqual(JSON.parse(compA.adAngleJson!), { angle: "urgency + social proof" }, "adAngleJson persists and is readable via listCompetitors");
    assert.equal(compA.adAngleAt, "2026-08-14T00:00:00.000Z");
    assert.equal(compA.themesJson, null, "setCompetitorAdAngle only touches the ad-angle columns, not the sibling themesJson cache");

    const compB = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idB)!;
    assert.equal(compB.adAngleJson, null, "setCompetitorAdAngle is scoped to the given competitorId only");

    // ── setCompetitorFacebookPage / clearCompetitorFacebookPage (exact Page-ID ad matching, Task 1) ──
    let rowForPage = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idB)!;
    assert.equal(rowForPage.facebookPageId, null, "facebookPageId is null before any link is set");
    assert.equal(rowForPage.facebookPageName, null, "facebookPageName is null before any link is set");

    runWithTenant(tid, () => setCompetitorFacebookPage(idB, "1234567890", "PureGym Clonmel Official"));
    rowForPage = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idB)!;
    assert.equal(rowForPage.facebookPageId, "1234567890", "setCompetitorFacebookPage sets facebookPageId");
    assert.equal(
      rowForPage.facebookPageName,
      "PureGym Clonmel Official",
      "setCompetitorFacebookPage sets facebookPageName",
    );

    const rowForPageOther = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idA)!;
    assert.equal(
      rowForPageOther.facebookPageId,
      null,
      "setCompetitorFacebookPage is scoped to the given competitor id only -- idA is untouched",
    );

    runWithTenant(tid, () => clearCompetitorFacebookPage(idB));
    rowForPage = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idB)!;
    assert.equal(rowForPage.facebookPageId, null, "clearCompetitorFacebookPage resets facebookPageId back to null");
    assert.equal(
      rowForPage.facebookPageName,
      null,
      "clearCompetitorFacebookPage resets facebookPageName back to null",
    );

    // A competitor that has never been linked reads back null/null by default.
    const rowFreshComp = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idC)!;
    assert.equal(rowFreshComp.facebookPageId, null, "a never-linked competitor defaults to facebookPageId null");
    assert.equal(rowFreshComp.facebookPageName, null, "a never-linked competitor defaults to facebookPageName null");

    // A pre-migration row (raw INSERT omitting the new columns entirely, same
    // technique as the competitor_ads pre-migration simulation above) reads
    // back null/null too -- safe, no throw.
    sqlite
      .prepare(
        `INSERT INTO competitors (place_id, name, address, lat, lng, distance_km, first_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "places/PRE-MIGRATION",
        "Pre-Migration Gym",
        "9 Pre St, Clonmel",
        52.358,
        -7.703,
        5.0,
        "2026-08-01T00:00:00.000Z",
      );
    const preMigrationCompetitor = runWithTenant(tid, () => listCompetitors()).find(
      (c) => c.placeId === "places/PRE-MIGRATION",
    )!;
    assert.ok(
      preMigrationCompetitor,
      "a raw pre-migration competitor row (facebook_page_id/name columns never written) is still read back, not dropped",
    );
    assert.equal(
      preMigrationCompetitor.facebookPageId,
      null,
      "NULL facebook_page_id (pre-migration row) reads back as null, not throwing",
    );
    assert.equal(preMigrationCompetitor.facebookPageName, null, "NULL facebook_page_name reads back as null too");

    // ── 9. Content-gap analysis: website + content-scan bookkeeping ──
    let compForWebsite = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idA)!;
    assert.equal(compForWebsite.websiteUri, null, "websiteUri is null before any scan/Places response sets it");
    assert.equal(compForWebsite.contentScannedAt, null, "contentScannedAt is null before the first scan");
    assert.equal(compForWebsite.contentTopicsJson, null, "contentTopicsJson is null before the first scan");

    runWithTenant(tid, () => setCompetitorWebsite(idA, "https://irongym.example.com"));
    compForWebsite = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idA)!;
    assert.equal(compForWebsite.websiteUri, "https://irongym.example.com", "setCompetitorWebsite persists");

    const scannedAt = new Date("2026-08-20T09:00:00.000Z");
    runWithTenant(tid, () => setCompetitorContentScannedAt(idA, scannedAt));
    compForWebsite = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idA)!;
    assert.ok(compForWebsite.contentScannedAt instanceof Date, "contentScannedAt round-trips as a real Date (timestamp_ms mode)");
    assert.equal(compForWebsite.contentScannedAt!.getTime(), scannedAt.getTime(), "setCompetitorContentScannedAt persists the exact instant");

    runWithTenant(tid, () => setCompetitorContentTopics(idA, JSON.stringify(["sports massage", "deep tissue massage"])));
    compForWebsite = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idA)!;
    assert.deepEqual(JSON.parse(compForWebsite.contentTopicsJson!), ["sports massage", "deep tissue massage"]);
    assert.equal(compForWebsite.themesJson, null, "setCompetitorContentTopics only touches its own column, not the sibling themesJson cache");

    const compForWebsiteOther = runWithTenant(tid, () => listCompetitors()).find((c) => c.id === idB)!;
    assert.equal(compForWebsiteOther.websiteUri, null, "setCompetitorWebsite is scoped to the given competitor id only");

    // ── 10. replaceCompetitorPages / listCompetitorPages (wholesale swap) ──
    assert.deepEqual(runWithTenant(tid, () => listCompetitorPages(idA)), [], "a competitor with no crawl yet reads as [], not throwing");

    const fetchedAt1 = new Date("2026-08-20T09:05:00.000Z");
    runWithTenant(tid, () =>
      replaceCompetitorPages(
        idA,
        [
          {
            url: "https://irongym.example.com/",
            path: "/",
            title: "Iron Gym | Home",
            metaDescription: "Welcome to Iron Gym",
            h1: "Welcome to Iron Gym",
            h2s: ["Our classes", "Opening hours"],
            wordCount: 180,
          },
          {
            url: "https://irongym.example.com/services/sports-massage",
            path: "/services/sports-massage",
            title: "Sports Massage",
            metaDescription: null,
            h1: "Sports Massage",
            h2s: [],
            wordCount: 320,
            topic: "sports massage",
          },
        ],
        fetchedAt1,
      ),
    );
    let pagesA = runWithTenant(tid, () => listCompetitorPages(idA));
    assert.equal(pagesA.length, 2, "both pages inserted");
    assert.deepEqual(pagesA.map((p) => p.url), ["https://irongym.example.com/", "https://irongym.example.com/services/sports-massage"], "insertion order preserved (id asc)");
    const homePage = pagesA[0];
    assert.equal(homePage.competitorId, idA);
    assert.equal(homePage.path, "/");
    assert.equal(homePage.title, "Iron Gym | Home");
    assert.equal(homePage.metaDescription, "Welcome to Iron Gym");
    assert.equal(homePage.h1, "Welcome to Iron Gym");
    assert.deepEqual(homePage.h2s, ["Our classes", "Opening hours"], "h2s round-trips as a real array, not a JSON string");
    assert.equal(homePage.wordCount, 180);
    assert.equal(homePage.topic, null, "topic defaults to null when omitted");
    assert.equal(typeof homePage.fetchedAt, "number", "fetchedAt round-trips as epoch ms (a number), not a Date");
    assert.equal(homePage.fetchedAt, fetchedAt1.getTime());
    const servicePage = pagesA[1];
    assert.deepEqual(servicePage.h2s, [], "an empty h2s array round-trips as [], not null");
    assert.equal(servicePage.topic, "sports massage", "an explicit topic is stored when given");

    assert.deepEqual(runWithTenant(tid, () => listCompetitorPages(idB)), [], "replaceCompetitorPages is scoped to the given competitor id only -- idB unaffected");

    // Swap again with a different, smaller set (down to 1 page) -- the OLD rows must be gone, not appended to.
    const fetchedAt2 = new Date("2026-08-21T09:00:00.000Z");
    runWithTenant(tid, () =>
      replaceCompetitorPages(
        idA,
        [{ url: "https://irongym.example.com/about", path: "/about", title: "About", metaDescription: null, h1: null, h2s: [], wordCount: 50 }],
        fetchedAt2,
      ),
    );
    pagesA = runWithTenant(tid, () => listCompetitorPages(idA));
    assert.equal(pagesA.length, 1, "the previous 2-page crawl was fully replaced, not appended to");
    assert.equal(pagesA[0].url, "https://irongym.example.com/about");
    assert.equal(pagesA[0].fetchedAt, fetchedAt2.getTime());

    // Swap down to zero pages (e.g. a re-scan that found nothing crawlable).
    runWithTenant(tid, () => replaceCompetitorPages(idA, [], new Date("2026-08-22T09:00:00.000Z")));
    assert.deepEqual(runWithTenant(tid, () => listCompetitorPages(idA)), [], "an empty page set clears the crawl entirely");

    // ── 11. listAllCompetitorPagesWithCompetitor (tenant-wide join) ──
    runWithTenant(tid, () =>
      replaceCompetitorPages(
        idA,
        [{ url: "https://irongym.example.com/", path: "/", title: "Iron Gym", metaDescription: null, h1: null, h2s: [], wordCount: 10 }],
        new Date("2026-08-23T00:00:00.000Z"),
      ),
    );
    runWithTenant(tid, () =>
      replaceCompetitorPages(
        idB,
        [{ url: "https://puregym.example.com/", path: "/", title: "PureGym", metaDescription: null, h1: null, h2s: [], wordCount: 10 }],
        new Date("2026-08-23T00:00:00.000Z"),
      ),
    );
    const allPages = runWithTenant(tid, () => listAllCompetitorPagesWithCompetitor());
    assert.equal(allPages.length, 2, "tenant-wide -- both competitors' pages show up in one call");
    const allPagesForA = allPages.find((p) => p.competitorId === idA)!;
    assert.equal(allPagesForA.competitorName, "Anytime Fitness Clonmel (renamed)", "joined competitorName matches the owning competitor's current name");
    assert.equal(allPagesForA.isSelf, false, "joined isSelf reflects the owning competitor's current flag");
    assert.equal(allPagesForA.title, "Iron Gym", "the page's own StoredCompetitorPage fields are still all present");
    const allPagesForB = allPages.find((p) => p.competitorId === idB)!;
    assert.equal(allPagesForB.competitorName, "PureGym Clonmel");

    console.log("research/store.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
