import "server-only";

import { openTenantDb } from "@/lib/db/tenant";
import { listTenants } from "@/lib/tenants";

/**
 * Where a CMS site slug lives across the whole platform.
 *
 * A site slug is unique inside a tenant's database and nowhere else, but it
 * is not a private key: it is the public URL, `/site/<slug>/…`, and
 * `resolveHost`'s fallback serves the FIRST active tenant in registry order
 * that has it. So the same slug in two tenants is not a harmless collision —
 * one of the two sites becomes permanently unreachable, and which one is
 * decided by registry order, which nobody thinks about when creating a site.
 *
 * This happened. `tools/import-site.cjs` used to default its `--db` to the
 * legacy tenant's file, so the Inspire site was imported there and shadowed
 * the copy in Inspire's own tenant. Both claimed the same domain. Edits made
 * to the visible copy were invisible, edits to the invisible copy looked like
 * they had failed, and a deploy that correctly published nine pages reported
 * success while the website did not change.
 *
 * One function, used everywhere the question is asked, so creation, the boot
 * publisher and the health board can never give three different answers:
 *  - `createSite` refuses a slug another business already owns;
 *  - `syncBundledSite` publishes to whichever copy is actually served;
 *  - the platform health board reports any duplicate that already exists.
 */
export interface SiteSlugOwner {
  tenantId: number;
  tenantSlug: string;
  tenantName: string;
  dbFile: string;
  siteId: number;
}

/**
 * Every active tenant holding a site with this slug, in the same order
 * `resolveHost` scans them — so the FIRST entry is the one a visitor gets.
 * Never throws for an unreadable tenant database: a broken neighbour must not
 * stop a site being created or published.
 */
export function findSiteSlugOwners(slug: string): SiteSlugOwner[] {
  const wanted = slug.trim().toLowerCase();
  if (!wanted) return [];
  const owners: SiteSlugOwner[] = [];
  for (const tenant of listTenants()) {
    if (tenant.isActive === false) continue;
    try {
      const conn = openTenantDb(tenant.dbFile);
      const row = conn.sqlite.prepare("SELECT id FROM sites WHERE slug = ?").get(wanted) as
        | { id: number }
        | undefined;
      if (row) {
        owners.push({
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          tenantName: tenant.name,
          dbFile: tenant.dbFile,
          siteId: row.id,
        });
      }
    } catch {
      // An unreadable tenant database is a problem for the health board, not
      // a reason to block the caller.
    }
  }
  return owners;
}

/** Every slug held by more than one active tenant, worst case first. */
export function findDuplicateSiteSlugs(): Array<{ slug: string; owners: SiteSlugOwner[] }> {
  const bySlug = new Map<string, SiteSlugOwner[]>();
  for (const tenant of listTenants()) {
    if (tenant.isActive === false) continue;
    try {
      const conn = openTenantDb(tenant.dbFile);
      const rows = conn.sqlite.prepare("SELECT id, slug FROM sites").all() as Array<{
        id: number;
        slug: string;
      }>;
      for (const row of rows) {
        const list = bySlug.get(row.slug) ?? [];
        list.push({
          tenantId: tenant.id,
          tenantSlug: tenant.slug,
          tenantName: tenant.name,
          dbFile: tenant.dbFile,
          siteId: row.id,
        });
        bySlug.set(row.slug, list);
      }
    } catch {
      // See above.
    }
  }
  return [...bySlug.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(([slug, owners]) => ({ slug, owners }))
    .sort((a, b) => b.owners.length - a.owners.length || a.slug.localeCompare(b.slug));
}
