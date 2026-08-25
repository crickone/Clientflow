// Run: npm test -- src/components/messaging/soundwaveLevels.test.ts
//
// Unit tests for the pure helper behind the recording soundwave
// (Soundwave.tsx) — downsampling a frequency byte array into normalized bar
// levels. Named `soundwaveLevels` (not `soundwave`) purely to avoid a
// filename collision with `Soundwave.tsx` on case-insensitive filesystems
// (macOS default) — TS module resolution breaks when two sibling files
// differ only in case. The component itself (AudioContext/AnalyserNode/
// canvas/rAF) is NOT covered here — same reasoning as voiceInput.test.ts: no
// headless browser-API harness in this repo; `npm run typecheck` +
// `npx next build` are the gate for it instead.
import assert from "node:assert/strict";

import { computeBarLevels, SOUNDWAVE_MIN_LEVEL } from "./soundwaveLevels";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// ════════════════════════════════════════════════════════════════════
// computeBarLevels
// ════════════════════════════════════════════════════════════════════
check("computeBarLevels: empty data -> []", computeBarLevels([], 32).length === 0);
check("computeBarLevels: barCount 0 -> []", computeBarLevels([1, 2, 3], 0).length === 0);
check("computeBarLevels: negative barCount -> []", computeBarLevels([1, 2, 3], -4).length === 0);

check("computeBarLevels: returns exactly barCount levels", computeBarLevels(new Array(128).fill(0), 32).length === 32);

check(
  "computeBarLevels: all-zero input floors every bar at minLevel",
  computeBarLevels(new Array(128).fill(0), 32).every((v) => v === SOUNDWAVE_MIN_LEVEL),
);

check(
  "computeBarLevels: all-max (255) input maxes every bar at 1",
  computeBarLevels(new Array(128).fill(255), 32).every((v) => v === 1),
);

check(
  "computeBarLevels: mid-value input normalizes to value/255 (above the floor)",
  computeBarLevels(new Array(64).fill(127.5), 8).every((v) => Math.abs(v - 127.5 / 255) < 1e-9),
);

check(
  "computeBarLevels: a custom minLevel floor is respected instead of the default",
  computeBarLevels(new Array(16).fill(0), 4, 0.2).every((v) => v === 0.2),
);

check(
  "computeBarLevels: every level is clamped within [minLevel, 1]",
  (() => {
    const data = Array.from({ length: 128 }, (_, i) => (i * 7) % 256);
    return computeBarLevels(data, 32).every((v) => v >= SOUNDWAVE_MIN_LEVEL && v <= 1);
  })(),
);

check(
  "computeBarLevels: distinguishes a loud region from a quiet one (not just uniform floor)",
  (() => {
    // First half silent, second half maxed — bars sampling only the back half read louder.
    const data = new Array(128).fill(0).map((_, i) => (i < 64 ? 0 : 255));
    const levels = computeBarLevels(data, 8);
    return levels[0] < levels[7];
  })(),
);

check(
  "computeBarLevels: barCount larger than data.length still returns barCount finite levels, no out-of-range reads",
  (() => {
    const levels = computeBarLevels([10, 200, 90], 10);
    return levels.length === 10 && levels.every((v) => Number.isFinite(v));
  })(),
);

check(
  "computeBarLevels: single bucket (barCount 1) averages the whole array",
  Math.abs(computeBarLevels([0, 255], 1)[0] - 255 / 2 / 255) < 1e-9,
);

console.log(`\nsoundwave: ${passed} checks passed.`);
