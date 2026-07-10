import "server-only";

import type { Database as BetterSqlite3 } from "better-sqlite3";

/**
 * Boot seed for the CMS, kept dependency-free (raw better-sqlite3 only, NO `db`
 * proxy import) so it can run from src/lib/db/index.ts without an import cycle.
 * Idempotent: creates the default "renova" Site on a DB that has none and
 * backfills any pre-existing blog posts to it.
 */

export const DEFAULT_SITE_SLUG = "renova";

export function seedDefaultSite(sqlite: BetterSqlite3): void {
  const count = (
    sqlite.prepare("SELECT COUNT(*) AS c FROM sites").get() as { c: number }
  ).c;

  let siteId: number;
  if (count === 0) {
    const info = sqlite
      .prepare("INSERT INTO sites (slug, name, status) VALUES (?, ?, 'live')")
      .run(DEFAULT_SITE_SLUG, "Renova Cellular Health");
    siteId = Number(info.lastInsertRowid);
  } else {
    const row = sqlite
      .prepare("SELECT id FROM sites WHERE slug = ?")
      .get(DEFAULT_SITE_SLUG) as { id: number } | undefined;
    siteId =
      row?.id ??
      (
        sqlite.prepare("SELECT id FROM sites ORDER BY id LIMIT 1").get() as {
          id: number;
        }
      ).id;
  }

  sqlite
    .prepare("UPDATE blog_posts SET site_id = ? WHERE site_id IS NULL")
    .run(siteId);
}
