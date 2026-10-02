// Run: npm test -- src/lib/dashboard/metrics/websiteQueries.test.ts
//
// Smoke test: every websiteQueries loader once against a scratch tenant
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
  const q = requireLocal("./websiteQueries") as typeof import("./websiteQueries");

  const slug = "dashboard-website-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Dashboard Website Test", `tenants/${slug}/${slug}.db`) as { id: number };
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
      const site = db.insert(schema.sites).values({ slug: "wt", name: "WT" }).returning().get();
      db.insert(schema.sitePageViewsDaily).values([
        { siteId: site.id, day: today, path: "/", referrerDomain: "google.com", utmSource: "", views: 3, uniques: 3 },
        { siteId: site.id, day: today, path: "/blog/hello", referrerDomain: "", utmSource: "facebook", views: 4, uniques: 4 },
        { siteId: site.id, day: today, path: "/about", referrerDomain: "", utmSource: "", views: 1, uniques: 1 },
      ]).run();
      db.insert(schema.siteVisitorsDaily).values([{ siteId: site.id, day: today, uniques: 6 }]).run();
      db.insert(schema.blogPosts).values({ title: "Hello post", inputMode: "prompt", slug: "hello", siteId: site.id }).run();
      const form = db.insert(schema.forms).values({ type: "contact", title: "Contact" }).returning().get();
      db.insert(schema.formSubmissions).values([
        { formId: form.id, tenantId: t.id, payload: "{}" },
        { formId: form.id, tenantId: t.id, payload: "{}" },
        { formId: form.id, tenantId: t.id, payload: "{}", createdAt: new Date(now - 60 * DAY) },
      ]).run();
      const page = db.insert(schema.pages).values({ siteId: site.id, pageKey: "home", path: "/", title: "Home page", templateId: "x" }).returning().get();
      db.insert(schema.pageRevisions).values([
        { siteId: site.id, pageId: page.id, body: "a", source: "studio", createdAt: new Date(now - 2 * DAY) },
        { siteId: site.id, pageId: page.id, body: "b", source: "agent", createdAt: new Date(now - DAY) },
      ]).run();
      db.insert(schema.siteRequests).values([{ businessName: "A" }, { businessName: "B", status: "fulfilled" }]).run();

      const vs = q.visitorsSeries(from, to);
      assert.equal(vs.total, 6);
      assert.equal(q.visitorsTotal(from, to), 6);
      const ps = q.pageViewsSeries(from, to);
      assert.equal(ps.labels.length, ps.values.length);
      assert.equal(ps.total, 8);
      assert.equal(q.pageViewsTotal(from, to), 8);
      assert.equal(q.pageViewsTotal(from - 30 * DAY, from - 20 * DAY), 0);

      const pv = q.pathViews(from, to);
      assert.equal(pv.reduce((s, r) => s + r.views, 0), 8);
      assert.deepEqual(q.pathViews(from, to, "%/blog/%"), [{ path: "/blog/hello", views: 4 }]);
      assert.deepEqual([...q.blogTitlesBySlug(["hello", "nope"])], [["hello", "Hello post"]]);
      assert.deepEqual(q.blogTitlesBySlug([]).size, 0);

      assert.equal(q.trafficRows(from, to).reduce((s, r) => s + r.views, 0), 8);
      assert.equal(q.formSubmissionsIn(from, to), 2);
      assert.deepEqual(q.submissionsByForm(from, to, 8), [{ label: "Contact", value: 2 }]);

      const edits = q.recentEdits(8);
      assert.deepEqual(edits.map((e) => [e.page, e.source]), [["Home page", "agent"], ["Home page", "studio"]], "newest first");
      assert.equal(q.openRequestCount(), 1);
    });
    console.log("websiteQueries.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
