// Run: npm test -- src/lib/workoutLogModel.test.ts
//
// The set maths behind the member's workout log: what a ticked blank set
// fills in with, which set counts as the best, and when a lift is a new best.
import assert from "node:assert/strict";

import {
  bestSet,
  completeSet,
  exerciseKey,
  formatSet,
  parseReps,
  parseWeight,
  personalBests,
  setsDone,
  targetRepsNumber,
  volumeKg,
} from "./workoutLogModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

check("library exercise keys by id", exerciseKey(12, "Back Squat") === "lib:12");
check("typed exercise keys by tidy name", exerciseKey(null, "  Back   SQUAT ") === "name:back squat");

check("weight takes a comma", parseWeight("62,5") === 62.5);
check("weight rounds to 0.25", parseWeight("61.3") === 61.25);
check("blank weight is null", parseWeight("  ") === null);
check("negative weight is null", parseWeight("-5") === null);
check("reps must be whole", parseReps("8.5") === null && parseReps("8") === 8 && parseReps("0") === null);

check("target 8-10 prefills 8", targetRepsNumber("8-10") === 8);
check("target AMRAP has no number", targetRepsNumber("AMRAP") === null);
check("timed target is not reps", targetRepsNumber("30-45 seconds") === null && targetRepsNumber("5 minutes") === null);
check("10 reps each side is reps", targetRepsNumber("10 reps each side") === 10);

const prev = { weightKg: 60, reps: 8, done: true };
const filled = completeSet({ weightKg: null, reps: null }, prev, { weightKg: 50, reps: 12 }, "10");
check("blank set fills from last time", filled.done && filled.weightKg === 60 && filled.reps === 8);
const typed = completeSet({ weightKg: 70, reps: null }, prev, undefined, "10");
check("typed weight is kept", typed.weightKg === 70 && typed.reps === 8);
const first = completeSet({ weightKg: null, reps: null }, undefined, undefined, "8-10");
check("first set ever fills target reps only", first.weightKg === null && first.reps === 8);
const second = completeSet({ weightKg: null, reps: null }, undefined, { weightKg: 60, reps: 8 }, "8-10");
check("first time, set 2 carries the set above", second.weightKg === 60 && second.reps === 8);

const sets = [
  { weightKg: 100, reps: 1, done: true },
  { weightKg: 90, reps: 5, done: true },
  { weightKg: 120, reps: 3, done: false },
];
const b = bestSet(sets);
check("best set is by estimated max, unticked ignored", b !== null && b.weightKg === 90 && b.reps === 5);
check("no weighted sets, no best", bestSet([{ weightKg: null, reps: 10, done: true }]) === null);

check("volume counts ticked sets only", volumeKg([{ sets }]) === 100 + 450);
const count = setsDone([{ sets }]);
check("sets done counts ticks", count.done === 2 && count.total === 3);

check("formatSet weight x reps", formatSet({ weightKg: 62.5, reps: 8 }) === "62.5 kg x 8");
check("formatSet bodyweight", formatSet({ weightKg: null, reps: 12 }) === "12 reps");

const pbs = personalBests(
  [
    { exerciseKey: "lib:1", name: "Squat", sets: [{ weightKg: 100, reps: 5, done: true }] },
    { exerciseKey: "lib:2", name: "Bench", sets: [{ weightKg: 60, reps: 5, done: true }] },
    { exerciseKey: "lib:3", name: "Row", sets: [{ weightKg: 50, reps: 10, done: true }] },
  ],
  { "lib:1": 110, "lib:2": 80 },
);
check("only beaten bests count, first-ever lifts do not", pbs.length === 1 && pbs[0].name === "Squat");

console.log(`workoutLogModel: ${passed} checks passed`);
