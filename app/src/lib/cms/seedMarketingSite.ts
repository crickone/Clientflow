import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getTenantBySlug, openTenantDb } from "@/lib/db/tenant";
import { getPlatformSetting, setPlatformSetting } from "@/lib/billing/settings";

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
 * REVISIONED, not blind create-if-missing: unlike a client site (whose content
 * is authored in Studio), THIS site's source of truth is the repo file. So the
 * seeder pushes the file to the live body block whenever `MARKETING_SITE_REV`
 * is ahead of the applied rev (recorded control-plane in `marketing_site_rev`),
 * then leaves it alone — a Studio tweak made at the current rev survives every
 * redeploy, and a real content change ships by bumping the constant below.
 * Never throws (a marketing seed must not take down boot).
 */
const OPERATOR_TENANT_SLUG = "clientflow";
const SITE_SLUG = "adonisagent";
const SITE_NAME = "AdonisAgent";

/**
 * Bump when `public/sites/adonisagent/index.html` changes and you want it
 * pushed to the already-live site on the next deploy. Sites seeded before this
 * revisioning existed read as rev 1 (no stored value), so the first bump above
 * 1 re-pushes their body once.
 *   rev 2 (2026-08-12) — "Living blueprint" pass: bronze live-signal accents,
 *   streaming hero activity rail, orchestrated entrance, count-up, Lenis.
 *   rev 3 (2026-08-12) — drop Lenis (its scroll hijack breaks scrolling inside
 *   the CMS-embedded template); native smooth scroll + scroll-padding-top.
 */
const MARKETING_SITE_REV = 3;
const REV_KEY = "marketing_site_rev";

export function seedMarketingSite(): void {
  try {
    const htmlPath = path.join(process.cwd(), "public", "sites", SITE_SLUG, "index.html");
    if (!fs.existsSync(htmlPath)) return;

    const tenant = getTenantBySlug(OPERATOR_TENANT_SLUG);
    if (!tenant) return; // operator tenant not present in this environment

    const { sqlite } = openTenantDb(tenant.dbFile);

    const html = fs.readFileSync(htmlPath, "utf8");
    const title = (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? SITE_NAME).trim();
    const desc = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? "").trim();
    const now = Date.now();

    const existing = sqlite
      .prepare("SELECT id FROM sites WHERE slug = ?")
      .get(SITE_SLUG) as { id: number } | undefined;

    if (existing) {
      // Live already — only re-push on a deliberate rev bump, so Studio edits
      // made at the current rev are never clobbered on a routine redeploy.
      const appliedRev = Number(getPlatformSetting(REV_KEY) ?? "1");
      if (MARKETING_SITE_REV <= appliedRev) return;
      const sid = existing.id;
      const update = sqlite.transaction(() => {
        sqlite
          .prepare("UPDATE content_blocks SET value = ?, updated_at = ? WHERE site_id = ? AND name = 'body'")
          .run(html, now, sid);
        sqlite
          .prepare("UPDATE pages SET title = ?, updated_at = ? WHERE site_id = ? AND page_key = 'index'")
          .run(title, now, sid);
        sqlite
          .prepare("UPDATE seo_meta SET seo_title = ?, seo_description = ?, updated_at = ? WHERE site_id = ?")
          .run(title, desc, now, sid);
      });
      update();
      setPlatformSetting(REV_KEY, String(MARKETING_SITE_REV));
      console.log(`[seedMarketingSite] updated '${SITE_SLUG}' to rev ${MARKETING_SITE_REV}`);
      return;
    }

    // Fresh install — create the site, page, body block and SEO, then record the rev.
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
    setPlatformSetting(REV_KEY, String(MARKETING_SITE_REV));
    console.log(`[seedMarketingSite] created '${SITE_SLUG}' site in tenant '${OPERATOR_TENANT_SLUG}'`);
  } catch (err) {
    console.error("[seedMarketingSite] failed (non-fatal):", err);
  }
}
