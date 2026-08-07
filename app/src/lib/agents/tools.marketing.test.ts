// Run: npm test -- src/lib/agents/tools.marketing.test.ts
//
// Verifies Marketing Task 1 (Marketing tools + registry wiring + metering):
// the two WRITE tools (save_blog_post, publish_blog_post) are registered in
// @/lib/assistant/tools's WRITE_TOOLS (the code-level barrier that keeps them
// off the chat loop's auto-execute path and forces an operator Approve click)
// while the three READ tools (list_blog_posts, draft_blog_post,
// draft_carousel) are NOT; that all 5 tools are registered in TOOLS;
// resolveSite's site-scoping (no siteId + exactly one site on the tenant ->
// resolves it; a siteId belonging to a DIFFERENT tenant -> an error result,
// never a silent cross-tenant match); and that save_blog_post/
// publish_blog_post actually persist the expected state (status "ready",
// publishState "draft" -> then "published" on publish).
//
// Does NOT invoke draftBlogPost/generateCarouselSlides (draft_blog_post /
// draft_carousel) — this environment has no Claude credentials. Those two
// tools are only checked for registration (TOOLS) and absence from
// WRITE_TOOLS.
//
// NOTE: this repo does NOT use vitest — tests are plain node:assert/strict
// scripts run via `npm test -- <path>` (see scripts/test.mjs). This mirrors
// the exact pattern of src/lib/agents/tools.sales.test.ts (Task 7).
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";

// tools.marketing.ts -> @/lib/db/tenant (react `cache`, next/headers) and,
// separately, -> @/lib/ai/draftBlog / @/lib/ai/generateCarousel ->
// @/lib/ai/businessContext, and -> @/lib/cms/blog / @/lib/blog/posts — all
// three of those pull in @/lib/db (the ambient `db` proxy) -> @/lib/tenants
// -> @/lib/auth -> `next/navigation`. Same two-part shim as
// tools.sales.test.ts / context.test.ts, for the same reason: under the
// runner's `--conditions=react-server`, npm's react "react-server" entry
// throws on load, so `cache` needs stubbing; and next/navigation's real
// module drags in Next's client-router internals which need genuine React
// internals we don't have reason to load here (redirect() is never actually
// called in this test's code path). Installed via a dynamic require (below)
// rather than a static import, since a static `import ... from
// "./tools.marketing"` would be hoisted and evaluated before this shim runs.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in tools.marketing.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

