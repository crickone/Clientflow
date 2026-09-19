// Run: npm test -- src/lib/cms/syncBundledSite.test.ts
//
// The boot sync publishes a bespoke client site from the build. It writes to a
// real client's live website, so the two guards are the whole point of the
// test, not an afterthought:
//
//   1. the content-hash gate — a redeploy that changed no HTML must write
//      NOTHING, or every deploy would churn a client's pages;
//   2. the Studio guard — a page a human edited in the visual editor must be
//      left exactly as they left it, while the pages around it still publish.
//
// Everything is built from scratch in a temporary directory: app/data is
// gitignored, so a test that copied the development databases would pass here
// and fail in CI.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Module from "node:module";

// The tenant database helper reaches for React's `cache`, whose real entry
// point throws under --conditions=react-server. Stub it, as the other tests
// that touch the database layer do.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "syncbundle-"));
fs.mkdirSync(path.join(SANDBOX, "public", "sites", "inspire"), { recursive: true });

// The modules under test resolve their data directory from process.cwd() at
// import time, so the move has to happen before the first import.
const ORIGINAL_CWD = process.cwd();
process.chdir(SANDBOX);

const writeBundle = (rev: string, pages: Array<{ key: string; path: string; title: string; desc: string; body: string }>) =>
  fs.writeFileSync(
    path.join(SANDBOX, "public", "sites", "inspire", "_pages.json"),
    JSON.stringify({ slug: "inspire", tenant: "inspire", rev, pages }),
  );

const page = (key: string, body: string) => ({
  key,
  path: key === "index" ? "/" : `/${key}`,
  title: `${key} title`,
  desc: `${key} description`,
  body,
});

