// Run: npm test -- src/lib/image/photoScenes.test.ts
//
// A two-photograph slide asks for two DIFFERENT pictures -- infrared above,
// HBOT below. The scenes were parsed and then thrown away, so "Make a new
// photo" with the second slot targeted was briefed with slot 1's scene and
// generated a second infrared bed, reporting nothing wrong. image_prompt holds
// one string; this is the second slot's home, and the bridge for every row
// that predates it.
import assert from "node:assert/strict";

import { parsePhotoScenes, sceneForSlot, serialisePhotoScenes } from "./photoScenes";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

check(
  "an old row with no JSON reads as its image prompt in slot 1",
  eq(parsePhotoScenes(null, "a quiet treatment room"), ["a quiet treatment room"]),
);
check(
  "an old row with no scene at all reads as empty",
  eq(parsePhotoScenes(null, null), []),
);
check(
  "a blank image prompt is no scene, not a blank one",
  eq(parsePhotoScenes(null, "   "), []),
);
check(
  "a stored pair reads back in order",
  eq(parsePhotoScenes('["infrared","hbot"]', "infrared"), ["infrared", "hbot"]),
);
check(
  "malformed JSON falls back to the image prompt rather than throwing",
  eq(parsePhotoScenes("not json", "infrared"), ["infrared"]),
);
check(
  "a JSON value that is not an array falls back too",
  eq(parsePhotoScenes('{"a":1}', "infrared"), ["infrared"]),
);
check(
  "a non-string entry becomes blank IN PLACE -- compacting would slide slot 2's brief onto slot 1",
  eq(parsePhotoScenes("[7,\"hbot\"]", null), ["", "hbot"]),
);
check(
  "more slots than the cap are dropped",
  eq(parsePhotoScenes('["a","b","c"]', "a"), ["a", "b"]),
);

check(
  "serialising a pair gives compact JSON",
  serialisePhotoScenes(["infrared", "hbot"]) === '["infrared","hbot"]',
);
check(
  "a single scene stores null -- image_prompt already says it",
  serialisePhotoScenes(["infrared"]) === null,
);
check("no scenes stores null", serialisePhotoScenes([]) === null);
check(
  "a pair of blanks stores null -- a model that named neither has told us nothing",
  serialisePhotoScenes(["", ""]) === null,
);
check(
  "a blank FIRST slot is still worth storing, because slot 2's brief is not",
  serialisePhotoScenes(["", "hbot"]) === '["","hbot"]',
);

// The selector is what the generate route and the dialog hint share, so they
// cannot describe one photograph and generate another.
check(
  "the targeted slot gets its own scene",
  sceneForSlot('["infrared","hbot"]', "infrared", 2) === "hbot",
);
check(
  "slot 1 still gets slot 1's",
  sceneForSlot('["infrared","hbot"]', "infrared", 1) === "infrared",
);
check(
  "a slide with only slot 1's scene falls back to it for slot 2",
  sceneForSlot(null, "a quiet treatment room", 2) === "a quiet treatment room",
);
check(
  "a slot the list leaves blank falls back to slot 1 rather than briefing with nothing",
  sceneForSlot('["infrared",""]', "infrared", 2) === "infrared",
);
check(
  "a slide with no scene at all resolves to nothing, so the caller reaches for the slide's copy",
  sceneForSlot(null, null, 1) === "",
);

console.log(`\nphotoScenes: ${passed} checks passed`);
