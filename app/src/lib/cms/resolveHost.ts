import "server-only";

import { eq } from "drizzle-orm";

import { controlDb } from "@/lib/db/control";
import { siteDomains, sites, type Site } from "@/lib/db/schema";
import {
  getTenantById,
  openTenantDb,
  type TenantDb,
} from "@/lib/db/tenant";
import { listTenants } from "@/lib/tenants";

/**
 * PUBLIC site resolution. Public requests have no session cookie, so the normal
 * request-scoped `db` proxy would silently resolve to the default tenant. Public
 * rendering MUST go through here instead: resolve the host → site/tenant via the
 * control-plane `site_domains` table (always available, like auth), then open
 * that tenant DB explicitly and query by site_id.
 *
 * Dev fallback: when there's no mapped host (localhost), accept `?site=<slug>`
 * against the default tenant so the public site is viewable without DNS.
 */

const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || "renova";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

export interface PublicSite {
  db: TenantDb;
  tenantId: number;
  tenantDbFile: string;
  site: Site;
  /** Canonical host for absolute URLs (sitemap/canonical/OG). */
  primaryHost: string | null;
}

export function normalizeHost(host?: string | null): string | null {
  if (!host) return null;
  const h = host.split(",")[0].split(":")[0].trim().toLowerCase();
  return h || null;
}

export function resolvePublicSite(opts: {
  host?: string | null;
  siteParam?: string | null;
}): PublicSite | null {
  const host = normalizeHost(opts.host);

  // 1) Real hostname → control-plane site_domains.
  if (host && !LOCAL_HOSTS.has(host) && !host.endsWith(".local")) {
    const domain = controlDb
      .select()
      .from(siteDomains)
      .where(eq(siteDomains.host, host))
      .get();
    if (domain) {
      const tenant = getTenantById(domain.tenantId);
      if (tenant) {
        const conn = openTenantDb(tenant.dbFile);
        const site = conn.db
          .select()
          .from(sites)
          .where(eq(sites.id, domain.siteId))
          .get();
        if (site) {
          return {
            db: conn.db,
            tenantId: tenant.id,
            tenantDbFile: tenant.dbFile,
            site,
            primaryHost: site.primaryHost ?? host,
          };
        }
      }
    }
  }

  // 2) Dev fallback: ?site=<slug> / /site/<slug>. A site can live in ANY tenant
  //    (not just the default), so search across tenants — default tenant first
  //    for the common case. Connections are cached, so this stays cheap.
  const slug = opts.siteParam?.trim().toLowerCase();
  if (slug) {
    const all = listTenants();
    const ordered = [
      ...all.filter((t) => t.slug === DEFAULT_TENANT_SLUG),
      ...all.filter((t) => t.slug !== DEFAULT_TENANT_SLUG),
    ];
    for (const tenant of ordered) {
      if (tenant.isActive === false) continue;
      const conn = openTenantDb(tenant.dbFile);
      const site = conn.db
        .select()
        .from(sites)
        .where(eq(sites.slug, slug))
        .get();
      if (site) {
        return {
          db: conn.db,
          tenantId: tenant.id,
          tenantDbFile: tenant.dbFile,
          site,
          primaryHost: site.primaryHost,
        };
      }
    }
  }

  return null;
}

/** Build an absolute URL for an internal path (e.g. /site-media/...), using the
 *  site's canonical host (prod) or the request host (dev). */
export function absoluteUrl(
  publicSite: PublicSite,
  pathname: string,
  requestHost?: string | null,
): string {
  const host = publicSite.primaryHost || normalizeHost(requestHost);
  if (!host) return pathname;
  const proto = LOCAL_HOSTS.has(host) ? "http" : "https";
  const p = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return `${proto}://${host}${p}`;
}

/**
 * Public-facing URL for a CONTENT path (page path '/about', '/blog/x'). On a
 * mapped primary host the site is served at the domain root, so URLs are clean
 * (`https://host/about`). In dev (no primary host) it falls back to the
 * `/site/<slug>` mount on the request host.
 */
export function siteUrl(
  publicSite: PublicSite,
  cleanPath: string,
  requestHost?: string | null,
): string {
  const clean = cleanPath === "/" ? "/" : `/${cleanPath.replace(/^\/+/, "")}`;
  if (publicSite.primaryHost) {
    return `https://${publicSite.primaryHost}${clean === "/" ? "/" : clean}`;
  }
  const host = normalizeHost(requestHost) || "localhost";
  const proto = LOCAL_HOSTS.has(host) ? "http" : "https";
  const base = `/site/${publicSite.site.slug}`;
  return `${proto}://${host}${base}${clean === "/" ? "" : clean}`;
}
