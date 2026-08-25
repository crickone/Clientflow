// Run: npm test -- src/lib/youtube.test.ts
//
// Unit tests for exerciseHasVideo — the "does this exercise have a playable
// video" predicate shared by the 3 workout builders' exercise-picker rows
// (show the ▶ Play button only when true) and ExercisePreviewModal (embed vs
// "no video yet" fallback). youtube.ts has no server-only/DB imports, so this
// runs directly under the plain-tsx test runner — no `react` cache shim
// needed (unlike exerciseLibrary.test.ts / selectExercisesNeedingVideo.test.ts).
import assert from "node:assert/strict";

import { exerciseHasVideo } from "./youtube";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// No video at all -> false.
check("null videoUrl -> false", exerciseHasVideo({ videoUrl: null }) === false);
check("undefined videoUrl -> false", exerciseHasVideo({ videoUrl: undefined }) === false);
check("empty string -> false", exerciseHasVideo({ videoUrl: "" }) === false);

// Garbage / non-YouTube URLs don't count as a real video (never a broken embed).
check("garbage (non-URL) string -> false", exerciseHasVideo({ videoUrl: "not a url" }) === false);
check("non-YouTube URL -> false", exerciseHasVideo({ videoUrl: "https://example.com/video" }) === false);

// Every accepted parseYouTubeId form -> true.
check(
  "watch?v= URL -> true",
  exerciseHasVideo({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }) === true,
);
check("youtu.be short URL -> true", exerciseHasVideo({ videoUrl: "https://youtu.be/dQw4w9WgXcQ" }) === true);
check("bare 11-char id -> true", exerciseHasVideo({ videoUrl: "dQw4w9WgXcQ" }) === true);
check(
  "youtube-nocookie embed URL -> true",
  exerciseHasVideo({ videoUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" }) === true,
);

console.log(`exerciseHasVideo: ${passed} checks passed.`);
