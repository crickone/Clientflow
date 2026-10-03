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
 * Bump when any page in `PAGES` (built into public/sites/adonisagent/) changes and you want it
 * pushed to the already-live site on the next deploy. Sites seeded before this
 * revisioning existed read as rev 1 (no stored value), so the first bump above
 * 1 re-pushes their body once.
 *   rev 2 (2026-08-12) — "Living blueprint" pass: bronze live-signal accents,
 *   streaming hero activity rail, orchestrated entrance, count-up, Lenis.
 *   rev 3 (2026-08-12) — drop Lenis (its scroll hijack breaks scrolling inside
 *   the CMS-embedded template); native smooth scroll + scroll-padding-top.
 */
// rev 4 (2026-09-20): cinematic dark redesign and connected demo-request form.
// rev 5 (2026-09-21): the copy rewrite. Rev 4 was consumed by a deploy that
//   carried the redesign up from an uncommitted working tree BEFORE the copy
//   pass, so the stored rev is already 4 and a rev-4 build republishes
//   nothing. A new number is the only way the new copy reaches the site.
// rev 6 (2026-10-03): footer names Vantaige Limited and its registered office
//   (Meta business verification links the brand to the legal entity).
// rev 7 (2026-10-03): footer drops the registered-office address and links
//   the new /privacy page (Meta App Review needs a privacy + data-deletion URL).
//   First multi-page rev: the seeder now creates/updates every page in PAGES.
// rev 8 (2026-10-03): /data-deletion page (Meta rejects a deletion URL equal
//   to the privacy policy URL).
const MARKETING_SITE_REV = 8;
const REV_KEY = "marketing_site_rev";

/**
 * Every page of the site, each built by sites/adonisagent/build.mjs into
 * `public/sites/adonisagent/<file>`. A page missing from the live site is
 * created on the next rev bump; an existing one has its body replaced.
 */
const PAGES = [
  { key: "index", path: "/", file: "index.html" },
  { key: "privacy", path: "/privacy", file: "privacy.html" },
  { key: "data-deletion", path: "/data-deletion", file: "data-deletion.html" },
] as const;

type Sqlite = ReturnType<typeof openTenantDb>["sqlite"];

/** Create or update one page, its body block and its SEO row, scoped by page id. */
function upsertPage(sqlite: Sqlite, sid: number, page: (typeof PAGES)[number], html: string, now: number): void {
  const title = (html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? SITE_NAME).trim();
  const desc = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? "").trim();
  const existing = sqlite
    .prepare("SELECT id FROM pages WHERE site_id = ? AND page_key = ?")
    .get(sid, page.key) as { id: number } | undefined;

  if (existing) {
    const pid = existing.id;
    sqlite.prepare("UPDATE pages SET title = ?, updated_at = ? WHERE id = ?").run(title, now, pid);
    sqlite
      .prepare("UPDATE content_blocks SET value = ?, updated_at = ? WHERE site_id = ? AND page_id = ? AND name = 'body'")
      .run(html, now, sid, pid);
    sqlite
      .prepare("UPDATE seo_meta SET seo_title = ?, seo_description = ?, updated_at = ? WHERE site_id = ? AND page_id = ?")
      .run(title, desc, now, sid, pid);
    return;
  }

  const created = sqlite
    .prepare(
      `INSERT INTO pages
         (site_id, page_key, path, title, template_id, status, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'clientflow-live', 'published', ?, ?, ?)`,
    )
    .run(sid, page.key, page.path, title, now, now, now);
  const pid = Number(created.lastInsertRowid);
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
}

export function seedMarketingSite(): void {
  try {
    const dir = path.join(process.cwd(), "public", "sites", SITE_SLUG);
    const pages = PAGES.flatMap((page) => {
      const file = path.join(dir, page.file);
      return fs.existsSync(file) ? [{ page, html: fs.readFileSync(file, "utf8") }] : [];
    });
    if (!pages.some(({ page }) => page.key === "index")) return;

    const tenant = getTenantBySlug(OPERATOR_TENANT_SLUG);
    if (!tenant) return; // operator tenant not present in this environment

    const { sqlite } = openTenantDb(tenant.dbFile);
    const now = Date.now();

    const existing = sqlite
      .prepare("SELECT id FROM sites WHERE slug = ?")
      .get(SITE_SLUG) as { id: number } | undefined;

    if (existing) {
      // Live already — only re-push on a deliberate rev bump, so Studio edits
      // made at the current rev are never clobbered on a routine redeploy.
      const appliedRev = Number(getPlatformSetting(REV_KEY) ?? "1");
      if (MARKETING_SITE_REV <= appliedRev) return;
      sqlite.transaction(() => {
        for (const { page, html } of pages) upsertPage(sqlite, existing.id, page, html, now);
      })();
      setPlatformSetting(REV_KEY, String(MARKETING_SITE_REV));
      console.log(`[seedMarketingSite] updated '${SITE_SLUG}' to rev ${MARKETING_SITE_REV}`);
      return;
    }

    // Fresh install — create the site and every page, then record the rev.
    sqlite.transaction(() => {
      const site = sqlite
        .prepare("INSERT INTO sites (slug, name, status) VALUES (?, ?, 'live')")
        .run(SITE_SLUG, SITE_NAME);
      const sid = Number(site.lastInsertRowid);
      for (const { page, html } of pages) upsertPage(sqlite, sid, page, html, now);
    })();
    setPlatformSetting(REV_KEY, String(MARKETING_SITE_REV));
    console.log(`[seedMarketingSite] created '${SITE_SLUG}' site in tenant '${OPERATOR_TENANT_SLUG}'`);
  } catch (err) {
    console.error("[seedMarketingSite] failed (non-fatal):", err);
  }
}
