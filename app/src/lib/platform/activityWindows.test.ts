import assert from "node:assert/strict";

import { weekWindows } from "./activity";

const now = Date.UTC(2026, 10, 21, 12, 0, 0);
const w = weekWindows(now);
assert.equal(w.end, now);
assert.equal(w.thisStart, now - 7 * 86400000);
assert.equal(w.prevStart, now - 14 * 86400000);
console.log("activityWindows: ok");