(async () => {
  try {
    const { syncBundledSites } = await import("./syncBundledSite");
    const { controlSqlite } = await import("../db/control");
    const { getTenantBySlug, openTenantDb } = await import("../db/tenant");
    const { getPlatformSetting } = await import("../billing/settings");

    // A tenant and a site for the bundle to land in.
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1)")
      .run("inspire", "Inspire", "tenants/inspire/inspire.db");
    const tenant = getTenantBySlug("inspire");
    assert.ok(tenant, "the tenant is registered");
    const { sqlite } = openTenantDb(tenant.dbFile);
    sqlite.prepare("INSERT INTO sites (slug, name, status) VALUES ('inspire', 'Inspire', 'live')").run();
    const sid = (sqlite.prepare("SELECT id FROM sites WHERE slug='inspire'").get() as { id: number }).id;

    const bodyOf = (p: string) =>
      (
        sqlite
          .prepare(
            "SELECT cb.value v FROM pages p JOIN content_blocks cb ON cb.page_id = p.id AND cb.name = 'body' WHERE p.site_id = ? AND p.path = ?",
          )
          .get(sid, p) as { v: string } | undefined
      )?.v;
    const stampOf = (p: string) =>
      (
        sqlite
          .prepare(
            "SELECT cb.updated_at u FROM pages p JOIN content_blocks cb ON cb.page_id = p.id AND cb.name = 'body' WHERE p.site_id = ? AND p.path = ?",
          )
          .get(sid, p) as { u: number } | undefined
      )?.u;

    // ── a new bundle publishes ───────────────────────────────────────────
    writeBundle("rev-one", [page("index", "<p>home one</p>"), page("about", "<p>about one</p>")]);
    syncBundledSites();

    assert.equal(bodyOf("/"), "<p>home one</p>", "the home page is published");
    assert.equal(bodyOf("/about"), "<p>about one</p>", "…and so is the second page");
    assert.equal(getPlatformSetting("site_bundle_rev_inspire"), "rev-one", "the applied rev is recorded");

    const published = sqlite
      .prepare("SELECT status, template_id FROM pages WHERE site_id = ? AND path = '/'")
      .get(sid) as { status: string; template_id: string };
    assert.equal(published.status, "published", "pages arrive published, not as drafts");
    assert.equal(published.template_id, "clientflow-live", "…on the verbatim-HTML template");

    const seo = sqlite
      .prepare(
        "SELECT seo_title t FROM seo_meta s JOIN pages p ON p.id = s.page_id WHERE p.site_id = ? AND p.path = '/'",
      )
      .get(sid) as { t: string };
    assert.equal(seo.t, "index title", "SEO travels with the page");

    // ── GUARD 1: the same bundle again must write nothing ────────────────
    const before = [stampOf("/"), stampOf("/about")];
    syncBundledSites();
    assert.deepEqual([stampOf("/"), stampOf("/about")], before, "a redeploy with an unchanged bundle is INERT");

    // ── GUARD 2: a Studio edit outranks the file on disk ─────────────────
    const aboutId = (
      sqlite.prepare("SELECT id FROM pages WHERE site_id = ? AND path = '/about'").get(sid) as { id: number }
    ).id;
    const byHand = "<p>a human wrote this in Studio</p>";
    sqlite
      .prepare("UPDATE content_blocks SET value = ?, updated_by = 7 WHERE page_id = ? AND name = 'body'")
      .run(byHand, aboutId);

    writeBundle("rev-two", [page("index", "<p>home two</p>"), page("about", "<p>about two</p>")]);
    syncBundledSites();

    assert.equal(bodyOf("/about"), byHand, "THE STUDIO EDIT IS NOT OVERWRITTEN");
    assert.equal(bodyOf("/"), "<p>home two</p>", "…and the pages around it still publish");
    assert.equal(getPlatformSetting("site_bundle_rev_inspire"), "rev-two", "the new rev is recorded");

    // Recording the rev even when a page was skipped is what stops the sync
    // reopening the same transaction on every single boot.
    const afterSkip = stampOf("/");
    syncBundledSites();
    assert.equal(stampOf("/"), afterSkip, "and the skip does not leave the bundle pending forever");

    // ── a missing bundle is simply nothing to do ─────────────────────────
    fs.rmSync(path.join(SANDBOX, "public", "sites", "inspire", "_pages.json"));
    assert.doesNotThrow(() => syncBundledSites(), "no bundle in the build is not an error");

    // ── THE COMMITTED BUNDLE IS UP TO DATE ───────────────────────────────
    // The Docker build context is app/, so it cannot see sites/ and cannot
    // regenerate the bundle. That makes the committed file the thing that
    // ships, and a stale one would recreate the exact bug this module exists
    // to fix: edit the HTML, deploy, and the website does not change. CI runs
    // the tests on every push, so checking it here is what keeps the two in
    // step. Run `node tools/build-site-bundle.cjs --slug inspire` to fix.
    const repoRoot = path.resolve(ORIGINAL_CWD, "..");
    const sourceDir = path.join(repoRoot, "sites", "inspire");
    const committed = path.join(ORIGINAL_CWD, "public", "sites", "inspire", "_pages.json");
    if (fs.existsSync(sourceDir) && fs.existsSync(committed)) {
      const { createRequire } = await import("node:module");
      const requireRoot = createRequire(path.join(repoRoot, "package.json"));
      const { readSitePages } = requireRoot("./tools/lib/siteHtml.cjs") as {
        readSitePages: (dir: string, slug: string) => unknown[];
      };
      const crypto = await import("node:crypto");
      const fresh = crypto
        .createHash("sha256")
        .update(JSON.stringify(readSitePages(sourceDir, "inspire")))
        .digest("hex")
        .slice(0, 16);
      const shipped = JSON.parse(fs.readFileSync(committed, "utf8")).rev as string;
      assert.equal(
        shipped,
        fresh,
        "the committed page bundle is stale — run `node tools/build-site-bundle.cjs --slug inspire` and commit the result",
      );
    }

    console.log("syncBundledSite.test.ts: all assertions passed");
  } finally {
    process.chdir(ORIGINAL_CWD);
    fs.rmSync(SANDBOX, { recursive: true, force: true });
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
