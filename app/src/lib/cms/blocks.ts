import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { ContentBlock, BlockKind } from "@/lib/db/schema";
import type { TenantDb } from "@/lib/db/tenant";

const { contentBlocks } = schema;

function whereBlock(siteId: number, pageId: number | null, name: string) {
  return and(
    eq(contentBlocks.siteId, siteId),
    pageId == null ? isNull(contentBlocks.pageId) : eq(contentBlocks.pageId, pageId),
    eq(contentBlocks.name, name),
  );
}

/** PUBLIC read — uses an explicitly-resolved TenantDb (never the cookie proxy). */
export function getBlockValue(
  publicDb: TenantDb,
  siteId: number,
  pageId: number | null,
  name: string,
): { value: string | null; mediaAssetId: number | null; kind: BlockKind } | null {
  const row = publicDb
    .select()
    .from(contentBlocks)
    .where(whereBlock(siteId, pageId, name))
    .get();
  if (!row) return null;
  return { value: row.value, mediaAssetId: row.mediaAssetId, kind: row.kind };
}

/** ADMIN: list all blocks for a page (or site-global when pageId null). */
export function listBlocksForPage(siteId: number, pageId: number | null): ContentBlock[] {
  return db
    .select()
    .from(contentBlocks)
    .where(
      and(
        eq(contentBlocks.siteId, siteId),
        pageId == null ? isNull(contentBlocks.pageId) : eq(contentBlocks.pageId, pageId),
      ),
    )
    .all();
}

export function getBlock(
  siteId: number,
  pageId: number | null,
  name: string,
): ContentBlock | null {
  return db.select().from(contentBlocks).where(whereBlock(siteId, pageId, name)).get() ?? null;
}

export interface UpsertBlockInput {
  siteId: number;
  pageId: number | null;
  name: string;
  kind: BlockKind;
  value?: string | null;
  mediaAssetId?: number | null;
}

/** ADMIN: insert or update a block (uniqueness on site_id, page_id, name). */
export function upsertBlock(input: UpsertBlockInput): void {
  const existing = getBlock(input.siteId, input.pageId, input.name);
  if (existing) {
    db.update(contentBlocks)
      .set({
        kind: input.kind,
        value: input.value ?? null,
        mediaAssetId: input.mediaAssetId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(contentBlocks.id, existing.id))
      .run();
  } else {
    db.insert(contentBlocks)
      .values({
        siteId: input.siteId,
        pageId: input.pageId,
        name: input.name,
        kind: input.kind,
        value: input.value ?? null,
        mediaAssetId: input.mediaAssetId ?? null,
      })
      .run();
  }
}
