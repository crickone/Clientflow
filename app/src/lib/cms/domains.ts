import "server-only";

import { and, eq } from "drizzle-orm";

import { controlDb } from "@/lib/db/control";
import { siteDomains, type SiteDomain } from "@/lib/db/schema";
import { db, schema } from "@/lib/db";

/**
 * Site domains live in the CONTROL plane so unauthenticated public requests can
 * resolve host → tenant + site (see resolveHost). Admin writes happen here;
 * the tenant id is the current agency tenant.
 */

export function normalizeHostInput(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

export function listDomains(tenantId: number, siteId: number): SiteDomain[] {
  return controlDb
    .select()
    .from(siteDomains)
    .where(and(eq(siteDomains.tenantId, tenantId), eq(siteDomains.siteId, siteId)))
    .all();
}

export function addDomain(
  tenantId: number,
  siteId: number,
  hostInput: string,
  isPrimary: boolean,
): void {
  const host = normalizeHostInput(hostInput);
  if (!host) throw new Error("A valid host is required.");
  const existing = controlDb
    .select()
    .from(siteDomains)
    .where(eq(siteDomains.host, host))
    .get();
  if (existing) throw new Error(`Host already mapped: ${host}`);

  if (isPrimary) clearPrimary(tenantId, siteId);
  controlDb.insert(siteDomains).values({ tenantId, siteId, host, isPrimary }).run();
  if (isPrimary) setSitePrimaryHost(siteId, host);
}

export function removeDomain(tenantId: number, siteId: number, id: number): void {
  controlDb
    .delete(siteDomains)
    .where(
      and(
        eq(siteDomains.id, id),
        eq(siteDomains.tenantId, tenantId),
        eq(siteDomains.siteId, siteId),
      ),
    )
    .run();
}

export function makePrimary(tenantId: number, siteId: number, id: number): void {
  clearPrimary(tenantId, siteId);
  const row = controlDb
    .update(siteDomains)
    .set({ isPrimary: true })
    .where(and(eq(siteDomains.id, id), eq(siteDomains.tenantId, tenantId)))
    .returning()
    .get();
  if (row) setSitePrimaryHost(siteId, row.host);
}

function clearPrimary(tenantId: number, siteId: number): void {
  controlDb
    .update(siteDomains)
    .set({ isPrimary: false })
    .where(and(eq(siteDomains.tenantId, tenantId), eq(siteDomains.siteId, siteId)))
    .run();
}

/** Mirror the canonical host onto the tenant-plane sites row (for SEO/canonical). */
function setSitePrimaryHost(siteId: number, host: string): void {
  db.update(schema.sites)
    .set({ primaryHost: host, updatedAt: new Date() })
    .where(eq(schema.sites.id, siteId))
    .run();
}
