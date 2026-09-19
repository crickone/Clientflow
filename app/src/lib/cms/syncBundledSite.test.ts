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
    const { openTenantDb } = await import("../db/tenant");
    const { getTenantBySlug } = await import("../tenants");
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
    const tenantId = tenant.id;
    assert.equal(
      getPlatformSetting("site_bundle_rev_inspire"),
      `${tenantId}:rev-one`,
      "the marker records the hash AND the tenant it was applied to",
    );

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
    assert.equal(getPlatformSetting("site_bundle_rev_inspire"), `${tenantId}:rev-two`, "the new rev is recorded");

    // Recording the rev even when a page was skipped is what stops the sync
    // reopening the same transaction on every single boot.
    const afterSkip = stampOf("/");
    syncBundledSites();
    assert.equal(stampOf("/"), afterSkip, "and the skip does not leave the bundle pending forever");

    // ── THE SHADOWED-COPY BUG ────────────────────────────────────────────
    // A site slug is unique within a tenant, not across them. The public
    // renderer serves the FIRST active tenant in registry order that has the
    // slug, so publishing to "the tenant of the same name" can write a
    // perfect copy of every page into a database nobody reads — which looks
    // exactly like success and is how the Inspire site stayed stale through
    // a deploy that reported publishing it.
    controlSqlite
      .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1)")
      .run("legacy-first", "Legacy", "tenants/legacy/legacy.db");
    // Registry order is insertion order, and this tenant was added AFTER the
    // first one, so the original still wins. Give it the same slug anyway to
    // prove the sync picks by resolution order rather than by name.
    const legacy = getTenantBySlug("legacy-first")!;
    const legacyConn = openTenantDb(legacy.dbFile);
    legacyConn.sqlite.prepare("INSERT INTO sites (slug, name, status) VALUES ('inspire', 'Shadow', 'live')").run();

    writeBundle("rev-three", [page("index", "<p>home three</p>")]);
    syncBundledSites();

    assert.equal(bodyOf("/"), "<p>home three</p>", "the sync publishes to the tenant the renderer resolves to");
    const shadowPages = legacyConn.sqlite
      .prepare("SELECT count(*) c FROM pages")
      .get() as { c: number };
    assert.equal(shadowPages.c, 0, "…and writes NOTHING into the shadowed copy");
    assert.equal(
      getPlatformSetting("site_bundle_rev_inspire"),
      `${tenantId}:rev-three`,
      "the marker still names the tenant actually written to",
    );

    // ── THE BLOG SEED IS CREATE-ONLY ─────────────────────────────────────
    // Pages are upserted because the repo owns them. A blog post is the
    // client's own writing — they will edit it, retitle it, add to it — so
    // the seed may create what is missing and must NEVER touch what exists.
    // That is the entire safety story for carrying 22 articles across from a
    // site we are replacing, so it is the thing to assert.
    const writePosts = (posts: Array<{ slug: string; title: string; content: string }>) =>
      fs.writeFileSync(
        path.join(SANDBOX, "public", "sites", "inspire", "_posts.json"),
        JSON.stringify({
          posts: posts.map((p) => ({
            ...p,
            excerpt: `${p.slug} excerpt`,
            seoTitle: `${p.title} | SEO`,
            seoDescription: "",
            coverImageUrl: null,
            sourceUrl: `https://old.example/${p.slug}`,
          })),
        }),
      );

    writePosts([
      { slug: "first-post", title: "First post", content: "# First\n\nHello." },
      { slug: "second-post", title: "Second post", content: "# Second\n\nAlso hello." },
    ]);
    syncBundledSites();

    const postRow = (slug: string) =>
      sqlite
        .prepare("SELECT * FROM blog_posts WHERE site_id = ? AND slug = ?")
        .get(sid, slug) as
        | { id: number; title: string; content: string; publish_state: string; published_at: number | null; seo_title: string | null; excerpt: string | null }
        | undefined;

    assert.ok(postRow("first-post"), "a post from the bundle is created");
    assert.ok(postRow("second-post"), "…and so is the second");
    assert.equal(postRow("first-post")!.publish_state, "published", "posts arrive PUBLISHED, matching the site being replaced");
    assert.ok(postRow("first-post")!.published_at, "…with a published timestamp, so they sort correctly");
    assert.equal(postRow("first-post")!.seo_title, "First post | SEO", "SEO travels with the post");
    assert.equal(postRow("first-post")!.excerpt, "first-post excerpt", "…and so does the excerpt");

    // Running the same bundle again is inert.
    const firstId = postRow("first-post")!.id;
    syncBundledSites();
    assert.equal(postRow("first-post")!.id, firstId, "the same bundle does not duplicate posts");

    // THE PROPERTY: an edited post is never overwritten, even by a changed
    // bundle, and a genuinely new post still lands beside it.
    sqlite
      .prepare("UPDATE blog_posts SET title = ?, content = ? WHERE id = ?")
      .run("The client retitled this", "Rewritten by a human.", firstId);
    writePosts([
      { slug: "first-post", title: "First post", content: "# First\n\nHello, revised." },
      { slug: "second-post", title: "Second post", content: "# Second\n\nAlso hello." },
      { slug: "third-post", title: "Third post", content: "# Third\n\nBrand new." },
    ]);
    syncBundledSites();

    assert.equal(postRow("first-post")!.title, "The client retitled this", "AN EXISTING POST IS NEVER OVERWRITTEN");
    assert.equal(postRow("first-post")!.content, "Rewritten by a human.", "…not its title and not its body");
    assert.ok(postRow("third-post"), "…while a genuinely new post is still created");
    assert.equal(
      (sqlite.prepare("SELECT count(*) c FROM blog_posts WHERE site_id = ?").get(sid) as { c: number }).c,
      3,
      "three posts in total — nothing duplicated",
    );

    // A post with no slug, title or content is skipped rather than inserted
    // as a broken row. The Inspire blog already had one of those.
    writePosts([{ slug: "", title: "", content: "" }]);
    syncBundledSites();
    assert.equal(
      (sqlite.prepare("SELECT count(*) c FROM blog_posts WHERE site_id = ?").get(sid) as { c: number }).c,
      3,
      "an empty post entry creates nothing",
    );

    fs.rmSync(path.join(SANDBOX, "public", "sites", "inspire", "_posts.json"));

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
