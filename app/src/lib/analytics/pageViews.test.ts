// Run: npm test -- src/lib/analytics/pageViews.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub called"); } };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { isBot, referrerDomain, cleanPath, cleanUtm, visitorHash, recordPageView, MAX_PATHS_PER_SITE_DAY } =
    requireLocal("./pageViews") as typeof import("./pageViews");

  assert.equal(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)"), true);
  assert.equal(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari/604.1"), false);
  assert.equal(isBot(null), true, "no user agent is treated as a bot");
  assert.equal(isBot("HeadlessChrome/120"), true);
  assert.equal(referrerDomain("https://www.google.com/search?q=x", "optimalhealthatinspire.ie"), "google.com");
  assert.equal(referrerDomain("https://optimalhealthatinspire.ie/about", "optimalhealthatinspire.ie"), "");
  assert.equal(referrerDomain("https://www.optimalhealthatinspire.ie/x", "optimalhealthatinspire.ie"), "", "www of own host is internal");
  assert.equal(referrerDomain("garbage", "a.ie"), "");
  assert.equal(cleanPath("/about/?x=1#top"), "/about");
  assert.equal(cleanPath("/"), "/");
  assert.equal(cleanPath("about"), null);
  assert.equal(cleanPath(5), null);
  assert.equal(cleanPath("/" + "a".repeat(400))?.length, 300);
  assert.equal(cleanUtm("Facebook Ads!"), "facebookads");
  assert.equal(cleanUtm(undefined), "");
  const h1 = visitorHash("s", "2026-10-02", 1, "1.2.3.4", "ua");
  assert.equal(h1.length, 64);
  assert.notEqual(h1, visitorHash("s", "2026-10-03", 1, "1.2.3.4", "ua"), "rotates daily");
  assert.notEqual(h1, visitorHash("s", "2026-10-02", 2, "1.2.3.4", "ua"), "per site");

  // DB part
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const slug = "page-views-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Page Views Test", `tenants/${slug}/${slug}.db`) as { id: number };
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };
  try {
    const conn = getTenantDbById(t.id);
    const raw = (q: string) => (conn as unknown as { $client: { prepare(q: string): { all(): any[] } } }).$client.prepare(q).all();
    const hit = (o: Partial<Parameters<typeof recordPageView>[1]> = {}) => ({
      siteId: 1, day: "2026-10-02", path: "/about", referrerDomain: "", utmSource: "", hash: "A", ...o,
    });
    recordPageView(conn, hit());
    recordPageView(conn, hit());
    let row = raw("SELECT * FROM site_page_views_daily")[0];
    assert.equal(row.views, 2);
    assert.equal(row.uniques, 1);
    assert.equal(raw("SELECT uniques FROM site_visitors_daily")[0].uniques, 1);
    recordPageView(conn, hit({ hash: "B" }));
    assert.equal(raw("SELECT uniques FROM site_visitors_daily")[0].uniques, 2);
    recordPageView(conn, hit({ hash: "A", referrerDomain: "google.com" }));
    assert.equal(raw("SELECT * FROM site_page_views_daily").length, 2, "different referrer is a separate row");
    assert.equal(raw("SELECT uniques FROM site_visitors_daily")[0].uniques, 2, "same visitor not recounted on site");
    recordPageView(conn, hit({ day: "2026-10-03" }));
    assert.equal(raw("SELECT * FROM site_visitor_hashes WHERE day = '2026-10-02'").length, 0, "old hashes purged");
    assert.equal(raw("SELECT * FROM site_page_views_daily WHERE day = '2026-10-02'").length, 2, "aggregates stay");
    assert.doesNotThrow(() => recordPageView(null as never, hit()));

    // Path cardinality cap: new paths beyond the cap fold into "/other".
    assert.equal(MAX_PATHS_PER_SITE_DAY, 500);
    const d = "2026-11-01";
    recordPageView(conn, hit({ day: d, path: "/p1", hash: "X" }), { maxPaths: 2 });
    recordPageView(conn, hit({ day: d, path: "/p2", hash: "X" }), { maxPaths: 2 });
    recordPageView(conn, hit({ day: d, path: "/p3", hash: "X", referrerDomain: "google.com", utmSource: "fb" }), { maxPaths: 2 });
    recordPageView(conn, hit({ day: d, path: "/p1", hash: "Y" }), { maxPaths: 2 });
    const rows = raw(`SELECT path, views, referrer_domain, utm_source FROM site_page_views_daily WHERE day = '${d}' ORDER BY path`);
    assert.deepEqual(rows.map((r) => r.path), ["/other", "/p1", "/p2"], "third new path folded into /other");
    assert.equal(rows.find((r) => r.path === "/p1").views, 2, "existing path still increments");
    const other = rows.find((r) => r.path === "/other");
    assert.equal(other.referrer_domain, "google.com");
    assert.equal(other.utm_source, "fb");
  } finally {
    cleanup();
  }
  console.log("pageViews tests passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
