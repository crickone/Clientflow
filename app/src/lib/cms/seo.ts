import "server-only";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { SeoMeta } from "@/lib/db/schema";
import type { TenantDb } from "@/lib/db/tenant";

const { seoMeta } = schema;

export function getSeo(siteId: number, pageId: number): SeoMeta | null {
  return (
    db
      .select()
      .from(seoMeta)
      .where(and(eq(seoMeta.siteId, siteId), eq(seoMeta.pageId, pageId)))
      .get() ?? null
  );
}

export interface SeoPatch {
  seoTitle?: string | null;
  seoDescription?: string | null;
  canonicalUrl?: string | null;
  robots?: string;
  ogImageAssetId?: number | null;
  jsonLd?: string | null;
}

export function upsertSeo(siteId: number, pageId: number, patch: SeoPatch): void {
  const existing = getSeo(siteId, pageId);
  if (existing) {
    db.update(seoMeta)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(seoMeta.id, existing.id))
      .run();
  } else {
    db.insert(seoMeta)
      .values({ siteId, pageId, ...patch })
      .run();
  }
}

/** PUBLIC read (explicit TenantDb). */
export function getSeoPublic(
  publicDb: TenantDb,
  siteId: number,
  pageId: number,
): SeoMeta | null {
  return (
    publicDb
      .select()
      .from(seoMeta)
      .where(and(eq(seoMeta.siteId, siteId), eq(seoMeta.pageId, pageId)))
      .get() ?? null
  );
}
