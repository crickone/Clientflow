import "server-only";

import { and, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getBlock, upsertBlock, deleteBlock } from "@/lib/cms/blocks";
import { rebuildBodyWithContent, splitPageBody } from "@/lib/cms/pageBody";
import type { TenantDb } from "@/lib/db/tenant";

const { contentBlocks, pages } = schema;

/**
 * A page draft is a second content_blocks row holding ONLY the content zone
 * (see lib/cms/pageBody.ts) of an edited page. Storing the content zone alone
 * — rather than a whole body — means a draft stays valid if the page is
 * re-imported underneath it: publishing re-joins the draft against whatever
 * head/tail the body holds AT PUBLISH TIME, so new CSS is picked up instead of
 * being clobbered by a stale copy.
 *
 * One draft per page holds in practice, but NOT because of a database
 * constraint: the (site_id, page_id, name) index in lib/db/schema.ts is a
 * plain `index(...)`, not a `uniqueIndex(...)` (contrast `pages`'s
 * ux_pages_site_path). upsertBlock (lib/cms/blocks.ts) is a manual
 * select-then-insert-or-update with no transaction around it. The reason two
 * drafts never land for the same page is that better-sqlite3 is synchronous
 * and upsertBlock never awaits mid-function, so there is no interleaving
 * window in this single-process app. That guarantee would stop holding if
 * this ever ran as multiple replicas against one SQLite file, or if the
 * read/write path became async — either would open a window for the
 * select-then-insert race to produce duplicate rows.
 */
export const DRAFT_BLOCK = "body:draft";

/**
 * ADMIN read: resolves via the ambient `db` proxy, i.e. the SESSION's active
 * tenant (authSessions.activeTenantId). Correct for admin/server-action
 * callers that are working the operator's own active tenant (the Studio
 * editor actions). NOT safe to call with a siteId/pageId that came from a
 * host-resolved site — see getDraftContentFrom below.
 */
export function getDraftContent(siteId: number, pageId: number): string | null {
  return getBlock(siteId, pageId, DRAFT_BLOCK)?.value ?? null;
}

/**
 * PUBLIC/host-resolved read: takes an explicit TenantDb (from
 * resolvePublicSite, e.g. PageContext.ctx.db) rather than the ambient
 * session-cookie proxy. An agency staffer's active tenant (their session
 * cookie) can differ from the tenant that owns the host/domain they are
 * viewing, and siteId/pageId are per-tenant numeric ids that collide across
 * tenant databases — reading a draft through the wrong db would return
 * (or silently miss) another tenant's row that merely happens to share the
 * same ids. Callers that render what a visitor/host sees (editBodyZones)
 * MUST use this, paired with getBlockValue's public read of "body", so both
 * reads come from the same database.
 */
export function getDraftContentFrom(
  publicDb: TenantDb,
  siteId: number,
  pageId: number,
): string | null {
  const row = publicDb
    .select()
    .from(contentBlocks)
    .where(
      and(
        eq(contentBlocks.siteId, siteId),
        eq(contentBlocks.pageId, pageId),
        eq(contentBlocks.name, DRAFT_BLOCK),
      ),
    )
    .get();
  return row?.value ?? null;
}

export function setDraftContent(siteId: number, pageId: number, content: string): void {
  upsertBlock({ siteId, pageId, name: DRAFT_BLOCK, kind: "html", value: content });
}

export function clearDraft(siteId: number, pageId: number): void {
  deleteBlock(siteId, pageId, DRAFT_BLOCK);
}

/**
 * A draft is allowed to publish only if it keeps at least this fraction of
 * the current content zone's length. Guards against publishing an empty or
 * near-empty draft over a full page — either a parse failure in clean()
 * (StudioCanvas) or a subtree wiped out by the wrapper-div-becomes-editable
 * bug (see StudioCanvas's kindFor). 20% is deliberately generous: a
 * legitimate edit that trims a lot of copy still clears it comfortably,
 * while an accidentally-wiped subtree (near-zero length) or an empty parse
 * result does not.
 */
export const MIN_DRAFT_RETENTION = 0.2;

