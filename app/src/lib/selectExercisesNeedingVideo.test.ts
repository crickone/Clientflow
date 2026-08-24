// Run: npm test -- src/lib/selectExercisesNeedingVideo.test.ts
//
// GEL Task 3 (docs/superpowers/specs/2026-08-24-global-exercise-library-design.md):
// unit tests for the pure "which control exercise_library rows still need a
// video" selection (see ./exerciseLibrary, selectExercisesNeedingVideo) that
// now drives BOTH the nightly single-pass backfill
// (lib/automations/scheduler.ts) and the manual "Auto-find missing videos"
// bulk action (app/workout/exercises/actions.ts). Deliberately NOT testing
// either caller's DB/network/scheduler wiring here — same "TDD the guard,
// not the wiring" split as db/isWeeklyDue.test.ts.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

import type { ExerciseLibRow } from "./exerciseLibrary";

// ./exerciseLibrary -> @/lib/db/tenant (react `cache`) -- same shim as
// exerciseLibrary.test.ts / forms.test.ts / cms/blog.test.ts: `cache()` from
// "react" needs a render context that doesn't exist under this plain-tsx
// test runner, so it's stubbed to the identity function. We only exercise
// the pure selectExercisesNeedingVideo() export below, but importing the
// module still runs its top-level imports.
type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { selectExercisesNeedingVideo } = requireLocal("./exerciseLibrary") as typeof import("./exerciseLibrary");

  const row = (id: number, videoUrl: string | null): ExerciseLibRow => ({
    id,
    name: `Exercise ${id}`,
    category: null,
    muscleGroups: [],
    equipment: null,
    videoUrl,
    imageUrl: null,
    instructions: null,
  });

  let passed = 0;
  function check(name: string, cond: boolean) {
    assert.ok(cond, name);
    passed++;
    console.log("  ✓", name);
  }

  // Empty list -> empty result.
  check("empty list -> empty result", selectExercisesNeedingVideo([]).length === 0);

  // No video at all -> selected.
  const noVideo = row(1, null);
  check("null videoUrl -> selected", selectExercisesNeedingVideo([noVideo])[0]?.id === 1);

  // Blank string -> also "no video".
  const blankVideo = row(2, "");
  check("empty-string videoUrl -> selected", selectExercisesNeedingVideo([blankVideo])[0]?.id === 2);

  // A non-YouTube / garbage URL doesn't count as a real video.
  const garbage = row(3, "not a url");
  check("garbage videoUrl -> selected", selectExercisesNeedingVideo([garbage])[0]?.id === 3);

  // Valid YouTube URLs (every accepted parseYouTubeId form) are NOT selected.
  const watch = row(4, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  const short = row(5, "https://youtu.be/dQw4w9WgXcQ");
  const bareId = row(6, "dQw4w9WgXcQ");
  const embed = row(7, "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
  const stillMissing = selectExercisesNeedingVideo([watch, short, bareId, embed]);
  check("watch?v= URL -> NOT selected", stillMissing.every((e) => e.id !== 4));
  check("youtu.be URL -> NOT selected", stillMissing.every((e) => e.id !== 5));
  check("bare 11-char id -> NOT selected", stillMissing.every((e) => e.id !== 6));
  check("nocookie embed URL -> NOT selected", stillMissing.every((e) => e.id !== 7));

  // Mixed list: only the ones missing a valid video come back, order preserved.
  const mixed = [watch, noVideo, short, garbage];
  const mixedResult = selectExercisesNeedingVideo(mixed);
  check(
    "mixed list selects only the missing ones, in order",
    mixedResult.map((e) => e.id).join(",") === "1,3",
  );

  // Pure -- does not mutate the input array or its rows.
  const beforeJson = JSON.stringify(mixed);
  selectExercisesNeedingVideo(mixed);
  check("does not mutate the input array", JSON.stringify(mixed) === beforeJson);

  console.log(`selectExercisesNeedingVideo: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
