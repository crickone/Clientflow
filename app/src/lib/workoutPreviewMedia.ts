/**
 * Pure helpers for resolving workout/circuit preview thumbnails.
 *
 * GEL whole-branch review (Important finding, see
 * docs/superpowers/specs/2026-08-24-global-exercise-library-design.md): the
 * workout/circuit preview pages used to key their thumbnail map by
 * `ExerciseLibRow.id` and look it up by the workout item's stored
 * `exerciseId`. The Global Exercise Library bootstrap renumbers exercise ids
 * (per-tenant ids -> control-plane ids), so any workout/circuit item created
 * BEFORE that migration carries a stale `exerciseId` that no longer points at
 * the right row (or, worse, could collide with an unrelated row that now
 * happens to have that id). The item also carries a denormalized `name`
 * (captured at add-time, already used for display) — that name is stable
 * across the id renumbering, so thumbnails now resolve by normalized name
 * instead. `exerciseId` stays on the item as a soft reference; it's just no
 * longer used to resolve display media.
 *
 * Deliberately NO `import "server-only"` and no DB — importable both from the
 * server preview pages and directly under the plain-tsx test runner
 * (workoutPreviewMedia.test.ts). Same reasoning as the other pure-util
 * modules (humanName.ts, workoutModel.ts).
 */

/** Normalize an exercise name into a lookup key: trim, lowercase, collapse
 *  internal whitespace runs to a single space. Applied on both sides of the
 *  lookup (building the map from library rows, and reading it with a
 *  workout/circuit item's `name`) so a name that differs only by case or
 *  incidental whitespace still resolves. */
export function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Build a thumbnail lookup keyed by normalized exercise name from a set of
 * library rows. On a name collision (e.g. a tenant's custom exercise shares
 * a name with a global one), a non-null `imageUrl` wins — an already-stored
 * image is never overwritten by a later null — order-independent.
 */
export function buildExerciseMediaMap(
  rows: { name: string; imageUrl: string | null }[],
): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const row of rows) {
    const key = normalizeExerciseName(row.name);
    if (map[key] != null) continue; // an earlier non-null image already claimed this name — keep it
    map[key] = row.imageUrl;
  }
  return map;
}
