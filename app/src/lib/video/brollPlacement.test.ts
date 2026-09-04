// Run: npm test -- src/lib/video/brollPlacement.test.ts
//
// findFreeBrollStart decides where the NEXT cutaway lands.
//
// THE BUG THIS PINS: adding several cutaways without moving the playhead put
// every one at the same instant. clampBroll keeps overlaps, so they stacked
// invisibly on top of each other and the tray looked like it only accepted one
// clip. Placement must walk past whatever is already there.
import assert from "node:assert/strict";

import { findFreeBrollStart, type TimelineDoc } from "./timeline";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const doc = (spans: Array<[number, number]>): TimelineDoc => ({
  mainSegments: [{ sourceStart: 0, sourceEnd: 60 }],
  brollInserts: spans.map(([startSec, endSec], i) => ({
    startSec,
    endSec,
    brollAssetId: i + 1,
    brollStartSec: 0,
  })),
});

const TOTAL = 60;

// Empty timeline: lands exactly on the playhead.
assert.strictEqual(findFreeBrollStart(doc([]), 10, 3, TOTAL), 10, "empty timeline uses the playhead");
passed++;

// THE REGRESSION: the playhead is occupied, so the next one goes after it —
// not on top of it.
assert.strictEqual(
  findFreeBrollStart(doc([[10, 13]]), 10, 3, TOTAL),
  13,
  "an occupied playhead pushes the next cutaway to just after it",
);
passed++;

// And a third walks past both, so repeated clicks keep laying them end to end.
assert.strictEqual(
  findFreeBrollStart(doc([[10, 13], [13, 16]]), 10, 3, TOTAL),
  16,
  "a third cutaway walks past both",
);
passed++;

// A gap big enough between two inserts is used rather than skipping to the end.
assert.strictEqual(
  findFreeBrollStart(doc([[0, 5], [20, 25]]), 5, 3, TOTAL),
  5,
  "a gap between inserts is used",
);
passed++;

// Playhead sits inside an insert, and the gap after it is too small — keep going.
assert.strictEqual(
  findFreeBrollStart(doc([[10, 13], [14, 20]]), 11, 3, TOTAL),
  20,
  "a gap too small to fit is skipped",
);
passed++;

// A playhead near the end still places, clamped so the clip fits inside.
assert.strictEqual(
  findFreeBrollStart(doc([[30, 33]]), 59, 3, TOTAL),
  57,
  "a playhead past the last possible start is clamped so the clip still fits",
);
passed++;

// Genuinely no room AFTER the playhead (the tail is occupied) → falls back to
// the first gap anywhere rather than giving up.
assert.strictEqual(
  findFreeBrollStart(doc([[57, 60]]), 59, 3, TOTAL),
  0,
  "no room after the playhead falls back to the first gap",
);
passed++;

// Genuinely full → null, so the caller can SAY so instead of silently stacking.
ok(
  "a full timeline returns null",
  findFreeBrollStart(doc([[0, 60]]), 0, 3, TOTAL) === null,
);
// A clip longer than the whole timeline can't be placed.
ok("a clip longer than the timeline returns null", findFreeBrollStart(doc([]), 0, 90, TOTAL) === null);
ok("zero length returns null", findFreeBrollStart(doc([]), 0, 0, TOTAL) === null);

// Never returns a slot that overlaps an existing insert.
{
  const d = doc([[5, 10], [20, 24], [40, 47]]);
  for (const playhead of [0, 6, 12, 21, 30, 44, 55]) {
    const start = findFreeBrollStart(d, playhead, 3, TOTAL);
    if (start === null) continue;
    const overlaps = d.brollInserts.some(
      (b) => start < b.endSec - 1e-6 && start + 3 > b.startSec + 1e-6,
    );
    ok(`playhead ${playhead} yields a non-overlapping slot (${start})`, !overlaps);
    ok(`playhead ${playhead} stays inside the timeline`, start >= 0 && start + 3 <= TOTAL + 1e-6);
  }
}

console.log(`brollPlacement.test.ts: all ${passed} assertions passed`);
