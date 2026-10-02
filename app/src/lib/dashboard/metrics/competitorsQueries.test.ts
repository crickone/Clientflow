// Run: npm test -- src/lib/dashboard/metrics/competitorsQueries.test.ts
//
// Smoke test: every competitorsQueries loader once against a scratch tenant
// seeded through the research store (a self row plus two tracked competitors).
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
    return { redirect: () => { throw new Error("redirect stub called unexpectedly"); } };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../../db/control") as typeof import("../../db/control");
  const { runWithTenant } = requireLocal("../../db/tenant") as typeof import("../../db/tenant");
  const store = requireLocal("../../research/store") as typeof import("../../research/store");
  const spend = requireLocal("../../research/spend") as typeof import("../../research/spend");
  const q = requireLocal("./competitorsQueries") as typeof import("./competitorsQueries");

  const slug = "dashboard-competitors-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Dashboard Competitors Test", `tenants/${slug}/${slug}.db`) as { id: number };
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM research_usage WHERE tenant_id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const DAY = 86_400_000;
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  try {
    await runWithTenant(t.id, async () => {
      const base = { address: "x", lat: 53, lng: -6 };
      const selfId = store.upsertCompetitor({ ...base, placeId: "self", name: "Own Clinic", distanceKm: 0, isSelf: true });
      const aId = store.upsertCompetitor({ ...base, placeId: "a", name: "Rival A", distanceKm: 1 });
      const bId = store.upsertCompetitor({ ...base, placeId: "b", name: "Rival B", distanceKm: 2 });

      store.appendMetric(selfId, 4600, 120, iso(now - 20 * DAY));
      store.appendMetric(selfId, 4700, 130, iso(now - 2 * DAY));
      store.appendMetric(aId, 4200, 200, iso(now - 20 * DAY));
      store.appendMetric(aId, 4300, 210, iso(now - 2 * DAY));
      store.appendMetric(bId, 4000, 100, iso(now - 2 * DAY));

      store.replaceReviews(aId, [
        { externalReviewId: "r1", author: "Ann", ratingMilli: 5000, text: "Great", publishedAt: iso(now - 3 * DAY) },
        { externalReviewId: "r2", author: "Bob", ratingMilli: 3000, text: "Fine", publishedAt: iso(now - 9 * DAY) },
      ], iso(now));
      store.replaceReviews(bId, [{ externalReviewId: "r3", author: "Cy", ratingMilli: 4000, text: "Ok", publishedAt: iso(now - DAY) }], iso(now));

      store.upsertAd(aId, { adId: "ad1", bodies: ["Try our offer"], platforms: ["facebook"], snapshotUrl: "u", startedAt: iso(now - 5 * DAY), pageName: "Rival A Page", pageId: "1" }, iso(now));
      store.upsertAd(bId, { adId: "ad2", bodies: [], platforms: [], snapshotUrl: "u", startedAt: iso(now - 40 * DAY), stoppedAt: iso(now - DAY), pageName: "", pageId: "" }, iso(now));
      store.markAdsStopped(bId, ["ad2"], iso(now));

      store.addEvent({ competitorId: aId, type: "new_ad", summary: "Rival A started an ad", occurredAt: iso(now - DAY) });
      store.addEvent({ competitorId: bId, type: "rating_down", summary: "Rival B rating fell", occurredAt: iso(now - 2 * DAY) });
      store.addEvent({ competitorId: aId, type: "new_ad", summary: "Old ad", occurredAt: iso(now - 60 * DAY) });
      spend.recordResearchSpend(t.id, 120, "test");

      const gap = q.reviewGapData();
      assert.deepEqual(gap, { hasSelf: true, self: 130, others: 155, competitors: 2 });
      assert.equal(q.ratingGap().self, 4.7);

      assert.equal(q.newAdCount(now - 7 * DAY, now + DAY), 1);
      assert.equal(q.newAdCount(now - 90 * DAY, now + DAY), 2);
      assert.deepEqual(q.researchSpend(t.id), { spentCents: 120, capCents: spend.DEFAULT_RESEARCH_CAP_CENTS });

      const trend = q.trendHistories(4, 26);
      assert.deepEqual(trend.map((h) => h.name), ["You", "Rival A", "Rival B"]);
      assert.equal(trend[0].history.length, 2);
      assert.equal(q.trendHistories(1, 26).length, 2, "limit bounds competitors");

      const reviews = q.trackedReviews();
      assert.equal(reviews.length, 3);
      assert.ok(reviews.some((r) => r.author === "Ann" && r.competitor === "Rival A"));

      const act = q.recentActivity(10);
      assert.equal(act.length, 3);
      assert.equal(act[0].competitor, "Rival A");
      assert.equal(q.recentActivity(1).length, 1);

      const ads = q.activeAds(8);
      assert.deepEqual(ads.map((a) => [a.adId, a.competitor]), [["ad1", "Rival A"]], "stopped ads excluded");
    });
    console.log("competitorsQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
