// app/src/lib/programs/templates/beginner.test.ts
// Run: npm test -- src/lib/programs/templates/beginner.test.ts
import assert from "node:assert/strict";

import { platformProgram } from "../registry";
import { line, perfect, planAt, simulate, type Performer } from "../simulate";

// StrongLifts 5x5
const sl = platformProgram("stronglifts-5x5")!;
const slMaxes = { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 };
const a = planAt(sl, slMaxes, 0, 0);
assert.equal(a.dayName, "Workout A");
assert.deepEqual(a.exercises.map((e) => line(e)), ["Back squat 5 x 5 at 50 kg", "Bench press 5 x 5 at 40 kg", "Barbell row 5 x 5 at 35 kg"]);
const b = planAt(sl, slMaxes, 0, 1);
assert.deepEqual(b.exercises.map((e) => line(e)), ["Back squat 5 x 5 at 50 kg", "Overhead press 5 x 5 at 25 kg", "Deadlift 1 x 5 at 60 kg"]);
assert.deepEqual(sl.weeks.map((w) => w.days.map((d) => d.name)), [["Workout A", "Workout B", "Workout A"], ["Workout B", "Workout A", "Workout B"]]);

// 12 weeks, every rep: squat every session (36 x 2.5), deadlift on the 18 B days (x 5)
const slRun = simulate(sl, { maxes: slMaxes });
assert.equal(slRun.sessions.length, 36);
assert.equal(slRun.final.weights["back squat"], 140);
assert.equal(slRun.final.weights["deadlift"], 150);
assert.equal(slRun.final.weights["bench press"], 85);
assert.equal(slRun.final.weights["overhead press"], 70);

// three missed squat sessions in a row: a 10% deload
const squatMisses: Performer = (c) => {
  const p = perfect(c);
  return c.exercise.name === "Back squat" && c.n >= 3 && c.setIndex === 4 ? { ...p, reps: 3 } : p;
};
const slMiss = simulate(sl, { maxes: slMaxes, sessions: 6, performer: squatMisses });
assert.equal(slMiss.final.weights["back squat"], 52.5);
assert.ok(slMiss.reasons[5].includes("Next back squat 52.5 kg, 10% lighter. You missed reps three sessions in a row."));

// Starting Strength
const ss = platformProgram("starting-strength")!;
const ssMaxes = { squat: 100, press: 50, bench: 80, deadlift: 120 };
assert.deepEqual(planAt(ss, ssMaxes, 0, 0).exercises.map((e) => line(e)), ["Back squat 3 x 5 at 50 kg", "Overhead press 3 x 5 at 25 kg", "Deadlift 1 x 5 at 60 kg"]);
assert.deepEqual(planAt(ss, ssMaxes, 0, 1).exercises.map((e) => line(e)), ["Back squat 3 x 5 at 50 kg", "Bench press 3 x 5 at 40 kg", "Deadlift 1 x 5 at 60 kg"]);
const ssRun = simulate(ss, { maxes: ssMaxes });
assert.equal(ssRun.final.weights["back squat"], 140);
assert.equal(ssRun.final.weights["deadlift"], 240);

// Greyskull LP
const gs = platformProgram("greyskull-lp")!;
const gsMaxes = { bench: 80, row: 70, squat: 100, press: 50, deadlift: 120 };
assert.deepEqual(planAt(gs, gsMaxes, 0, 0).exercises.map((e) => line(e)), [
  "Bench press 2 x 5 at 40 kg, then 1 x 5+ at 40 kg",
  "Barbell row 2 x 5 at 35 kg, then 1 x 5+ at 35 kg",
  "Back squat 2 x 5 at 50 kg, then 1 x 5+ at 50 kg",
]);
assert.deepEqual(planAt(gs, gsMaxes, 0, 1).exercises.map((e) => line(e)), [
  "Overhead press 2 x 5 at 25 kg, then 1 x 5+ at 25 kg",
  "Chin-up 2 x 5, then 1 x 5+",
  "Deadlift 1 x 5+ at 60 kg",
]);
// with small plates: 1.25 kg on upper-body lifts, 2.5 kg on the squat
const gsOne = simulate(gs, { maxes: gsMaxes, sessions: 1, stepKg: 1.25 });
assert.equal(gsOne.final.weights["bench press"], 41.25);
assert.equal(gsOne.final.weights["back squat"], 52.5);

console.log("programs/templates/beginner: ok");
