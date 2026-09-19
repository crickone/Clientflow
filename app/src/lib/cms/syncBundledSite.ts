import "server-only";

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { openTenantDb } from "@/lib/db/tenant";
import { findSiteSlugOwners } from "@/lib/cms/siteSlugs";
import { merge3, mergeLooksSane } from "@/lib/cms/merge3";
import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";

/**
 * Publish a bespoke client site on deploy.
 *
 * `sites/<slug>/*.html` is the source of a client's website, but the pages
 * visitors see are rendered from `content_blocks` in that client's tenant
 * database on the Railway volume. A deploy ships the app and the site's images
 * and leaves the pages untouched, so a content change could be written,
 * reviewed, merged and deployed while the live site kept serving the old copy.
 * That is not a hypothetical: placeholder testimonials survived three deploys
 * after being deleted.
 *
 * `tools/build-site-bundle.cjs` renders the pages into
 * `public/sites/<slug>/_pages.json` at commit time — `public/` is the one part
 * of the repo copied into the runtime image — and this applies the bundle on
 * boot. It follows the same shape as [seedMarketingSite], generalised from one
 * page to a whole site.
 *
 * TWO GUARDS, because this writes a live client's website:
 *
 *  1. The bundle carries a content hash. A bundle whose hash matches the one
 *     already applied is skipped outright, so a routine redeploy that changed
 *     no HTML writes nothing at all.
 *
 *  2. Within a bundle that IS new, any page whose body block carries an
 *     `updated_by` is left alone. Somebody edited that page in Studio, and
 *     their work outranks the file on disk. It is reported, not silently
 *     dropped, so the divergence is visible in the boot log.
 *
 * Sites opt in below by name. This deliberately does not apply to every site
 * with a folder: a site whose content the client authors in Studio should
 * never be overwritten from the repo, and the safe default is to do nothing.
 *
 * Never throws — publishing a marketing page must not take down boot.
 */
const BUNDLED_SITES: readonly string[] = [
  // Inspire Health & Fitness, Clonmel. Built in sites/inspire/, not authored
  // in Studio, so the repo is the source of truth.
  "inspire",
];

type BundledPage = {
  key: string;
  path: string;
  title: string;
  desc: string;
  body: string;
};
type Bundle = { slug: string; tenant: string; rev: string; pages: BundledPage[] };

const revKey = (slug: string) => `site_bundle_rev_${slug}`;

export function syncBundledSites(): void {
  for (const site of BUNDLED_SITES) {
    try {
      syncOne(site);
    } catch (err) {
      console.error(`[syncBundledSite] '${site}' failed (non-fatal):`, err);
    }
    try {
      seedBundledPosts(site);
    } catch (err) {
      console.error(`[syncBundledSite] '${site}' blog seed failed (non-fatal):`, err);
    }
  }
}

type BundledPost = {
  slug: string;
  title: string;
  content: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  coverImageUrl: string | null;
  sourceUrl: string;
};

const postsRevKey = (slug: string) => `site_posts_rev_${slug}`;

/**
 * Seed a site's blog from `public/sites/<slug>/_posts.json`, produced by
 * tools/scrape-webflow-blog.cjs when a client's writing is carried across
 * from the site we are replacing.
 *
 * CREATE, OR FILL A BLANK. Never overwrite. That is the important difference
 * from the page sync above: a bespoke page's source of truth is the repo, so
 * it is upserted, but a blog post is the client's own writing — they will
 * edit it, retitle it, add to it.
 *
 * So a post whose slug already exists keeps its title and its body, always.
 * What the seed may still do is fill a field that is EMPTY: a cover image, an
 * excerpt, an SEO title or description. That is not a compromise of the rule,
 * it is the rule applied to a field rather than a row — writing into a blank
 * takes nothing away from anyone.
 *
 * It earned its keep immediately. The first import dropped every cover, since
 * the source site used its own logo as the og:image for all 22 articles; the
 * real card images were found later on the index page. Without blank-filling,
 * pure create-only would have meant those pictures could never reach posts
 * that already existed, and the client's blog would have stayed a wall of
 * text forever.
 *
 * A post anyone has touched is exempt even from blank-filling: an empty
 * excerpt on an edited post may well be deliberate.
 *
 * "Touched" is decided by comparing the stored body with the bundle's,
 * because blog_posts has no `updated_by` column — that lives on
 * content_blocks, and assuming otherwise is what made the first version of
 * this throw. The comparison is a better signal anyway: it asks whether the
 * writing has actually changed since it was imported, which is the thing
 * that matters, rather than whether a row was saved at some point.
 *
 * Posts arrive PUBLISHED, matching the state they are in on the site being
 * replaced. A launch that silently turned 22 live articles into drafts would
 * lose the client every search result pointing at them.
 */