/**
 * The outcome of the publish-size guard, as a discriminated union so a
 * caller can tell "refused" apart from "nothing to publish" and report the
 * specific reason (see publishDraft/PublishOutcome below, which layer the
 * "no draft at all" case on top of this).
 */
export type PublishGate =
  | { allowed: true }
  | { allowed: false; reason: "empty"; currentLength: number; draftLength: number }
  | { allowed: false; reason: "too-small"; currentLength: number; draftLength: number };

/**
 * Pure decision: is `draftContent` an acceptable replacement for
 * `currentContent`? Takes plain strings (the page's current content zone and
 * the candidate draft content) and returns a verdict — no DB, no I/O, so it
 * can be unit tested directly. publishDraft (below) is the only caller that
 * matters in production; it feeds this the real current content zone and
 * the real draft before ever writing anything.
 */
export function canPublishDraft(currentContent: string, draftContent: string): PublishGate {
  const draftLength = draftContent.length;
  if (draftContent.trim() === "") {
    return { allowed: false, reason: "empty", currentLength: currentContent.length, draftLength };
  }
  const currentLength = currentContent.trim().length;
  // Only guard against shrinkage when there's something to shrink from — a
  // page whose content zone is already empty (a brand-new page, say) has no
  // "current size" to be drastically smaller than.
  if (currentLength > 0 && draftLength < currentLength * MIN_DRAFT_RETENTION) {
    return { allowed: false, reason: "too-small", currentLength, draftLength };
  }
  return { allowed: true };
}

export type PublishOutcome =
  | { ok: true }
  | { ok: false; reason: "no-draft" }
  | { ok: false; reason: "empty" | "too-small"; currentLength: number; draftLength: number };

/**
 * Publish: rebuild the body as head + draft content + tail, then consume the
 * draft. Returns a PublishOutcome rather than a bare boolean so the caller
 * (publishDraftAction) can tell "there was no draft to publish" apart from
 * "there WAS a draft, but publishing it was refused" and surface the
 * specific reason to the operator instead of silently doing nothing.
 *
 * The upsert-body and clear-draft writes run inside one
 * `db.transaction(...)` (the codebase's standard drizzle/better-sqlite3
 * synchronous transaction form — see lib/pipeline/stageRepo.ts) so a crash
 * between the two can never leave a stale draft sitting beside an
 * already-published body. blocks.ts's upsertBlock/deleteBlock aren't reused
 * here because they operate on the ambient `db`, not the transaction's `tx`;
 * the write shape below mirrors them exactly, applied through `tx`.
 */
export function publishDraft(siteId: number, pageId: number): PublishOutcome {
  const draft = getDraftContent(siteId, pageId);
  if (draft == null) return { ok: false, reason: "no-draft" };
  const body = getBlock(siteId, pageId, "body")?.value ?? "";
  const currentContent = splitPageBody(body).content;

  const gate = canPublishDraft(currentContent, draft);
  if (!gate.allowed) {
    return { ok: false, reason: gate.reason, currentLength: gate.currentLength, draftLength: gate.draftLength };
  }

  const nextBody = rebuildBodyWithContent(body, draft);

  db.transaction((tx) => {
    const existingBody = tx
      .select()
      .from(contentBlocks)
      .where(
        and(
          eq(contentBlocks.siteId, siteId),
          eq(contentBlocks.pageId, pageId),
          eq(contentBlocks.name, "body"),
        ),
      )
      .get();
    if (existingBody) {
      tx.update(contentBlocks)
        .set({ kind: "html", value: nextBody, mediaAssetId: null, updatedAt: new Date() })
        .where(eq(contentBlocks.id, existingBody.id))
        .run();
    } else {
      tx.insert(contentBlocks)
        .values({ siteId, pageId, name: "body", kind: "html", value: nextBody, mediaAssetId: null })
        .run();
    }
    tx.delete(contentBlocks)
      .where(
        and(
          eq(contentBlocks.siteId, siteId),
          eq(contentBlocks.pageId, pageId),
          eq(contentBlocks.name, DRAFT_BLOCK),
        ),
      )
      .run();
  });
  return { ok: true };
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
