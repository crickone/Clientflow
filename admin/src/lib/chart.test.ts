// Run: npm test -- src/lib/chart.test.ts
import assert from "node:assert/strict";

import { niceTicks, scale } from "./chart";

assert.deepEqual(niceTicks(0), [0]);
assert.deepEqual(niceTicks(7), [0, 2, 4, 6, 8]);
assert.deepEqual(niceTicks(950), [0, 250, 500, 750, 1000]);
assert.deepEqual(niceTicks(12000, 3), [0, 5000, 10000, 15000]);
const s = scale(100, 200);
assert.equal(s(0), 0);
assert.equal(s(50), 100);
assert.equal(scale(0, 200)(5), 0, "a zero domain draws flat, never NaN");
console.log("chart.test.ts: ok");