function seedBundledPosts(siteSlug: string): void {
  const file = path.join(process.cwd(), "public", "sites", siteSlug, "_posts.json");
  if (!fs.existsSync(file)) return;

  const bundle = JSON.parse(fs.readFileSync(file, "utf8")) as { posts?: BundledPost[] };
  const posts = (bundle.posts ?? []).filter((p) => p.slug && p.title && p.content);
  if (posts.length === 0) return;

  const rev = createHash("sha256").update(JSON.stringify(posts)).digest("hex").slice(0, 16);

  const served = findSiteSlugOwners(siteSlug)[0];
  if (!served) return;

  const applied = `${served.tenantId}:${rev}`;
  if (getPlatformSetting(postsRevKey(siteSlug)) === applied) return;

  const { sqlite } = openTenantDb(served.dbFile);
  const sid = served.siteId;

  const exists = sqlite.prepare(
    `SELECT id, content, cover_image_url, excerpt, seo_title, seo_description
       FROM blog_posts WHERE site_id = ? AND slug = ?`,
  );
  const insert = sqlite.prepare(
    `INSERT INTO blog_posts
       (title, input_mode, target_words, content, status, site_id, slug, excerpt,
        cover_image_url, seo_title, seo_description, publish_state, published_at, created_at, updated_at)
     VALUES (?, 'prompt', ?, ?, 'ready', ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
  );

  const created: string[] = [];
  const filled: string[] = [];

  /** A field worth filling: absent, or present but empty. */
  const blank = (v: unknown) => v == null || String(v).trim() === "";

  sqlite.transaction(() => {
    for (const post of posts) {
      const row = exists.get(sid, post.slug) as
        | {
            id: number;
            content: string | null;
            cover_image_url: string | null;
            excerpt: string | null;
            seo_title: string | null;
            seo_description: string | null;
          }
        | undefined;

      if (row) {
        // The writing has changed since it was imported, so a human has been
        // here. Leave every part of the post alone, blanks included.
        if ((row.content ?? "").trim() !== post.content.trim()) continue;

        const set: string[] = [];
        const values: unknown[] = [];
        const fill = (column: string, current: unknown, next: string | null) => {
          if (blank(current) && !blank(next)) {
            set.push(`${column} = ?`);
            values.push(next);
          }
        };
        fill("cover_image_url", row.cover_image_url, post.coverImageUrl);
        fill("excerpt", row.excerpt, post.excerpt);
        fill("seo_title", row.seo_title, post.seoTitle || post.title);
        fill("seo_description", row.seo_description, post.seoDescription || post.excerpt);

        if (set.length > 0) {
          values.push(Date.now(), sid, row.id);
          sqlite
            .prepare(`UPDATE blog_posts SET ${set.join(", ")}, updated_at = ? WHERE site_id = ? AND id = ?`)
            .run(...values);
          filled.push(post.slug);
        }
        continue;
      }

      const now = Date.now();
      insert.run(
        post.title,
        post.content.trim().split(/\s+/).length,
        post.content,
        sid,
        post.slug,
        post.excerpt || null,
        post.coverImageUrl || null,
        post.seoTitle || post.title,
        post.seoDescription || post.excerpt || null,
        now,
        now,
        now,
      );
      created.push(post.slug);
    }
  })();

  setPlatformSetting(postsRevKey(siteSlug), applied);

  console.log(
    `[syncBundledSite] '${siteSlug}' blog rev ${rev} -> tenant ${served.tenantSlug}#${served.tenantId} ` +
      `site #${sid}: ${created.length} of ${posts.length} post(s) created` +
      (filled.length ? `, ${filled.length} had blank fields filled` : "") +
      (created.length === 0 && filled.length === 0 ? " (all already present and complete)" : ""),
  );
}

