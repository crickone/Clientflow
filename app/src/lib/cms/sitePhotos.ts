import "server-only";

import { and, eq } from "drizzle-orm";

import type { TenantDb } from "@/lib/db/tenant";
import { getBlockValue } from "@/lib/cms/blocks";
import { pages } from "@/lib/db/schema";
import { pickPhotos, type PhotoPage } from "./sitePhotosModel";

/**
 * Photographs from the client's own published website for a page the
 * platform generates, matched to what it's about (sitePhotosModel). Never
 * throws: a site with no pages or pictures just gets none.
 */
export function getSitePhotos(db: TenantDb, siteId: number, words: string[], max = 4): string[] {
  try {
    const rows = db
      .select({ id: pages.id, path: pages.path, title: pages.title })
      .from(pages)
      .where(and(eq(pages.siteId, siteId), eq(pages.status, "published")))
      .all();
    const list: PhotoPage[] = rows.map((p) => ({
      path: p.path,
      title: p.title ?? "",
      html: getBlockValue(db, siteId, p.id, "body")?.value ?? "",
    }));
    return pickPhotos(list, words, max);
  } catch {
    return [];
  }
}
