// Run: npm test -- src/lib/video/rotation.test.ts
//
// The video rotation convention, pinned. This shipped INVERTED and unnoticed
// because nothing covered it: ffprobe's side_data rotation is counter-clockwise
// but the code fed it straight into a clockwise mapping, so every phone-shot
// clip rendered 180 degrees from upright.
//
// THE ONE CONVENTION, app-wide: `rotation` is the CLOCKWISE degrees needed to
// bring the STORED raster upright. Everything speaks it — transposeFor() in
// render.ts, the AI orientation detector, the operator's rotate buttons, and
// the preview's CSS transform.
//
// The two metadata sources use OPPOSITE conventions and must not share a path:
//   - side_data_list[].rotation = av_display_rotation_get(), COUNTER-clockwise,
//     so it must be NEGATED (ffmpeg's own autorotate does theta = -rotation).
//   - tags.rotate (legacy containers) is already that negated value: used as-is.
import assert from "node:assert/strict";

import { normaliseRotation } from "./ffmpeg";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

// ── The canonical case: an iPhone portrait clip ────────────────────────────
// Stored 1920x1080 landscape with a display matrix giving side_data -90.
// ffmpeg computes theta = -(-90) = 90 and inserts transpose=1 (clockwise) to
// bring it upright. So after negation we must land on 90 — NOT 270.
assert.strictEqual(
  normaliseRotation(-(-90)),
  90,
  "side_data -90 (iPhone portrait), negated, must be 90 => transpose=1 clockwise",
);
passed++;
ok(
  "the un-negated value is the WRONG answer (the bug that shipped)",
  normaliseRotation(-90) === 270,
);

// The mirror case: side_data +90 negates to 270 => transpose=2 (ccw).
assert.strictEqual(normaliseRotation(-90), 270, "side_data +90, negated, is 270");
passed++;

// 180 is its own inverse either way.
assert.strictEqual(normaliseRotation(-180), 180, "180 negates to 180");
passed++;
assert.strictEqual(normaliseRotation(180), 180, "180 stays 180");
passed++;

// ── Legacy tags.rotate is used AS-IS (already negated) ─────────────────────
assert.strictEqual(normaliseRotation(90), 90, "tags.rotate 90 stays 90 (no negation)");
passed++;
assert.strictEqual(normaliseRotation(270), 270, "tags.rotate 270 stays 270");
passed++;

// ── Normalisation basics ───────────────────────────────────────────────────
assert.strictEqual(normaliseRotation(0), 0, "zero is zero");
passed++;
assert.strictEqual(normaliseRotation(360), 0, "360 wraps to 0");
passed++;
assert.strictEqual(normaliseRotation(-360), 0, "-360 wraps to 0");
passed++;
assert.strictEqual(normaliseRotation(450), 90, "450 wraps to 90");
passed++;
// Near-quarter values from float math snap to the nearest quarter turn.
assert.strictEqual(normaliseRotation(89.6), 90, "89.6 snaps to 90");
passed++;
assert.strictEqual(normaliseRotation(-89.6), 270, "-89.6 snaps to 270");
passed++;
// Non-finite input must not produce NaN downstream (it would break the filter).
assert.strictEqual(normaliseRotation(NaN), 0, "NaN degrades to 0");
passed++;
assert.strictEqual(normaliseRotation(Infinity), 0, "Infinity degrades to 0");
passed++;

// ── Every output is a legal transpose input ────────────────────────────────
for (const raw of [-450, -270, -180, -90, 0, 90, 180, 270, 450, 720]) {
  const r = normaliseRotation(raw);
  ok(`normaliseRotation(${raw}) = ${r} is one of 0/90/180/270`, [0, 90, 180, 270].includes(r));
}

console.log(`rotation.test.ts: all ${passed} assertions passed`);
