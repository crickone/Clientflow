import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { getCurrentMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { authDb } from "@/lib/db/control";
import {
  blogPosts,
  contentBlocks,
  mediaAssets,
  pages,
  seoMeta,
  siteDomains,
  siteRequests,
  sites,
  type Site,
} from "@/lib/db/schema";

/**
 * CMS Sites: a first-class "website" managed by the agency, scoped within the
 * current (agency) tenant DB. All CMS content (pages, blocks, seo, media,
 * blog posts) references a site_id. The authed admin uses the request-scoped
 * `db` proxy; PUBLIC rendering must NOT use this module's `db`-backed reads —
 * it resolves the site/DB from the host via ./resolveHost.
 */

export { DEFAULT_SITE_SLUG } from "./seed";

export function normalizeSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function listSites(): Promise<Site[]> {
  return db.select().from(sites).orderBy(asc(sites.name)).all();
}

export async function getSiteBySlug(slug: string): Promise<Site | undefined> {
  return db.select().from(sites).where(eq(sites.slug, slug)).get();
}

export async function getSiteById(id: number): Promise<Site | undefined> {
  return db.select().from(sites).where(eq(sites.id, id)).get();
}

export interface CreateSiteInput {
  slug: string;
  name: string;
  primaryHost?: string | null;
  linkedTenantSlug?: string | null;
}

export async function createSite(input: CreateSiteInput): Promise<Site> {
  const slug = normalizeSlug(input.slug || input.name);
  if (!slug) throw new Error("A valid site slug is required.");
  const existing = await getSiteBySlug(slug);
  if (existing) throw new Error(`A site with slug "${slug}" already exists.`);
  return db
    .insert(sites)
    .values({
      slug,
      name: input.name.trim(),
      primaryHost: input.primaryHost?.trim() || null,
      linkedTenantSlug: input.linkedTenantSlug?.trim() || null,
    })
    .returning()
    .get();
}

export async function updateSite(
  id: number,
  patch: Partial<
    Pick<Site, "name" | "primaryHost" | "status" | "linkedTenantSlug" | "themeJson">
  >,
): Promise<void> {
  db.update(sites)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(sites.id, id))
    .run();
}

// ============ Delete site ============
//
// Deleting a whole website is destructive and irreversible (unlike every
// other CMS write, which just edits a row), so it gets its own section: a
// summary the UI can show BEFORE anyone confirms, and the actual cascade.

export interface SiteDeletionSummary {
  site: Site;
  pages: number;
  blogPosts: number;
  mediaAssets: number;
  contentBlocks: number;
  domains: { host: string; verified: boolean }[];
}

/**
 * What `deleteSiteCascade(siteId)` would remove, for the confirmation UI.
 * Row counts come from the tenant DB (the ambient `db`, already scoped to
 * the caller's tenant by request routing); `domains` comes from the CONTROL
 * plane and is filtered by BOTH the caller's tenant id and the site id — a
 * site id alone is not unique across tenants, so tenant id is what stops
 * this from ever showing (and, in deleteSiteCascade, deleting) a domain row
 * that belongs to someone else's site that just happens to share an id.
 */
export async function summariseSiteDeletion(siteId: number): Promise<SiteDeletionSummary> {
  const site = await getSiteById(siteId);
  if (!site) throw new Error(`Unknown site id: ${siteId}`);

  const membership = getCurrentMembership();
  if (!membership) throw new Error("No active tenant for this request.");

  const pageRows = db.select({ id: pages.id }).from(pages).where(eq(pages.siteId, siteId)).all();
  const blogRows = db
    .select({ id: blogPosts.id })
    .from(blogPosts)
    .where(eq(blogPosts.siteId, siteId))
    .all();
  const mediaRows = db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(eq(mediaAssets.siteId, siteId))
    .all();
  const blockRows = db
    .select({ id: contentBlocks.id })
    .from(contentBlocks)
    .where(eq(contentBlocks.siteId, siteId))
    .all();
  const domainRows = authDb
    .select({ host: siteDomains.host, verifiedAt: siteDomains.verifiedAt })
    .from(siteDomains)
    .where(and(eq(siteDomains.tenantId, membership.tenant.id), eq(siteDomains.siteId, siteId)))
    .all();

  return {
    site,
    pages: pageRows.length,
    blogPosts: blogRows.length,
    mediaAssets: mediaRows.length,
    contentBlocks: blockRows.length,
    domains: domainRows.map((d) => ({ host: d.host, verified: Boolean(d.verifiedAt) })),
  };
}

/**
 * Delete a site and everything belonging to it, in the tenant DB, then the
 * control-plane domain rows that pointed at it.
 *
 * Explicit deletes rather than relying on the FK `onDelete: "cascade"`
 * declared in schema.ts: better-sqlite3 leaves `PRAGMA foreign_keys` OFF
 * unless a caller turns it on, so those cascades do not actually fire here —
 * trusting them would silently orphan pages/blocks/media/blog rows against a
 * site_id that no longer exists. Deleting in dependency order inside one
 * `db.transaction(...)` (this codebase's standard form — see
 * lib/pipeline/stageRepo.ts) makes the tenant-side removal atomic: either all
 * of it lands or none of it does.
 *
 * `site_requests` is handled differently on purpose: its FK is declared
 * "set null", not cascade — a site request is the record of a client's ask
 * and must survive the site it produced being deleted, so its `site_id` is
 * cleared rather than the row being removed.
 *
 * Uploaded media (files on the volume under public/sites/<slug>/…) is
 * deliberately NOT touched here — only the `media_assets` rows that
 * reference them. Orphaned files are recoverable (an operator can find and
 * clear them later); files deleted here would not be. Leaving them is the
 * safer default for an irreversible operation.
 */
export async function deleteSiteCascade(siteId: number): Promise<void> {
  const membership = getCurrentMembership();
  if (!membership) throw new Error("No active tenant for this request.");

  db.transaction((tx) => {
    tx.delete(seoMeta).where(eq(seoMeta.siteId, siteId)).run();
    tx.delete(contentBlocks).where(eq(contentBlocks.siteId, siteId)).run();
    tx.delete(pages).where(eq(pages.siteId, siteId)).run();
    tx.delete(blogPosts).where(eq(blogPosts.siteId, siteId)).run();
    tx.delete(mediaAssets).where(eq(mediaAssets.siteId, siteId)).run();
    tx.update(siteRequests).set({ siteId: null }).where(eq(siteRequests.siteId, siteId)).run();
    tx.delete(sites).where(eq(sites.id, siteId)).run();
  });

  // Control-plane cleanup happens OUTSIDE the transaction above (site_domains
  // lives in a different database — authDb, not the tenant db — so it can't
  // join a better-sqlite3 transaction scoped to the tenant connection), and
  // deliberately AFTER the tenant delete has already committed. If the
  // tenant-side transaction were to fail, the site row (and everything else)
  // would still exist, so nothing here must have run yet; ordering it the
  // other way round — clearing domains first — would risk leaving a still-
  // live site with its routing removed if the tenant delete then failed.
  authDb
    .delete(siteDomains)
    .where(and(eq(siteDomains.tenantId, membership.tenant.id), eq(siteDomains.siteId, siteId)))
    .run();
}
