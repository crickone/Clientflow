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

// ── What the generator has already proposed ────────────────────────────────
//
// The library above is what an operator CHOSE to keep. That is a much smaller
// set than what they have been shown, and feeding only the kept ideas back to
// the generator left it free to re-propose everything that was skipped — which
// is exactly what "the ideas keep repeating" was. `post_idea_seen` records
// every hook that reached the screen, and is read back as the avoid list for
// the next run (@/lib/ai/image/postIdeas).
//
// It is a ledger, not content: nothing displays it, it dedupes on `hook`, and
// it is pruned so a tenant generating ideas weekly for a year doesn't carry a
// prompt-sized history around.

/** How many recent hooks to keep on the ledger. Beyond this, the oldest are dropped. */
const SEEN_LIMIT = 400;

/** Record hooks the operator has now been shown. Idempotent, and prunes the tail. */
export function recordSuggested(hooks: readonly string[], tdb?: TenantDb): void {
  const clean = hooks.map((h) => h?.trim()).filter((h): h is string => Boolean(h));
  if (clean.length === 0) return;
  const c = conn(tdb);
  const ins = c.prepare("INSERT INTO post_idea_seen (hook) VALUES (?) ON CONFLICT(hook) DO NOTHING");
  c.transaction(() => {
    for (const h of clean) ins.run(h);
    c.prepare(
      `DELETE FROM post_idea_seen WHERE id NOT IN (
         SELECT id FROM post_idea_seen ORDER BY id DESC LIMIT ?
       )`,
    ).run(SEEN_LIMIT);
  })();
}

/**
 * The hooks to keep the generator away from, newest first: everything recently
 * shown, plus everything in the library. The library is folded in because a
 * saved or used idea must not come back as a "new" suggestion even after it has
 * fallen off the seen ledger.
 *
 * Ordered on `created_at`, not on id: the two tables have independent
 * autoincrement counters, so their ids are not comparable and sorting on them
 * would quietly rank a saved idea from last year above one shown this morning.
 * GROUP BY collapses a hook that lives in both tables to a single line.
 */
export function hooksToAvoid(limit = 60, tdb?: TenantDb): string[] {
  const rows = conn(tdb)
    .prepare(
      `SELECT hook, MAX(created_at) AS seen_at FROM (
         SELECT hook, created_at FROM post_idea_seen
         UNION ALL
         SELECT hook, created_at FROM post_ideas
       )
       GROUP BY hook
       ORDER BY seen_at DESC
       LIMIT ?`,
    )
    .all(limit) as { hook: string }[];
  return rows.map((r) => r.hook);
}
