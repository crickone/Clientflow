import "server-only";

import { desc, eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { SiteRequest } from "@/lib/db/schema";
import { createSite, normalizeSlug } from "@/lib/cms/sites";

const { siteRequests } = schema;

export interface NewRequestInput {
  businessName: string;
  contactName?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
}

export function createRequest(input: NewRequestInput): SiteRequest {
  return db
    .insert(siteRequests)
    .values({
      businessName: input.businessName.trim(),
      contactName: input.contactName?.trim() || null,
      contactEmail: input.contactEmail?.trim() || null,
      notes: input.notes?.trim() || null,
      status: "new",
    })
    .returning()
    .get();
}

export function listRequests(): SiteRequest[] {
  return db
    .select()
    .from(siteRequests)
    .orderBy(desc(siteRequests.createdAt))
    .all();
}

/**
 * Cheap COUNT of pending ("new") site requests — powers the sidebar's Sites
 * nav badge. A single indexed-by-status count, safe to run on every page load.
 */
export function countPendingRequests(): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(siteRequests)
      .where(eq(siteRequests.status, "new"))
      .get()?.n ?? 0
  );
}

export function getRequest(id: number): SiteRequest | null {
  return db.select().from(siteRequests).where(eq(siteRequests.id, id)).get() ?? null;
}

export function setRequestStatus(
  id: number,
  status: SiteRequest["status"],
): void {
  db.update(siteRequests)
    .set({ status, updatedAt: new Date() })
    .where(eq(siteRequests.id, id))
    .run();
}

/** Fulfil a request: provision the actual site and link it back. */
export async function fulfilRequest(
  id: number,
): Promise<{ siteSlug: string } | null> {
  const req = getRequest(id);
  if (!req) return null;
  const slug = normalizeSlug(req.businessName);
  const site = await createSite({ name: req.businessName, slug });
  db.update(siteRequests)
    .set({ status: "fulfilled", siteId: site.id, updatedAt: new Date() })
    .where(eq(siteRequests.id, id))
    .run();
  return { siteSlug: site.slug };
}
