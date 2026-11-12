// app/src/lib/programs/editing.test.ts
// Run: npm test -- src/lib/programs/editing.test.ts
import assert from "node:assert/strict";

import { fixed, pct, range } from "./dsl";
import { blankExercise, convertSet, repsMax, repsMin, withReps } from "./editing";
import { platformProgram } from "./registry";
import { validateTemplate } from "./validate";

assert.deepEqual(convertSet(pct(0.7, 5, 180), "rpe"), { kind: "rpe", rpe: 8, reps: 5, rest: 180 });
assert.deepEqual(convertSet(fixed(range(8, 12), 90), "pct"), { kind: "pct", pct: 0.7, reps: 8, rest: 90 });
assert.deepEqual(convertSet({ kind: "amrap", pct: 0.85, reps: 5, rest: 180 }, "pct"), { kind: "pct", pct: 0.85, reps: 5, rest: 180 });
assert.deepEqual(convertSet(pct(0.8, 3, 120), "fixed"), { kind: "fixed", reps: 3, rest: 120 });
assert.deepEqual(convertSet(fixed(range(8, 12), 90), "same_as_last"), { kind: "same_as_last", reps: { min: 8, max: 12 }, rest: 90 });

assert.equal(repsMin(range(8, 12)), 8);
assert.equal(repsMax(range(8, 12)), 12);
assert.equal(repsMax(5), null);
assert.deepEqual(withReps(8, 12), { min: 8, max: 12 });
assert.equal(withReps(8, null), 8);
assert.equal(withReps(8, 6), 8, "a top below the bottom is dropped");

assert.equal(blankExercise().name, "Back squat");

// an edited Smolov still passes the template check
const t = structuredClone(platformProgram("smolov-base")!);
t.name = "Our Smolov";
t.weeks[0].days[0].exercises[0].sets = t.weeks[0].days[0].exercises[0].sets.map((s) => convertSet(s, "amrap"));
t.weeks[0].days.push({ name: "Day 5", exercises: [{ ...blankExercise(), lift: "squat", sets: [pct(0.6, 5, 120)] }] });
assert.ok(validateTemplate(t).ok);

console.log("programs/editing: ok");
