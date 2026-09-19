import "server-only";

import fs from "node:fs";
import path from "node:path";

import { openTenantDb } from "@/lib/db/tenant";
import { findSiteSlugOwners } from "@/lib/cms/siteSlugs";
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
  }
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

  const skipped: string[] = [];
  let written = 0;

  // One transaction: a half-published site is worse than an out-of-date one.
  const apply = sqlite.transaction(() => {
    for (const page of bundle.pages) {
      const now = Date.now();
      const existing = findPage.get(sid, page.path) as { id: number } | undefined;

      if (existing) {
        const block = findBlock.get(sid, existing.id) as
          | { value: string | null; updated_by: number | null }
          | undefined;
        // Guard 2: a human edited this page in Studio. Their work wins.
        if (block?.updated_by != null) {
          skipped.push(page.path);
          continue;
        }
        if (block?.value === page.body) continue; // already current
      }

      upPage.run(sid, page.key, page.path, page.title, now, now, now);
      const pid = (findPage.get(sid, page.path) as { id: number }).id;
      upBlock.run(sid, pid, page.body, now, now);
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
      (skipped.length ? `, ${skipped.length} left alone (edited in Studio): ${skipped.join(", ")}` : ""),
  );
}
