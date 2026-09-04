// Run: npm test -- src/lib/video/orientation.test.ts
//
// `mayBeShotSideways` is the gate in front of a METERED vision call: it decides
// which uploads are worth asking a model about. Getting it wrong either burns
// AI spend on clips that obviously don't need it, or misses the case it exists
// for — footage shot with the camera physically turned (e.g. a Sony A6400 on
// its side), which lands as a genuinely LANDSCAPE file with NO rotation flag.
//
// The rule: only landscape clips that carry no rotation metadata are ambiguous.
// A file that already declares a rotation (phones do this) is trusted as-is,
// and portrait/square footage is already the right way up for a reel.
import assert from "node:assert/strict";

import { mayBeShotSideways } from "./orientation";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

// The case this feature exists for: 1920x1080 with no rotation flag.
ok(
  "landscape with no rotation flag is ambiguous (the A6400-on-its-side case)",
  mayBeShotSideways({ width: 1920, height: 1080, rotation: 0 }) === true,
);

// Phone-shot portrait: stored landscape but the file TELLS us it's rotated.
// probe() already reads that and the renderer transposes it, so there is
// nothing to ask about — and no reason to spend a metered call.
ok(
  "landscape WITH a rotation flag is trusted, not re-detected",
  mayBeShotSideways({ width: 1920, height: 1080, rotation: 90 }) === false,
);
ok(
  "rotation 270 is likewise trusted",
  mayBeShotSideways({ width: 1920, height: 1080, rotation: 270 }) === false,
);

// Already portrait / square — upright for a reel, nothing ambiguous.
ok(
  "portrait footage is not flagged",
  mayBeShotSideways({ width: 1080, height: 1920, rotation: 0 }) === false,
);
ok(
  "square footage is not flagged",
  mayBeShotSideways({ width: 1080, height: 1080, rotation: 0 }) === false,
);

// Probe failures leave width/height null — never guess (and never spend) on
// a clip we couldn't measure.
ok(
  "null dimensions are not flagged",
  mayBeShotSideways({ width: null, height: null, rotation: 0 }) === false,
);
ok(
  "half-known dimensions are not flagged",
  mayBeShotSideways({ width: 1920, height: null, rotation: 0 }) === false,
);

console.log(`orientation.test.ts: all ${passed} assertions passed`);
