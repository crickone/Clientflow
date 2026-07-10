/**
 * Unit tests for the timeline geometry (segment mapping + caption remap).
 * Pure logic, no I/O. Run: npx tsx src/lib/video/timeline.test.ts
 */
import assert from "node:assert/strict";

import {
  addBroll,
  deleteSegment,
  fullClipSegment,
  layoutSegments,
  mapOutputToSource,
  mapSourceToOutput,
  outputDuration,
  parseTimeline,
  remapWordsThroughSegments,
  remapBrollSourceToOutput,
  removeBroll,
  reorderSegment,
  segmentLength,
  splitSegment,
  trimSegment,
  updateBroll,
  type MainSegment,
  type TimelineDoc,
} from "./timeline";

let n = 0;
function check(name: string, fn: () => void) {
  fn();
  n++;
  console.log(`  ✓ ${name}`);
}

const approx = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

// ── duration math ────────────────────────────────────────────────────────
check("segmentLength + outputDuration", () => {
  const segs: MainSegment[] = [
    { sourceStart: 0, sourceEnd: 2 },
    { sourceStart: 4, sourceEnd: 6 },
  ];
  approx(segmentLength(segs[0]), 2);
  approx(outputDuration(segs), 4);
  approx(outputDuration([]), 0);
});

check("layoutSegments stacks outputStart cumulatively", () => {
  const laid = layoutSegments([
    { sourceStart: 0, sourceEnd: 3 },
    { sourceStart: 10, sourceEnd: 11 },
  ]);
  approx(laid[0].outputStart, 0);
  approx(laid[1].outputStart, 3);
  approx(laid[1].length, 1);
});

// ── output → source ──────────────────────────────────────────────────────
check("mapOutputToSource basic (deleted middle)", () => {
  const segs: MainSegment[] = [
    { sourceStart: 0, sourceEnd: 2 },
    { sourceStart: 4, sourceEnd: 6 },
  ];
  const a = mapOutputToSource(segs, 0.5)!;
  assert.equal(a.segmentIndex, 0);
  approx(a.sourceTime, 0.5);
  const b = mapOutputToSource(segs, 2.5)!; // 0.5s into 2nd segment
  assert.equal(b.segmentIndex, 1);
  approx(b.sourceTime, 4.5);
});

check("mapOutputToSource handles reordered segments", () => {
  const segs: MainSegment[] = [
    { sourceStart: 4, sourceEnd: 6 },
    { sourceStart: 0, sourceEnd: 2 },
  ];
  approx(mapOutputToSource(segs, 0.5)!.sourceTime, 4.5);
  approx(mapOutputToSource(segs, 2.5)!.sourceTime, 0.5);
});

check("mapOutputToSource clamps + resolves trailing edge", () => {
  const segs: MainSegment[] = [
    { sourceStart: 0, sourceEnd: 2 },
    { sourceStart: 4, sourceEnd: 6 },
  ];
  const end = mapOutputToSource(segs, 4)!; // == total
  assert.equal(end.segmentIndex, 1);
  approx(end.sourceTime, 6);
  const over = mapOutputToSource(segs, 99)!;
  approx(over.sourceTime, 6);
  assert.equal(mapOutputToSource([], 1), null);
});

// ── source → output ──────────────────────────────────────────────────────
check("mapSourceToOutput maps + returns null in cut regions", () => {
  const segs: MainSegment[] = [
    { sourceStart: 0, sourceEnd: 2 },
    { sourceStart: 4, sourceEnd: 6 },
  ];
  approx(mapSourceToOutput(segs, 4.5)!, 2.5);
  assert.equal(mapSourceToOutput(segs, 3), null); // cut-out region
});

// ── caption remap ────────────────────────────────────────────────────────
check("remapWordsThroughSegments drops cut words + retimes kept ones", () => {
  const words = [
    { word: "a", start: 0, end: 1 },
    { word: "b", start: 2, end: 3 }, // midpoint 2.5 → cut out
    { word: "c", start: 4, end: 5 },
  ];
  const segs: MainSegment[] = [
    { sourceStart: 0, sourceEnd: 2 },
    { sourceStart: 4, sourceEnd: 6 },
  ];
  const out = remapWordsThroughSegments(words, segs);
  assert.deepEqual(
    out.map((w) => w.word),
    ["a", "c"],
  );
  approx(out[0].start, 0);
  approx(out[1].start, 2); // c starts at the join
});

check("remapWordsThroughSegments carries words across a reorder", () => {
  const words = [
    { word: "a", start: 0, end: 1 },
    { word: "c", start: 4, end: 5 },
  ];
  const segs: MainSegment[] = [
    { sourceStart: 4, sourceEnd: 6 }, // c's segment first now
    { sourceStart: 0, sourceEnd: 2 },
  ];
  const out = remapWordsThroughSegments(words, segs);
  assert.deepEqual(
    out.map((w) => w.word),
    ["c", "a"],
  );
  approx(out[0].start, 0);
  approx(out[1].start, 2);
});

