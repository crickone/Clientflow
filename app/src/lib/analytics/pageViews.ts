import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type { TenantDb } from "@/lib/db/tenant";

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|whatsapp|curl|wget|python|axios|node-fetch|monitor|uptime/i;

export function isBot(ua: string | null): boolean {
  return !ua || BOT_RE.test(ua);
}

const stripWww = (h: string) => h.toLowerCase().replace(/^www\./, "");

export function referrerDomain(ref: string | null, ownHost: string): string {
  if (!ref) return "";
  try {
    const host = stripWww(new URL(ref).hostname);
    return host && host !== stripWww(ownHost) ? host.slice(0, 120) : "";
  } catch {
    return "";
  }
}

export function cleanPath(p: unknown): string | null {
  if (typeof p !== "string" || !p.startsWith("/")) return null;
  let path = p.split(/[?#]/)[0];
  if (path.length > 1) path = path.replace(/\/+$/, "") || "/";
  return path.slice(0, 300);
}

export function cleanUtm(v: unknown): string {
  return typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 60) : "";
}

export function visitorHash(secret: string, day: string, siteId: number, ip: string, ua: string): string {
  return crypto.createHash("sha256").update(`${secret}|${day}|${siteId}|${ip}|${ua}`).digest("hex");
}

export const MAX_PATHS_PER_SITE_DAY = 500;
const OTHER_PATH = "/other";

export type PageHit = {
  siteId: number;
  day: string;
  path: string;
  referrerDomain: string;
  utmSource: string;
  hash: string;
};

/**
 * Delete visitor hashes from days before `today` (UTC, YYYY-MM-DD). Fail-soft:
 * returns the rows deleted, 0 on error. Run daily so a quiet site's hashes do
 * not outlive their day waiting for another hit.
 */
export function purgeOldVisitorHashes(conn: TenantDb, today: string): number {
  try {
    return conn.run(sql`DELETE FROM site_visitor_hashes WHERE day < ${today}`).changes;
  } catch (err) {
    console.error("[recorder:page_views] could not purge old visitor hashes", err);
    return 0;
  }
}

/**
 * Fail-soft recorder. `uniques` on a path row counts visitors new to that path
 * today, attributed to the referrer/utm row of their first hit on that path.
 * Hashes for earlier days are purged on every write, so only the current UTC
 * day's salted hashes are ever held.
 */
export function recordPageView(conn: TenantDb, rawHit: PageHit, opts: { maxPaths?: number } = {}): void {
  const maxPaths = opts.maxPaths ?? MAX_PATHS_PER_SITE_DAY;
  try {
    conn.transaction((tx) => {
      let hit = rawHit;
      // Bound distinct paths per site per day: a forged beacon cannot grow the
      // table without limit. A brand-new path past the cap folds into "/other".
      const known = tx.get<{ n: number }>(
        sql`SELECT COUNT(*) AS n FROM site_page_views_daily WHERE site_id = ${hit.siteId} AND day = ${hit.day} AND path = ${hit.path}`,
      );
      if (!known || known.n === 0) {
        const distinct = tx.get<{ n: number }>(
          sql`SELECT COUNT(DISTINCT path) AS n FROM site_page_views_daily WHERE site_id = ${hit.siteId} AND day = ${hit.day}`,
        );
        if ((distinct?.n ?? 0) >= maxPaths) hit = { ...hit, path: OTHER_PATH };
      }
      tx.run(sql`DELETE FROM site_visitor_hashes WHERE day < ${hit.day}`);
      const newOnPath =
        tx.run(sql`INSERT OR IGNORE INTO site_visitor_hashes (day, site_id, path, hash) VALUES (${hit.day}, ${hit.siteId}, ${hit.path}, ${hit.hash})`).changes > 0;
      const newOnSite =
        tx.run(sql`INSERT OR IGNORE INTO site_visitor_hashes (day, site_id, path, hash) VALUES (${hit.day}, ${hit.siteId}, '', ${hit.hash})`).changes > 0;
      const u = newOnPath ? 1 : 0;
      tx.run(sql`
        INSERT INTO site_page_views_daily (site_id, day, path, referrer_domain, utm_source, views, uniques)
        VALUES (${hit.siteId}, ${hit.day}, ${hit.path}, ${hit.referrerDomain}, ${hit.utmSource}, 1, ${u})
        ON CONFLICT (site_id, day, path, referrer_domain, utm_source)
        DO UPDATE SET views = views + 1, uniques = uniques + ${u}
      `);
      if (newOnSite) {
        tx.run(sql`
          INSERT INTO site_visitors_daily (site_id, day, uniques) VALUES (${hit.siteId}, ${hit.day}, 1)
          ON CONFLICT (site_id, day) DO UPDATE SET uniques = uniques + 1
        `);
      }
    });
  } catch (err) {
    console.error("[recorder:page_views] could not record page view", err);
  }
}
