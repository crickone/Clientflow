// Run: npm test -- src/lib/dashboard/metrics/marketingQueries.test.ts
//
// Smoke test: every marketingQueries loader once against a scratch tenant
// with a little seeded data. Shape plus at least one non-trivial value each.
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
  const { db, schema } = requireLocal("../../db") as typeof import("../../db");
  const q = requireLocal("./marketingQueries") as typeof import("./marketingQueries");

  const slug = "dashboard-marketing-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Dashboard Marketing Test", `tenants/${slug}/${slug}.db`) as { id: number };
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };

  const DAY = 86_400_000;
  const now = Date.now();
  const from = now - 7 * DAY;
  const to = now + DAY;
  const today = new Date(now).toISOString().slice(0, 10);

  try {
    await runWithTenant(t.id, async () => {
      db.insert(schema.campaigns).values([
        { name: "Spring", slug: "spring", status: "active", adSpendCents: 10_000 },
        { name: "Summer", slug: "summer", status: "ready" },
        { name: "Old", slug: "old", status: "complete", adSpendCents: 5_000 },
      ]).run();
      db.insert(schema.leads).values([
        { source: "form", campaign: "Spring" },
        { source: "form", campaign: "Spring" },
        { source: "manual" },
      ]).run();
      db.insert(schema.sitePageViewsDaily).values([
        { siteId: 1, day: today, path: "/c/spring", referrerDomain: "", utmSource: "facebook", views: 5, uniques: 4 },
        { siteId: 1, day: today, path: "/", referrerDomain: "google.com", utmSource: "", views: 3, uniques: 3 },
        { siteId: 1, day: today, path: "/", referrerDomain: "", utmSource: "", views: 2, uniques: 2 },
      ]).run();
      db.insert(schema.siteVisitorsDaily).values([{ siteId: 1, day: today, uniques: 7 }]).run();
      const form = db.insert(schema.forms).values({ type: "contact", title: "Contact" }).returning().get();
      db.insert(schema.formSubmissions).values({ formId: form.id, tenantId: t.id, payload: "{}" }).run();
      const set = db.insert(schema.carouselSets).values({ name: "Spring post" }).returning().get();
      db.insert(schema.scheduledPosts).values({ carouselSetId: set.id, scheduledFor: new Date(now + 2 * DAY), status: "scheduled" }).run();
      db.insert(schema.emailCampaigns).values({
        name: "Spring email", subject: "s", fromName: "f", fromEmail: "f@example.com", bodyHtml: "<p>x</p>",
        audience: '{"kind":"all_subscribed"}', status: "scheduled", scheduledAt: new Date(now + DAY),
      }).run();

      assert.deepEqual(q.campaignsByStatus(), { active: 1, ready: 1 });
      assert.equal(q.countCampaignLeadsIn(from, to), 2);
      assert.equal(q.campaignLeadCountsIn(from, to).get("Spring"), 2);

      const scored = await q.scoredCampaigns();
      assert.deepEqual(scored.map((s) => s.campaign.name).sort(), ["Old", "Spring"], "active + complete only");
      const spring = scored.find((s) => s.campaign.name === "Spring")!;
      assert.equal(spring.score.leads, 2);
      assert.equal(spring.score.adSpendCents, 10_000);

      assert.equal(q.landingViewsIn("spring", from, to), 5);
      assert.equal(q.landingViewsIn("spring", from - 30 * DAY, from - 20 * DAY), 0);

      const vs = q.visitorsSeries(from, to);
      assert.equal(vs.labels.length, vs.values.length);
      assert.equal(vs.total, 7);
      assert.equal(q.visitorsTotal(from, to), 7);

      const tr = q.trafficRows(from, to);
      assert.equal(tr.reduce((s, r) => s + r.views, 0), 10);
      assert.ok(tr.some((r) => r.utm === "facebook" && r.views === 5));

      assert.equal(q.formSubmissionsIn(from, to), 1);

      const up = q.upcomingSendItems(now, 14, 8);
      assert.deepEqual(up.map((u) => [u.name, u.kind]), [["Spring email", "email"], ["Spring post", "post"]], "soonest first");

      assert.match(q.dublinToday(new Date(now)), /^\d{4}-\d{2}-\d{2}$/);
      const sd = q.seasonalDates(new Date(Date.UTC(2026, 11, 20)), 6);
      assert.ok(sd.length > 0 && sd.length <= 6);
      assert.ok(sd.every((x) => typeof x.inDays === "number" && x.inDays >= 0));

      const rg = q.ratingGap();
      assert.deepEqual(rg, { hasSelf: false, self: null, others: null, competitors: 0 });
    });
    console.log("marketingQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
