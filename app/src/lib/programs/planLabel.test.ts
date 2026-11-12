// app/src/lib/programs/planLabel.test.ts
// Run: npm test -- src/lib/programs/planLabel.test.ts
import assert from "node:assert/strict";

import { planSetLabel } from "./planner";
import type { PlannedSet } from "./types";

const base: Omit<PlannedSet, "kg" | "reps"> = { repsMax: null, amrap: false, rpe: null, pct: null, rest: 90, drives: false };
assert.equal(planSetLabel({ ...base, kg: 102.5, reps: 9 }, "kg"), "102.5 x 9");
assert.equal(planSetLabel({ ...base, kg: 70, reps: 5, amrap: true }, "kg"), "70 x 5+");
assert.equal(planSetLabel({ ...base, kg: 140, reps: 3, rpe: 8 }, "kg"), "RPE 8, 140");
assert.equal(planSetLabel({ ...base, kg: null, reps: 1, rpe: 10 }, "kg"), "RPE 10");
assert.equal(planSetLabel({ ...base, kg: null, reps: 8, repsMax: 12 }, "kg"), "8-12 reps");
assert.equal(planSetLabel({ ...base, kg: 102.058, reps: 5 }, "lb"), "225 x 5");
console.log("programs/planLabel: ok");
