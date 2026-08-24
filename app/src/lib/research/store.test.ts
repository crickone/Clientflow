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

    console.log("research/store.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
