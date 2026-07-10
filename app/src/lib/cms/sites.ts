import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { sites, type Site } from "@/lib/db/schema";

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
