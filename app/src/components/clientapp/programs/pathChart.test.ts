// app/src/components/clientapp/programs/pathChart.test.ts
// Run: npx tsx src/components/clientapp/programs/pathChart.test.ts
//
// The geometry behind the training-max path chart: pure, so the shape of the
// two lines is pinned here rather than by eye.
import assert from "node:assert/strict";
import { pathGeometry } from "./pathGeometry";

const W = 260;
const H = 120;
const chart = {
  lift: "squat" as const,
  label: "Squat",
  soFar: [
    { week: 1, kg: 100 },
    { week: 5, kg: 105 },
  ],
  planned: [
    { week: 5, kg: 105 },
    { week: 9, kg: 110 },
    { week: 12, kg: 110 },
  ],
  nowKg: 105,
  endKg: 110,
};

const pts = (s: string) => s.split(" ").map((p) => p.split(",").map(Number) as [number, number]);

const g = pathGeometry(chart, 12, W, H);
assert.equal(g.yMin <= 100 && g.yMax >= 110, true, "the y range covers both lines");

// So far is a step line: 100 held from week 1 to week 5, then up to 105 at week 5. Three points.
const sf = pts(g.soFar);
assert.equal(sf.length, 3, "step line: the start, the hold to the change, the rise");
assert.equal(sf[0][1], sf[1][1], "the value is held flat until the week it changes");
assert.equal(sf[1][0], sf[2][0], "the rise is vertical, in the week of the change");
assert.ok(sf[2][1] < sf[1][1], "a higher weight is higher up the chart (smaller y)");

// Planned: 105 held to week 9, up to 110, held to week 12. Four points (the last hold adds none to a flat value).
const pl = pts(g.planned);
assert.equal(pl.length, 4);
assert.equal(pl[0][0], sf[2][0], "the dashed line starts where the solid line ends");
assert.equal(pl[0][1], sf[2][1]);

// The x axis spans every week of the program, not the last planned point.
const inside = (n: number) => n >= 0 && n <= W;
assert.ok(pts(g.soFar).concat(pl).every(([x, y]) => inside(x) && y >= 0 && y <= H), "every point sits inside the viewBox");
const short = pathGeometry({ ...chart, planned: [{ week: 5, kg: 105 }, { week: 9, kg: 110 }] }, 12, W, H);
const shortPl = pts(short.planned);
assert.ok(shortPl[shortPl.length - 1][0] < pl[pl.length - 1][0], "a plan that ends early stops early; the axis still runs to the last week");
assert.equal(pts(short.soFar)[0][0], sf[0][0], "week 1 is at the same place whatever the plan");

// Day one: one so-far point, the whole path planned.
const day1 = pathGeometry({ ...chart, soFar: [{ week: 1, kg: 100 }], planned: [{ week: 1, kg: 100 }, { week: 12, kg: 110 }], nowKg: 100 }, 12, W, H);
assert.equal(pts(day1.soFar).length, 1, "one point on day one");
assert.equal(pts(day1.planned).length, 3, "held to week 12, then up");
assert.ok(day1.yMin <= 100 && day1.yMax >= 110);

// A flat line still gets a range to sit in.
const flat = pathGeometry({ ...chart, soFar: [{ week: 1, kg: 100 }], planned: [{ week: 1, kg: 100 }], nowKg: 100, endKg: 100 }, 12, W, H);
assert.ok(flat.yMax > flat.yMin, "a flat line has a non-empty range");

// One-week programs do not divide by zero.
const one = pathGeometry({ ...chart, soFar: [{ week: 1, kg: 100 }], planned: [{ week: 1, kg: 100 }] }, 1, W, H);
assert.ok(!/NaN|Infinity/.test(one.soFar + one.planned));

// A later round: the x axis starts at the round's first week, so a restarted block has no empty left half.
const round2 = pathGeometry({ ...chart, soFar: [{ week: 5, kg: 100 }, { week: 7, kg: 105 }], planned: [{ week: 7, kg: 105 }, { week: 8, kg: 110 }] }, 8, W, H, 5);
const r2 = pts(round2.soFar);
assert.equal(r2[0][0], 10, "the first week of the round is at the left edge (PAD.left)");
assert.equal(pts(round2.planned).at(-1)![0], 250, "and the last week at the right edge");
const wrong = pathGeometry({ ...chart, soFar: [{ week: 5, kg: 100 }, { week: 7, kg: 105 }], planned: [{ week: 7, kg: 105 }, { week: 8, kg: 110 }] }, 8, W, H);
assert.ok(pts(wrong.soFar)[0][0] > 100, "counted from week 1 the same line would start in the middle of the chart");

console.log("programs/pathChart: ok");
