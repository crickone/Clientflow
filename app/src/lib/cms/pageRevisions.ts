import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { contentBlocks, pageRevisions } from "@/lib/db/schema";

/**
 * Every published version of a page, so no edit is ever the last word.
 *
 * A page had exactly one body. Any write — a publish from the editor, an
 * image swapped by the assistant, a deploy — replaced it with no way back.
 * That is the whole reason the deploy sync had to lock a page outright the
 * moment a person touched it: an overwrite could not be undone, so it had to
 * be prevented.
 *
 * With a history it can be undone, and the rest follows: restoring is a
 * button, "who changed this and when" has an answer, and a merge could later
 * be attempted knowing a bad one is recoverable.
 *
 * Ambient `db` throughout, matching every other CMS helper: callers are a
 * request or a job already inside runWithTenant.
 */
export type RevisionSource = "studio" | "agent" | "deploy" | "restore" | "baseline";

export interface PageRevision {
  id: number;
  body: string;
  source: RevisionSource;
  createdBy: number | null;
  note: string | null;
  createdAt: Date;
}

/**
 * How many versions of one page are kept.
 *
 * A page body runs to ~35 KB, so an unbounded history would grow by that
 * much per edit forever, per page, per tenant. Fifty is far more than anyone
 * scrolls back through and still only a couple of megabytes for a busy page.
 */
export const MAX_REVISIONS_PER_PAGE = 50;

/** The current stored body, or "" when the page has none yet. */
function currentBody(siteId: number, pageId: number): string {
  const row = db
    .select({ value: contentBlocks.value })
    .from(contentBlocks)
    .where(
      and(
        eq(contentBlocks.siteId, siteId),
        eq(contentBlocks.pageId, pageId),
        eq(contentBlocks.name, "body"),
      ),
    )
    .get();
  return row?.value ?? "";
}

function countFor(siteId: number, pageId: number): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(pageRevisions)
      .where(and(eq(pageRevisions.siteId, siteId), eq(pageRevisions.pageId, pageId)))
      .get()?.n ?? 0
  );
}

/**
 * Record a version of a page.
 *
 * Call this BEFORE writing, with the body about to be replaced — the point
 * of a history is to hold what you are about to lose, and recording the new
 * value instead would mean the very first edit had nothing to go back to.
 *
 * The first call for a page also has nothing behind it, so that first
 * snapshot IS the pre-history state and is marked "baseline". Without it the
 * first edit after this shipped would be unrecoverable, which is precisely
 * the situation this exists to end.
 *
 * Never throws. A page must still save when its history cannot be written;
 * losing the audit trail is bad, refusing the operator's edit is worse.
 */
export function snapshotPage(
  siteId: number,
  pageId: number,
  opts: { source: RevisionSource; createdBy?: number | null; note?: string | null } = {
    source: "studio",
  },
): void {
  try {
    const body = currentBody(siteId, pageId);
    if (!body.trim()) return; // nothing worth keeping

    const existing = countFor(siteId, pageId);
    db.insert(pageRevisions)
      .values({
        siteId,
        pageId,
        body,
        // The state found before any history existed is not an edit anyone
        // made; labelling it honestly stops it reading as somebody's work.
        source: existing === 0 ? "baseline" : opts.source,
        createdBy: opts.createdBy ?? null,
        note: opts.note ?? null,
      })
      .run();

    prunePage(siteId, pageId);
  } catch (err) {
    console.error(`[pageRevisions] could not snapshot page ${pageId}:`, err);
  }
}

/** Drop the oldest versions once a page has more than the cap. */
export function prunePage(siteId: number, pageId: number): number {
  const keep = db
    .select({ id: pageRevisions.id })
    .from(pageRevisions)
    .where(and(eq(pageRevisions.siteId, siteId), eq(pageRevisions.pageId, pageId)))
    .orderBy(desc(pageRevisions.createdAt), desc(pageRevisions.id))
    .limit(MAX_REVISIONS_PER_PAGE)
    .all()
    .map((r) => r.id);
  if (keep.length < MAX_REVISIONS_PER_PAGE) return 0;

  const res = db
    .delete(pageRevisions)
    .where(
      and(
        eq(pageRevisions.siteId, siteId),
        eq(pageRevisions.pageId, pageId),
        sql`${pageRevisions.id} NOT IN (${sql.join(keep.map((id) => sql`${id}`), sql`, `)})`,
      ),
    )
    .run();
  return res.changes ?? 0;
}

/**
 * A page's versions, newest first. Bodies are included — a caller showing a
 * list should take what it needs and not hold 50 × 35 KB longer than it must.
 */
export function listRevisions(siteId: number, pageId: number, limit = MAX_REVISIONS_PER_PAGE): PageRevision[] {
  return db
    .select()
    .from(pageRevisions)
    .where(and(eq(pageRevisions.siteId, siteId), eq(pageRevisions.pageId, pageId)))
    .orderBy(desc(pageRevisions.createdAt), desc(pageRevisions.id))
    .limit(limit)
    .all()
    .map((r) => ({
      id: r.id,
      body: r.body,
      source: r.source as RevisionSource,
      createdBy: r.createdBy,
      note: r.note,
      createdAt: r.createdAt,
    }));
}

export function getRevision(siteId: number, pageId: number, revisionId: number): PageRevision | null {
  const r = db
    .select()
    .from(pageRevisions)
    .where(
      and(
        eq(pageRevisions.siteId, siteId),
        eq(pageRevisions.pageId, pageId),
        eq(pageRevisions.id, revisionId),
      ),
    )
    .get();
  if (!r) return null;
  return {
    id: r.id,
    body: r.body,
    source: r.source as RevisionSource,
    createdBy: r.createdBy,
    note: r.note,
    createdAt: r.createdAt,
  };
}

export type RestoreOutcome =
  | { ok: true; restoredFrom: Date }
  | { ok: false; error: string };

/**
 * Put a page back to one of its earlier versions.
 *
 * A restore is itself a change, so the current body is snapshotted first:
 * going back must be as undoable as going forward, or "restore" becomes its
 * own way to lose work.
 *
 * `updated_by` is set to whoever restored, which keeps the deploy sync's
 * rule intact — a restored page is a page a person decided about, and the
 * repo should not quietly replace it on the next deploy.
 */
export function restoreRevision(
  siteId: number,
  pageId: number,
  revisionId: number,
  restoredBy?: number | null,
): RestoreOutcome {
  const revision = getRevision(siteId, pageId, revisionId);
  if (!revision) return { ok: false, error: "That version no longer exists." };
  if (!revision.body.trim()) return { ok: false, error: "That version is empty." };

  const now = new Date();
  const label = revision.createdAt.toISOString();

  snapshotPage(siteId, pageId, {
    source: "restore",
    createdBy: restoredBy ?? null,
    note: `Replaced by a restore of the version from ${label}`,
  });

  const existing = db
    .select({ id: contentBlocks.id })
    .from(contentBlocks)
    .where(
      and(
        eq(contentBlocks.siteId, siteId),
        eq(contentBlocks.pageId, pageId),
        eq(contentBlocks.name, "body"),
      ),
    )
    .get();

  if (existing) {
    db.update(contentBlocks)
      .set({ value: revision.body, kind: "html", updatedBy: restoredBy ?? null, updatedAt: now })
      .where(eq(contentBlocks.id, existing.id))
      .run();
  } else {
    db.insert(contentBlocks)
      .values({
        siteId,
        pageId,
        name: "body",
        kind: "html",
        value: revision.body,
        updatedBy: restoredBy ?? null,
      })
      .run();
  }

  return { ok: true, restoredFrom: revision.createdAt };
}
