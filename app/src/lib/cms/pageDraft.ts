import "server-only";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getBlock, upsertBlock, deleteBlock } from "@/lib/cms/blocks";
import { rebuildBodyWithContent } from "@/lib/cms/pageBody";

const { contentBlocks, pages } = schema;

/**
 * A page draft is a second content_blocks row holding ONLY the content zone
 * (see lib/cms/pageBody.ts) of an edited page. Storing the content zone alone
 * — rather than a whole body — means a draft stays valid if the page is
 * re-imported underneath it: publishing re-joins the draft against whatever
 * head/tail the body holds AT PUBLISH TIME, so new CSS is picked up instead of
 * being clobbered by a stale copy.
 *
 * The existing (site_id, page_id, name) uniqueness gives one draft per page
 * for free, so this needs no schema change.
 */
export const DRAFT_BLOCK = "body:draft";

export function getDraftContent(siteId: number, pageId: number): string | null {
  return getBlock(siteId, pageId, DRAFT_BLOCK)?.value ?? null;
}

export function setDraftContent(siteId: number, pageId: number, content: string): void {
  upsertBlock({ siteId, pageId, name: DRAFT_BLOCK, kind: "html", value: content });
}

export function clearDraft(siteId: number, pageId: number): void {
  deleteBlock(siteId, pageId, DRAFT_BLOCK);
}

/**
 * Publish: rebuild the body as head + draft content + tail, then consume the
 * draft. Returns false when there was nothing to publish.
 */
export function publishDraft(siteId: number, pageId: number): boolean {
  const draft = getDraftContent(siteId, pageId);
  if (draft == null) return false;
  const body = getBlock(siteId, pageId, "body")?.value ?? "";
  upsertBlock({
    siteId,
    pageId,
    name: "body",
    kind: "html",
    value: rebuildBodyWithContent(body, draft),
  });
  clearDraft(siteId, pageId);
  return true;
}

/** Paths of every page in the site that currently has an unpublished draft. */
export function listPagePathsWithDrafts(siteId: number): string[] {
  return db
    .select({ path: pages.path })
    .from(contentBlocks)
    .innerJoin(pages, eq(pages.id, contentBlocks.pageId))
    .where(and(eq(contentBlocks.siteId, siteId), eq(contentBlocks.name, DRAFT_BLOCK)))
    .all()
    .map((r) => r.path);
}
