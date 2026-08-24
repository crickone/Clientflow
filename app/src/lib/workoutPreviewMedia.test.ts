// Run: npm test -- src/lib/workoutPreviewMedia.test.ts
//
// Pure tests for normalizeExerciseName/buildExerciseMediaMap -- the
// GEL-whole-branch-review fix that resolves workout/circuit preview
// thumbnails by the item's denormalized exercise NAME instead of its
// (post-bootstrap, possibly-stale) `exerciseId`. workoutPreviewMedia.ts is
// deliberately free of `server-only`/DB so it imports cleanly under the
// plain-tsx test runner.
import assert from "node:assert/strict";

import { normalizeExerciseName, buildExerciseMediaMap } from "./workoutPreviewMedia";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// normalizeExerciseName: trims, lowercases, collapses internal whitespace runs
{
  check(
    "trims + lowercases + collapses whitespace",
    normalizeExerciseName("  Dumbbell   Press ") === "dumbbell press",
  );
  check("already-normalized name is unchanged", normalizeExerciseName("barbell squat") === "barbell squat");
}

// buildExerciseMediaMap: a row with an imageUrl is retrievable by its normalized name
{
  const map = buildExerciseMediaMap([{ name: "Barbell Squat", imageUrl: "https://cdn/squat.jpg" }]);
  check(
    "retrievable by its own normalized name",
    map[normalizeExerciseName("Barbell Squat")] === "https://cdn/squat.jpg",
  );
}

// buildExerciseMediaMap: a name differing only by case/whitespace still resolves
{
  const map = buildExerciseMediaMap([{ name: "Dumbbell Press", imageUrl: "https://cdn/press.jpg" }]);
  check(
    "case/whitespace-insensitive lookup resolves",
    map[normalizeExerciseName("  DUMBBELL   press")] === "https://cdn/press.jpg",
  );
}

// buildExerciseMediaMap: a row with a null imageUrl yields null (component falls back to a placeholder icon)
{
  const map = buildExerciseMediaMap([{ name: "Plank", imageUrl: null }]);
  check("null imageUrl resolves to null (placeholder fallback)", map[normalizeExerciseName("Plank")] === null);
}

// buildExerciseMediaMap: name collision -- a non-null image wins, order-independent
{
  const nonNullFirst = buildExerciseMediaMap([
    { name: "Lunge", imageUrl: "https://cdn/lunge.jpg" },
    { name: "lunge", imageUrl: null }, // same normalized name, no image
  ]);
  check(
    "collision (non-null row inserted first): non-null image wins",
    nonNullFirst[normalizeExerciseName("Lunge")] === "https://cdn/lunge.jpg",
  );

  const nullFirst = buildExerciseMediaMap([
    { name: "lunge", imageUrl: null },
    { name: "Lunge", imageUrl: "https://cdn/lunge.jpg" }, // same normalized name, has an image
  ]);
  check(
    "collision (null row inserted first): a later non-null image still wins",
    nullFirst[normalizeExerciseName("Lunge")] === "https://cdn/lunge.jpg",
  );
}

// THE REGRESSION THE REVIEW FOUND: an item's stored exerciseId does NOT
// match the library row's post-bootstrap id (a same-valued id now belongs to
// an unrelated exercise), but its denormalized name does. Simulate the OLD
// id-keyed lookup (what the code used to do) side-by-side with the NEW
// name-keyed one, to prove the fix actually fixes the bug: the old approach
// resolves the WRONG image, the new one resolves the CORRECT one -- i.e.
// name-resolution is id-namespace-agnostic, immune to the GEL bootstrap's id
// renumbering.
{
  // Pre-bootstrap: this workout item was added when "Bench Press" was id 3.
  const item = { exerciseId: 3, name: "Bench Press" };
  // Post-bootstrap: the control-plane library renumbered "Bench Press" to id
  // 13; id 3 in the new namespace now belongs to an unrelated exercise.
  const library = [
    { id: 13, name: "Bench Press", imageUrl: "https://cdn/bench-press.jpg" },
    { id: 3, name: "Kettlebell Swing", imageUrl: "https://cdn/kb-swing.jpg" },
  ];

  // OLD behavior (the bug): id-keyed map, looked up by the item's stale exerciseId.
  const idKeyedMap = Object.fromEntries(library.map((r) => [r.id, r.imageUrl] as const));
  const oldResolvedUrl = idKeyedMap[item.exerciseId] ?? null;
  check(
    "proves the bug existed: the OLD id-keyed lookup returns the WRONG image",
    oldResolvedUrl === "https://cdn/kb-swing.jpg",
  );

  // NEW behavior (the fix): name-keyed map, looked up by the item's name.
  const media = buildExerciseMediaMap(library);
  const newResolvedUrl = media[normalizeExerciseName(item.name)] ?? null;
  check(
    "the fix: name-keyed lookup returns the CORRECT image despite the id mismatch",
    newResolvedUrl === "https://cdn/bench-press.jpg",
  );
}

console.log(`\nworkoutPreviewMedia.test.ts: ${passed} checks passed.`);