// Wrapped in an async IIFE (not top-level await): this project's package.json
// has no "type": "module", so tsx/esbuild compiles .ts files to CJS, where
// top-level await is unsupported (same reasoning as tools.sales.test.ts).
(async () => {
  const { controlSqlite } =
    requireLocal("../db/control") as typeof import("../db/control");
  const { getTenantDbById, runWithTenant } =
    requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { sites, blogPosts } =
    requireLocal("../db/schema") as typeof import("../db/schema");
  const {
    resolveSite,
    listBlogPostsTool,
    saveBlogPostTool,
    publishBlogPostTool,
  } = requireLocal("./tools.marketing") as typeof import("./tools.marketing");
  const { TOOLS, WRITE_TOOLS } =
    requireLocal("../assistant/tools") as typeof import("../assistant/tools");

  // ── two scratch tenants: `tid` is the tenant under test; `foreignTid`
  // exists only so we have a real siteId that belongs to a DIFFERENT tenant,
  // to prove resolveSite can't be tricked into a cross-tenant match (each
  // tenant is a physically separate SQLite file). ──
  const slug = "agents-marketing-tools-test";
  const foreignSlug = "agents-marketing-tools-test-foreign";
  const dbFile = `tenants/${slug}/${slug}.db`;
  const foreignDbFile = `tenants/${foreignSlug}/${foreignSlug}.db`;

  controlSqlite.prepare("DELETE FROM tenants WHERE slug IN (?, ?)").run(slug, foreignSlug);
  const t = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(slug, "Agents Marketing Tools Test", dbFile) as { id: number };
  const foreignT = controlSqlite
    .prepare(
      "INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id",
    )
    .get(foreignSlug, "Agents Marketing Tools Test (Foreign)", foreignDbFile) as { id: number };
  const tid = t.id;
  const foreignTid = foreignT.id;
  const ctx = { tenantId: tid };

  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id IN (?, ?)").run(tid, foreignTid);
    for (const s of [slug, foreignSlug]) {
      try {
        fs.rmSync(path.join(process.cwd(), "data", "tenants", s), {
          recursive: true,
          force: true,
        });
      } catch {
        // best effort
      }
    }
  };

  try {
    // ── (a) THE SAFETY PROPERTY: the two write tools are gated behind
    // Approve, the three read tools are not. If save_blog_post or
    // publish_blog_post were missing from WRITE_TOOLS, the agent could
    // persist content — or push it to the LIVE public site — with no
    // operator approval. This is the hard-check the task calls out. ──
    assert.ok(WRITE_TOOLS.has("save_blog_post"), "save_blog_post is a write tool (requires Approve)");
    assert.ok(WRITE_TOOLS.has("publish_blog_post"), "publish_blog_post is a write tool (requires Approve)");
    assert.ok(!WRITE_TOOLS.has("list_blog_posts"), "list_blog_posts is a read tool — must NOT require approval");
    assert.ok(!WRITE_TOOLS.has("draft_blog_post"), "draft_blog_post is a read tool — must NOT require approval");
    assert.ok(!WRITE_TOOLS.has("draft_carousel"), "draft_carousel is a read tool — must NOT require approval");

    // All 5 tools are registered in the central TOOLS list (the schemas the
    // model sees). draft_blog_post/draft_carousel are checked ONLY for
    // registration here — they are never invoked below (no Claude
    // credentials exist in this test environment).
    const toolNames = new Set(TOOLS.map((tool) => tool.name));
    for (const name of ["list_blog_posts", "draft_blog_post", "save_blog_post", "publish_blog_post", "draft_carousel"]) {
      assert.ok(toolNames.has(name), `"${name}" is registered in TOOLS`);
    }

    // getTenantDbById(...) resolves each scratch tenant and creates its
    // tables — including `sites`, which starts EMPTY for a fresh tenant
    // (seedDefaultSite only ever runs for the built-in "renova" tenant on
    // app boot, not for a freshly-provisioned one).
    const db = getTenantDbById(tid);
    const foreignDb = getTenantDbById(foreignTid);

    // Seed the foreign tenant with a decoy site FIRST so its "real" site's id
    // is guaranteed to differ from the scratch tenant's own site id. Both are
    // fresh, physically separate SQLite files with independent id=1
    // autoincrement sequences — without this decoy, both tenants' first (and
    // only) site would coincidentally also be id=1, and the cross-tenant
    // assertion below would "pass" for the wrong reason (resolving the
    // scratch tenant's own genuine site, not correctly rejecting a foreign
    // one).
    foreignDb.insert(sites).values({ slug: "foreign-decoy", name: "Foreign Decoy" }).run();
    const foreignSite = foreignDb
      .insert(sites)
      .values({ slug: "foreign-co", name: "Foreign Co" })
      .returning()
      .get();

    const ownSite = db
      .insert(sites)
      .values({ slug: "scratch-site", name: "Scratch Site" })
      .returning()
      .get();
    assert.notEqual(
      foreignSite.id,
      ownSite.id,
      "sanity: the foreign site's id actually differs from the scratch tenant's own site id",
    );

    // ── resolveSite (b): no siteId + exactly one site on the tenant ->
    // resolves it without guessing wrong. ──
    const resolvedDefault = resolveSite(ctx, undefined);
    assert.ok(!("error" in resolvedDefault), "resolveSite resolves the tenant's only site when siteId is omitted");
    if (!("error" in resolvedDefault)) {
      assert.equal(resolvedDefault.id, ownSite.id, "resolveSite resolves to the scratch tenant's actual site");
      assert.equal(resolvedDefault.slug, "scratch-site");
    }

    // ── resolveSite (c): a siteId belonging to a DIFFERENT tenant -> an
    // error result, never a silent cross-tenant match. ──
    const resolvedForeign = resolveSite(ctx, foreignSite.id);
    assert.ok("error" in resolvedForeign, "resolveSite rejects a siteId belonging to a different tenant");

    // ── save_blog_post (WRITE) — missing title/content rejected before any
    // DB write. Wrapped in runWithTenant like every call below, reproducing
    // the contract /api/assistant/chat + /api/assistant/execute +
    // /api/agents/[key]/chat already guarantee in production (see
    // tools.marketing.ts's header comment): the ambient tenant always equals
    // ctx.tenantId. save_blog_post/publish_blog_post/list_blog_posts are
    // synchronous (no network I/O), so — like setLeadStageTool/
    // logLeadTouchTool in tools.sales.test.ts — they're called directly, no
    // `await`/async wrapper needed. ──
    const missingTitle = JSON.parse(
      runWithTenant(tid, () => saveBlogPostTool(ctx, { content: "Body text." })).text,
    );
    assert.ok(missingTitle.error, "save_blog_post requires a title");
    const missingContent = JSON.parse(
      runWithTenant(tid, () => saveBlogPostTool(ctx, { title: "A Title" })).text,
    );
    assert.ok(missingContent.error, "save_blog_post requires content");

    // ── save_blog_post (WRITE) — a valid call persists a post that is
    // immediately usable: status "ready" (NOT stuck at "generating", which is
    // createSiteBlogPost's default for the async-generation flow this tool
    // doesn't use) and publishState "draft" (NOT published). ──
    const saveResult = JSON.parse(
      runWithTenant(tid, () =>
        saveBlogPostTool(ctx, {
          siteId: ownSite.id,
          title: "5 Ways HBOT Supports Recovery",
          content: "# 5 Ways HBOT Supports Recovery\n\nSome real body content about recovery.",
          excerpt: "A short summary for preview cards.",
        }),
      ).text,
    );
    assert.ok(saveResult.result && !saveResult.error, "save_blog_post succeeds for a valid call");
    assert.equal(saveResult.status, "ready", "save_blog_post reports status ready");
    assert.equal(saveResult.publishState, "draft", "save_blog_post reports publishState draft");
    const postId = saveResult.postId as number;
    assert.ok(postId, "save_blog_post returns the new post's id");

    // Independently re-read the row (not just the tool's own reported JSON)
    // to confirm the DB actually persisted status "ready" / publishState
    // "draft" / the excerpt / the exact content.
    const savedRow = db.select().from(blogPosts).where(eq(blogPosts.id, postId)).get();
    assert.ok(savedRow, "the saved post actually exists in the tenant's blog_posts table");
    assert.equal(savedRow?.status, "ready", "the persisted row's status is ready, not stuck at generating");
    assert.equal(savedRow?.publishState, "draft", "the persisted row's publishState is draft");
    assert.equal(savedRow?.siteId, ownSite.id, "the persisted row is scoped to the resolved site");
    assert.equal(savedRow?.excerpt, "A short summary for preview cards.", "the excerpt was persisted");
    assert.ok(savedRow?.content?.includes("Some real body content"), "the content was persisted verbatim");

    // ── list_blog_posts (READ) — the saved draft appears. ──
    const listResult = JSON.parse(runWithTenant(tid, () => listBlogPostsTool(ctx, { siteId: ownSite.id })).text);
    const listed = listResult.posts.find((p: { id: number }) => p.id === postId);
    assert.ok(listed, "list_blog_posts returns the saved post");
    assert.equal(listed.publishState, "draft", "list_blog_posts reports the correct publishState");
    assert.equal(listed.publishedAt, null, "an unpublished post has no publishedAt");

    // list_blog_posts also resolves with no siteId given (the tenant has
    // exactly one site) — the same resolveSite path exercised through the
    // actual tool, not just called directly.
    const listDefault = JSON.parse(runWithTenant(tid, () => listBlogPostsTool(ctx, {})).text);
    assert.ok(!listDefault.error, "list_blog_posts resolves the tenant's only site with no siteId");
    assert.equal(listDefault.siteId, ownSite.id);

    // ── publish_blog_post (WRITE) — missing/unknown postId rejected cleanly,
    // not a crash or a silent no-op. ──
    const publishMissingId = JSON.parse(runWithTenant(tid, () => publishBlogPostTool(ctx, {})).text);
    assert.ok(publishMissingId.error, "publish_blog_post requires postId");
    const publishUnknownId = JSON.parse(
      runWithTenant(tid, () => publishBlogPostTool(ctx, { siteId: ownSite.id, postId: 9_999_999 })).text,
    );
    assert.ok(publishUnknownId.error, "publish_blog_post errors cleanly for an unknown postId");

    // ── publish_blog_post (WRITE) — a valid call flips the SAVED draft to
    // publishState "published". This is the tool that pushes to the LIVE
    // public site — exactly why it's Approve-gated (see the WRITE_TOOLS
    // assertion above). ──
    const publishResult = JSON.parse(
      runWithTenant(tid, () => publishBlogPostTool(ctx, { siteId: ownSite.id, postId })).text,
    );
    assert.ok(publishResult.result && !publishResult.error, "publish_blog_post succeeds for the saved draft");
    assert.equal(publishResult.publishState, "published");

    const publishedRow = db.select().from(blogPosts).where(eq(blogPosts.id, postId)).get();
    assert.equal(publishedRow?.publishState, "published", "the persisted row's publishState flipped to published");
    assert.ok(publishedRow?.publishedAt, "publishedAt was stamped on publish");

    console.log("tools.marketing.test.ts: all assertions passed");
  } finally {
    cleanup();
  }
})();