function syncOne(siteSlug: string): void {
  const bundlePath = path.join(process.cwd(), "public", "sites", siteSlug, "_pages.json");
  if (!fs.existsSync(bundlePath)) return;

  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8")) as Bundle;
  if (!bundle.rev || !Array.isArray(bundle.pages) || bundle.pages.length === 0) return;

  // Publish to the copy the PUBLIC RENDERER serves, not to "the tenant of
  // the same name". Those are two independent answers to one question and
  // they have disagreed in production: a site imported into the legacy
  // tenant shadowed the client's own copy, so publishing by name wrote a
  // perfect set of pages into a database nobody reads. findSiteSlugOwners
  // scans in the renderer's own order, so the first owner is what visitors
  // get, by construction rather than by agreement.
  const owners = findSiteSlugOwners(siteSlug);
  if (owners.length > 1) {
    console.warn(
      `[syncBundledSite] '${siteSlug}' exists in ${owners.length} tenants ` +
        `(${owners.map((o) => `${o.tenantSlug}#${o.tenantId}`).join(", ")}). ` +
        `Publishing to '${owners[0].tenantSlug}', the one the public site resolves to. ` +
        `The others are shadowed copies nobody can see and should be removed.`,
    );
  }
  const served = owners[0];
  if (!served) return; // no tenant in this environment has the site yet

  // Guard 1: nothing changed since the last applied bundle. The marker is
  // the content hash AND the tenant it was applied to, because those are two
  // independent ways for the live pages to be out of date. Recording the hash
  // alone once let a bundle applied to a shadowed copy of the site mark
  // itself done, so the boot after the target was corrected skipped the work
  // it existed to do.
  const applied = `${served.tenantId}:${bundle.rev}`;
  if (getPlatformSetting(revKey(siteSlug)) === applied) return;

  const { sqlite } = openTenantDb(served.dbFile);
  const sid = served.siteId;

  const findPage = sqlite.prepare("SELECT id FROM pages WHERE site_id = ? AND path = ?");
  const findBlock = sqlite.prepare(
    "SELECT value, updated_by FROM content_blocks WHERE site_id = ? AND page_id = ? AND name = 'body'",
  );
  const upPage = sqlite.prepare(
    `INSERT INTO pages (site_id, page_key, path, title, template_id, status, published_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'clientflow-live', 'published', ?, ?, ?)
     ON CONFLICT(site_id, path) DO UPDATE SET
       title = excluded.title, template_id = 'clientflow-live', status = 'published',
       published_at = excluded.published_at, updated_at = excluded.updated_at`,
  );
  const upBlock = sqlite.prepare(
    `INSERT INTO content_blocks (site_id, page_id, name, kind, value, created_at, updated_at)
     VALUES (?, ?, 'body', 'html', ?, ?, ?)
     ON CONFLICT(site_id, page_id, name) DO UPDATE SET
       value = excluded.value, kind = 'html', updated_at = excluded.updated_at`,
  );
  const upSeo = sqlite.prepare(
    `INSERT INTO seo_meta (site_id, page_id, seo_title, seo_description, robots, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'index,follow', ?, ?)
     ON CONFLICT(site_id, page_id) DO UPDATE SET
       seo_title = excluded.seo_title, seo_description = excluded.seo_description,
       updated_at = excluded.updated_at`,
  );

  // Keep the version a deploy is about to replace. Raw SQL on this
  // connection rather than lib/cms/pageRevisions, which uses the ambient
  // request-scoped db — this runs at boot, outside any request, against a
  // tenant resolved by hand.
  const snapshot = sqlite.prepare(
    `INSERT INTO page_revisions (site_id, page_id, body, source, created_by, note, created_at)
     SELECT ?, ?, cb.value, ?, NULL, ?, ?
       FROM content_blocks cb
      WHERE cb.site_id = ? AND cb.page_id = ? AND cb.name = 'body'
        AND cb.value IS NOT NULL AND trim(cb.value) <> ''`,
  );
  const countRevisions = sqlite.prepare(
    "SELECT count(*) AS n FROM page_revisions WHERE site_id = ? AND page_id = ?",
  );

  /**
   * The last version this sync published to each page, kept so a later
   * deploy can tell OUR change from THEIRS.
   *
   * Without it there are only two versions to compare and no way to know who
   * moved what, which is why the old rule could only ever lock a page
   * outright. It lives in content_blocks under its own name, the same shape
   * as the editor's existing `body:draft` row, so it needs no new table and
   * is deleted with the page.
   */
  const BASE_BLOCK = "body:repo-base";
  const findBase = sqlite.prepare(
    "SELECT value FROM content_blocks WHERE site_id = ? AND page_id = ? AND name = ?",
  );
  const upBase = sqlite.prepare(
    `INSERT INTO content_blocks (site_id, page_id, name, kind, value, created_at, updated_at)
     VALUES (?, ?, ?, 'html', ?, ?, ?)
     ON CONFLICT(site_id, page_id, name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );

  const skipped: string[] = [];
  const merged: string[] = [];
  let written = 0;

  // One transaction: a half-published site is worse than an out-of-date one.
  const apply = sqlite.transaction(() => {
    for (const page of bundle.pages) {
      const now = Date.now();
      const existing = findPage.get(sid, page.path) as { id: number } | undefined;

      // What actually gets written: the bundle's page, unless a merge
      // produces something better.
      let bodyToWrite = page.body;

      if (existing) {
        const block = findBlock.get(sid, existing.id) as
          | { value: string | null; updated_by: number | null }
          | undefined;
        const live = block?.value ?? "";

        if (live === page.body) continue; // already current

        // Guard 2: a person has edited this page. Their work is never
        // overwritten — but it does not have to BLOCK ours either, when the
        // two changes are in different places.
        if (block?.updated_by != null) {
          const base = (findBase.get(sid, existing.id, BASE_BLOCK) as { value: string | null } | undefined)?.value;
          if (!base) {
            // No record of what we last published, so there is no way to
            // tell our change from theirs. Leave it alone, as before.
            skipped.push(page.path);
            continue;
          }
          const attempt = merge3(base, page.body, live);
          if (!attempt.ok) {
            skipped.push(`${page.path} (both changed the same part)`);
            continue;
          }
          const sane = mergeLooksSane(attempt.merged, live);
          if (!sane.ok) {
            skipped.push(`${page.path} (merge rejected: ${sane.reason})`);
            continue;
          }
          if (attempt.merged === live) continue; // their page already has our change
          bodyToWrite = attempt.merged;
          merged.push(page.path);
        }
      }

      upPage.run(sid, page.key, page.path, page.title, now, now, now);
      const pid = (findPage.get(sid, page.path) as { id: number }).id;
      // The first snapshot for a page is whatever was there before any
      // history existed — not an edit anyone made, so label it honestly.
      const priorCount = (countRevisions.get(sid, pid) as { n: number }).n;
      snapshot.run(
        sid,
        pid,
        priorCount === 0 ? "baseline" : "deploy",
        priorCount === 0 ? "State before version history existed" : `Replaced by deploy ${bundle.rev}`,
        now,
        sid,
        pid,
      );
      upBlock.run(sid, pid, bodyToWrite, now, now);
      // The BASE is always the bundle's own page, never the merged result:
      // it records what the repo published, which is what the next deploy
      // must diff against to find its own change.
      upBase.run(sid, pid, BASE_BLOCK, page.body, now, now);
      upSeo.run(sid, pid, page.title, page.desc, now, now);
      written++;
    }
  });
  apply();

  // Record the rev even when every page was skipped or already current:
  // the bundle HAS been considered, and re-examining it on every boot would
  // reopen the same transaction forever.
  setPlatformSetting(revKey(siteSlug), applied);

  console.log(
    `[syncBundledSite] '${siteSlug}' rev ${bundle.rev} -> tenant ${served.tenantSlug}#${served.tenantId} ` +
      `site #${sid}: ${written} page(s) published` +
      (merged.length ? `, ${merged.length} merged with a human's edits: ${merged.join(", ")}` : "") +
      (skipped.length ? `, ${skipped.length} left alone: ${skipped.join(", ")}` : ""),
  );
}
