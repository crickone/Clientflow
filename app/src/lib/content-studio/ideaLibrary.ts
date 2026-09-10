import "server-only";

import { getCurrentTenantDb, type TenantDb } from "@/lib/db/tenant";
import type { PostIdea } from "@/lib/ai/image/postIdeas";

/**
 * The ideas library: post ideas an operator chose to keep.
 *
 * Generated ideas are ephemeral — pressing "Suggest ideas" again replaces
 * them — so a good idea that isn't wanted today is simply lost, and the good
 * ones tend to arrive when you're busy writing something else. Saving takes a
 * SNAPSHOT of the idea's fields rather than referencing the generation that
 * produced it: the whole point is that it survives, and re-running the
 * generator must never rewrite what someone deliberately kept.
 *
 * Saving is idempotent on `hook` (a unique index) because the generator does
 * repeat itself across runs — without that, a library fills with near-
 * duplicates and stops being worth opening.
 *
 * A used idea is marked, never deleted. "What have we already covered?" is a
 * question the library should be able to answer, and an idea that produced a
 * good post is often worth a second angle later.
 */

export type IdeaStatus = "saved" | "used";

export interface SavedIdea extends PostIdea {
  id: number;
  status: IdeaStatus;
  createdAt: number;
  usedAt: number | null;
}

type Raw = {
  id: number;
  pillar: string;
  hook: string;
  teaches: string;
  basis: string;
  needs_source: string | null;
  status: string;
  created_at: number;
  used_at: number | null;
};

const toIdea = (r: Raw): SavedIdea => ({
  id: r.id,
  pillar: r.pillar,
  hook: r.hook,
  teaches: r.teaches,
  basis: r.basis,
  needsSource: r.needs_source ?? undefined,
  status: r.status as IdeaStatus,
  createdAt: r.created_at,
  usedAt: r.used_at,
});

function conn(tdb?: TenantDb) {
  return (
    (tdb ?? getCurrentTenantDb()) as unknown as { $client: import("better-sqlite3").Database }
  ).$client;
}

/**
 * Keep an idea. Returns the stored row — including when it was already there,
 * so the caller can treat "saved" and "already saved" the same and just show
 * the idea as kept.
 */
export function saveIdea(idea: PostIdea, tdb?: TenantDb): SavedIdea | null {
  const hook = idea.hook?.trim();
  if (!hook) return null;
  const c = conn(tdb);
  c.prepare(
    `INSERT INTO post_ideas (pillar, hook, teaches, basis, needs_source)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT(hook) DO NOTHING`,
  ).run(
    (idea.pillar ?? "").trim(),
    hook,
    (idea.teaches ?? "").trim(),
    (idea.basis ?? "").trim(),
    idea.needsSource?.trim() || null,
  );
  const row = c.prepare("SELECT * FROM post_ideas WHERE hook = ?").get(hook) as Raw | undefined;
  return row ? toIdea(row) : null;
}

/** The library, newest first. Unused ideas come first — those are the ones still waiting to be written. */
export function listIdeas(tdb?: TenantDb, limit = 100): SavedIdea[] {
  const rows = conn(tdb)
    .prepare(
      `SELECT * FROM post_ideas ORDER BY (status = 'used') ASC, id DESC LIMIT ?`,
    )
    .all(limit) as Raw[];
  return rows.map(toIdea);
}

/** Just the hooks already in the library — enough for the generator list to show which ideas are already kept. */
export function savedHooks(tdb?: TenantDb): Set<string> {
  const rows = conn(tdb).prepare("SELECT hook FROM post_ideas").all() as { hook: string }[];
  return new Set(rows.map((r) => r.hook));
}

export function deleteIdea(id: number, tdb?: TenantDb): void {
  conn(tdb).prepare("DELETE FROM post_ideas WHERE id = ?").run(id);
}

/** Mark an idea as turned into a post. Kept in the library, not removed — see the file header. */
export function markIdeaUsed(hook: string, tdb?: TenantDb): void {
  conn(tdb)
    .prepare(
      "UPDATE post_ideas SET status = 'used', used_at = unixepoch() * 1000 WHERE hook = ? AND status != 'used'",
    )
    .run(hook);
}