check("remapWordsThroughSegments floors zero-length words", () => {
  const words = [{ word: "x", start: 1, end: 1 }];
  const segs: MainSegment[] = [{ sourceStart: 0, sourceEnd: 3 }];
  const out = remapWordsThroughSegments(words, segs);
  assert.ok(out[0].end - out[0].start >= 0.1, "word floored to readable length");
});

// ── helpers ──────────────────────────────────────────────────────────────
check("fullClipSegment + parseTimeline", () => {
  approx(fullClipSegment(12.5).sourceEnd, 12.5);
  assert.equal(parseTimeline(null), null);
  assert.equal(parseTimeline("not json"), null);
  assert.equal(parseTimeline('{"mainSegments":[]}'), null); // missing brollInserts
  const ok = parseTimeline('{"mainSegments":[],"brollInserts":[]}');
  assert.ok(ok && Array.isArray(ok.mainSegments));
});

// ── edit operations ──────────────────────────────────────────────────────
const oneSeg = (): TimelineDoc => ({
  mainSegments: [{ sourceStart: 0, sourceEnd: 30 }],
  brollInserts: [{ startSec: 2, endSec: 5, brollAssetId: 7, brollStartSec: 0 }],
});

check("splitSegment splits under the playhead, total unchanged", () => {
  const d = splitSegment(oneSeg(), 10);
  assert.equal(d.mainSegments.length, 2);
  approx(d.mainSegments[0].sourceEnd, 10);
  approx(d.mainSegments[1].sourceStart, 10);
  approx(outputDuration(d.mainSegments), 30); // split doesn't change length
});

check("splitSegment ignores split at the very edges", () => {
  assert.equal(splitSegment(oneSeg(), 0).mainSegments.length, 1);
  assert.equal(splitSegment(oneSeg(), 30).mainSegments.length, 1);
});

check("deleteSegment closes the gap + clamps b-roll; never deletes last", () => {
  const split = splitSegment(oneSeg(), 4); // [0,4][4,30], total 30
  const del = deleteSegment(split, 0); // remove [0,4] → total 26
  assert.equal(del.mainSegments.length, 1);
  approx(outputDuration(del.mainSegments), 26);
  assert.equal(deleteSegment(oneSeg(), 0).mainSegments.length, 1); // last kept
});

check("deleteSegment drops b-roll that falls past the new total", () => {
  // two segments each 5s long (total 10), b-roll at 8-9 survives; delete one → total 5 → dropped
  const doc: TimelineDoc = {
    mainSegments: [
      { sourceStart: 0, sourceEnd: 5 },
      { sourceStart: 10, sourceEnd: 15 },
    ],
    brollInserts: [{ startSec: 8, endSec: 9, brollAssetId: 7 }],
  };
  const del = deleteSegment(doc, 1); // total 5
  assert.equal(del.brollInserts.length, 0);
});

check("reorderSegment moves a segment", () => {
  const split = splitSegment(oneSeg(), 10); // [0,10][10,30]
  const r = reorderSegment(split, 1, 0); // [10,30][0,10]
  approx(r.mainSegments[0].sourceStart, 10);
  approx(r.mainSegments[1].sourceStart, 0);
  approx(outputDuration(r.mainSegments), 30);
});

check("trimSegment clamps to [0, maxSource] + min length", () => {
  const t = trimSegment(oneSeg(), 0, -5, 100, 40); // clamp to 0..40
  approx(t.mainSegments[0].sourceStart, 0);
  approx(t.mainSegments[0].sourceEnd, 40);
  const collapsed = trimSegment(oneSeg(), 0, 20, 20.05, 40); // too short → min length
  assert.ok(
    collapsed.mainSegments[0].sourceEnd - collapsed.mainSegments[0].sourceStart >= 0.19,
  );
});

check("addBroll / updateBroll / removeBroll", () => {
  let d = oneSeg();
  d = addBroll(d, { startSec: 12, endSec: 15, brollAssetId: 9 });
  assert.equal(d.brollInserts.length, 2);
  assert.ok(d.brollInserts[0].startSec <= d.brollInserts[1].startSec); // sorted
  d = updateBroll(d, 0, { brollStartSec: 1.5 });
  approx(d.brollInserts[0].brollStartSec ?? 0, 1.5);
  d = removeBroll(d, 0);
  assert.equal(d.brollInserts.length, 1);
});

check("remapBrollSourceToOutput maps plan coords + drops cut-region inserts", () => {
  // segments delete 8-15 of a 30s clip: [0,8] then [15,30] → total 23
  const segs: MainSegment[] = [
    { sourceStart: 0, sourceEnd: 8 },
    { sourceStart: 15, sourceEnd: 30 },
  ];
  const plan = [
    { startSec: 2, endSec: 5, brollAssetId: 1 }, // in first kept range → output 2-5
    { startSec: 10, endSec: 12, brollAssetId: 2 }, // inside the cut → dropped
    { startSec: 20, endSec: 23, brollAssetId: 3 }, // second range → output 13-16
  ];
  const mapped = remapBrollSourceToOutput(plan, segs);
  assert.equal(mapped.length, 2);
  approx(mapped[0].startSec, 2);
  approx(mapped[1].startSec, 8 + (20 - 15)); // 13
});

console.log(`\n${n} timeline checks passed.`);
