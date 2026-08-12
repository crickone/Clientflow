import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getTenantBySlug, openTenantDb } from "@/lib/db/tenant";

/**
 * Boot seed for the platform's own AdonisAgent marketing site.
 *
 * The site lives in the OPERATOR's own tenant ("clientflow") as a CMS site
 * (slug "adonisagent"), rendered by the `clientflow-live` template (verbatim
 * first-party HTML with its own styles/scripts) — the same way the older
 * ClientFlow marketing site is hosted. Its HTML source ships in the build under
 * `public/` (the only repo content copied into the standalone runtime image —
 * see app/Dockerfile), so a fresh production volume gets the site on first boot
 * without a manual `tools/import-site.cjs` run against the prod DB.
 *
 * CREATE-IF-MISSING only: if the site already exists it is left untouched, so
 * later Studio edits are never clobbered on redeploy (mirrors seedDefaultSite).
 * To push a content change after the site exists, edit it in Studio or bump it
 * deliberately — this seeder will not overwrite it. Never throws (a marketing
 * seed must not take down boot).
 */
const OPERATOR_TENANT_SLUG = "clientflow";
const SITE_SLUG = "adonisagent";
const SITE_NAME = "AdonisAgent";

export function seedMarketingSite(): void {
  try {
    const htmlPath = path.join(
      process.cwd(),
      "public",
      "sites",
      SITE_SLUG,
      "index.html",
    );
    if (!fs.existsSync(htmlPath)) return;

    const tenant = getTenantBySlug(OPERATOR_TENANT_SLUG);
    if (!tenant) return; // operator tenant not present in this environment

    const { sqlite } = openTenantDb(tenant.dbFile);

    // Create-only — respect any later Studio edits to the live site.
    const existing = sqlite
      .prepare("SELECT id FROM sites WHERE slug = ?")
      .get(SITE_SLUG) as { id: number } | undefined;
    if (existing) return;

    const html = fs.readFileSync(htmlPath, "utf8");
    const title = (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? SITE_NAME).trim();
    const desc = (
      html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? ""
    ).trim();
    const now = Date.now();

    const seed = sqlite.transaction(() => {
      const site = sqlite
        .prepare("INSERT INTO sites (slug, name, status) VALUES (?, ?, 'live')")
        .run(SITE_SLUG, SITE_NAME);
      const sid = Number(site.lastInsertRowid);
      const page = sqlite
        .prepare(
          `INSERT INTO pages
             (site_id, page_key, path, title, template_id, status, published_at, created_at, updated_at)
           VALUES (?, 'index', '/', ?, 'clientflow-live', 'published', ?, ?, ?)`,
        )
        .run(sid, title, now, now, now);
      const pid = Number(page.lastInsertRowid);
      sqlite
        .prepare(
          `INSERT INTO content_blocks
             (site_id, page_id, name, kind, value, created_at, updated_at)
           VALUES (?, ?, 'body', 'html', ?, ?, ?)`,
        )
        .run(sid, pid, html, now, now);
      sqlite
        .prepare(
          `INSERT INTO seo_meta
             (site_id, page_id, seo_title, seo_description, robots, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'index,follow', ?, ?)`,
        )
        .run(sid, pid, title, desc, now, now);
    });
    seed();
    console.log(
      `[seedMarketingSite] created '${SITE_SLUG}' site in tenant '${OPERATOR_TENANT_SLUG}'`,
    );
  } catch (err) {
    console.error("[seedMarketingSite] failed (non-fatal):", err);
  }
}
