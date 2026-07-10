import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { Page } from "@/lib/db/schema";
import type { TenantDb } from "@/lib/db/tenant";

const { pages } = schema;

export function listPages(siteId: number): Page[] {
  return db
    .select()
    .from(pages)
    .where(eq(pages.siteId, siteId))
    .orderBy(asc(pages.sortOrder), asc(pages.path))
    .all();
}

export function getPageByPath(siteId: number, path: string): Page | null {
  return (
    db
      .select()
      .from(pages)
      .where(and(eq(pages.siteId, siteId), eq(pages.path, path)))
      .get() ?? null
  );
}

export function getPage(siteId: number, id: number): Page | null {
  return (
    db
      .select()
      .from(pages)
      .where(and(eq(pages.siteId, siteId), eq(pages.id, id)))
      .get() ?? null
  );
}

export interface UpsertPageInput {
  siteId: number;
  pageKey: string;
  path: string;
  title?: string | null;
  templateId: string;
  sortOrder?: number;
  showInSitemap?: boolean;
}

/** Create or update a page by (siteId, path). Returns the page id. */
export function upsertPage(input: UpsertPageInput): number {
  const existing = db
    .select()
    .from(pages)
    .where(and(eq(pages.siteId, input.siteId), eq(pages.path, input.path)))
    .get();
  if (existing) {
    db.update(pages)
      .set({
        pageKey: input.pageKey,
        title: input.title ?? existing.title,
        templateId: input.templateId,
        sortOrder: input.sortOrder ?? existing.sortOrder,
        showInSitemap: input.showInSitemap ?? existing.showInSitemap,
        updatedAt: new Date(),
      })
      .where(eq(pages.id, existing.id))
      .run();
    return existing.id;
  }
  const row = db
    .insert(pages)
    .values({
      siteId: input.siteId,
      pageKey: input.pageKey,
      path: input.path,
      title: input.title ?? null,
      templateId: input.templateId,
      sortOrder: input.sortOrder ?? 0,
      showInSitemap: input.showInSitemap ?? true,
    })
    .returning({ id: pages.id })
    .get();
  return row.id;
}

export function setPageStatus(
  siteId: number,
  id: number,
  status: "draft" | "published",
): void {
  db.update(pages)
    .set({
      status,
      publishedAt: status === "published" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(and(eq(pages.siteId, siteId), eq(pages.id, id)))
    .run();
}

// ---- PUBLIC reads (explicit TenantDb) ----

export function getPublishedPageByPath(
  publicDb: TenantDb,
  siteId: number,
  path: string,
): Page | null {
  return (
    publicDb
      .select()
      .from(pages)
      .where(
        and(
          eq(pages.siteId, siteId),
          eq(pages.path, path),
          eq(pages.status, "published"),
        ),
      )
      .get() ?? null
  );
}

export function listPublishedPagesForSitemap(
  publicDb: TenantDb,
  siteId: number,
): Page[] {
  return publicDb
    .select()
    .from(pages)
    .where(and(eq(pages.siteId, siteId), eq(pages.status, "published")))
    .all();
}
