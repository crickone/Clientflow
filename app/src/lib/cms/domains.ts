import "server-only";

import crypto from "node:crypto";
import { resolveTxt } from "node:dns/promises";
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

/** DNS record name a tenant must publish to prove they control `host`. */
export function verificationRecordName(host: string): string {
  return `_adonisagent-verify.${host}`;
}

/**
 * Map a hostname to a site. The mapping starts UNVERIFIED — resolveHost
 * ignores it until the tenant proves domain ownership by publishing a TXT
 * record with the row's verify token (see verifyDomain). Without this, any
 * tenant admin could claim an arbitrary unowned hostname and serve their
 * content on it (and squat it away from its real owner).
 */
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
  const verifyToken = `adonis-verify=${crypto.randomBytes(16).toString("hex")}`;
  controlDb
    .insert(siteDomains)
    .values({ tenantId, siteId, host, isPrimary, verifyToken })
    .run();
  if (isPrimary) setSitePrimaryHost(siteId, host);
}

/**
 * Check the ownership TXT record for a pending domain and mark it verified on
 * match. Tenant-scoped: the row must belong to the calling tenant + site.
 * Never throws — DNS failures come back as a friendly error string.
 */
export async function verifyDomain(
  tenantId: number,
  siteId: number,
  id: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = controlDb
    .select()
    .from(siteDomains)
    .where(
      and(
        eq(siteDomains.id, id),
        eq(siteDomains.tenantId, tenantId),
        eq(siteDomains.siteId, siteId),
      ),
    )
    .get();
  if (!row) return { ok: false, error: "Unknown domain." };
  if (row.verifiedAt) return { ok: true };

  // Rows created before tokens existed but left unverified should never occur
  // (pre-verification rows were grandfathered verified) — self-heal anyway.
  let token = row.verifyToken;
  if (!token) {
    token = `adonis-verify=${crypto.randomBytes(16).toString("hex")}`;
    controlDb
      .update(siteDomains)
      .set({ verifyToken: token })
      .where(eq(siteDomains.id, row.id))
      .run();
    return {
      ok: false,
      error: `Add a TXT record at ${verificationRecordName(row.host)} with the value shown, then verify again.`,
    };
  }

  let records: string[][];
  try {
    records = await resolveTxt(verificationRecordName(row.host));
  } catch {
    return {
      ok: false,
      error:
        `TXT record not found at ${verificationRecordName(row.host)}. ` +
        "DNS changes can take a few minutes to propagate — try again shortly.",
    };
  }
  const found = records.some((chunks) => chunks.join("").trim() === token);
  if (!found) {
    return {
      ok: false,
      error:
        `A TXT record exists at ${verificationRecordName(row.host)} but its value doesn't match. ` +
        "Paste the verification value exactly, then try again.",
    };
  }

  controlDb
    .update(siteDomains)
    .set({ verifiedAt: new Date() })
    .where(eq(siteDomains.id, row.id))
    .run();
  return { ok: true };
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
