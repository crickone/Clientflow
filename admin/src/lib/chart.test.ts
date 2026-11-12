// Run: npm test -- src/lib/chart.test.ts
import assert from "node:assert/strict";

import { niceRange, niceTicks, scale, scaleDomain } from "./chart";

assert.deepEqual(niceTicks(0), [0]);
assert.deepEqual(niceTicks(7), [0, 2, 4, 6, 8]);
assert.deepEqual(niceTicks(950), [0, 250, 500, 750, 1000]);
assert.deepEqual(niceTicks(12000, 3), [0, 5000, 10000, 15000]);
const s = scale(100, 200);
assert.equal(s(0), 0);
assert.equal(s(50), 100);
assert.equal(scale(0, 200)(5), 0, "a zero domain draws flat, never NaN");

// Negative and mixed ranges
const mixed = niceRange(-50, 120);
assert.ok(mixed.includes(0), "ticks include zero");
assert.ok(mixed[0] <= -50 && mixed[mixed.length - 1] >= 120, "ticks span both ends");
assert.deepEqual(mixed, [-50, 0, 50, 100, 150]);
const neg = niceRange(-300, -20);
assert.ok(neg.includes(0) && neg[0] <= -300, "all-negative range still reaches zero");
assert.deepEqual(niceRange(0, 7), niceTicks(7));

// Odd input
assert.deepEqual(niceRange(NaN, 10), [0]);
assert.deepEqual(niceRange(0, Infinity), [0]);
assert.deepEqual(niceRange(-Infinity, 5), [0]);
assert.deepEqual(niceTicks(NaN), [0]);
assert.deepEqual(niceTicks(Infinity), [0]);
assert.deepEqual(scale(NaN, 100)(5), 0);

// Tiny ranges never duplicate ticks
for (const max of [0.0001, 0.0004, 1e-7]) {
  const t = niceTicks(max);
  assert.equal(new Set(t).size, t.length, `no duplicates for ${max}`);
}

// Negative domain scale
const d = scaleDomain(-50, 150, 200);
assert.equal(d(-50), 0);
assert.equal(d(0), 50);
assert.equal(d(150), 200);
assert.equal(scaleDomain(0, 0, 100)(3), 0);
console.log("chart.test.ts: ok");
