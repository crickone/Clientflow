// app/src/lib/programs/startFlow.test.ts
// Run: npm test -- src/lib/programs/startFlow.test.ts
//
// The start flow's state: going back keeps every entry, a unit switch carries
// typed weights over, the review's first week uses the entered maxes, the
// action gets the same payload as before, and each server error lands on
// the screen it belongs to.
import assert from "node:assert/strict";

import { firstWeek } from "./outline";
import { platformProgram } from "./registry";
import { initialStart, maxEntries, maxesKg, reduceStart, rowMaxKg, startSteps, stepForError, type StartAction, type StartLift, type StartState } from "./startFlow";
import { kgToUnit } from "./units";

const steps = startSteps(true);
assert.deepEqual(steps, ["weights", "maxes", "days", "review"]);
assert.deepEqual(startSteps(false), ["weights", "days", "review"], "no maxes screen when the program takes none");

const lifts: StartLift[] = [
  { lift: "squat", label: "Squat", logged: null },
  { lift: "bench", label: "Bench press", logged: { kg: 100, reps: 3, e1rm: 110 } },
];
const kept = (kg: number) => String(kgToUnit(kg, "kg"));
let s: StartState = initialStart({ lifts, unit: "kg", step: "2.5kg", weekdays: [1, 3, 5, 6], today: "2026-11-16" }, kept);
assert.equal(s.at, 0);
assert.deepEqual(s.rows.map((r) => r.mode), ["one_rm", "logged"], "a logged lift starts on its best logged set");
assert.equal(initialStart({ lifts, unit: "lb", step: "2.5kg", weekdays: [], today: "2026-11-16" }, kept).step, "5lb", "the jump follows the unit");
assert.equal(initialStart({ lifts: [{ ...lifts[0], keptKg: 140 }], unit: "kg", step: "2.5kg", weekdays: [], today: "2026-11-16" }, kept).rows[0].weight, "140", "a kept max is filled in");

const run = (state: StartState, ...actions: StartAction[]) => actions.reduce((x, a) => reduceStart(x, a, steps.length), state);

// ── forward, edit, back: everything is kept ──
s = run(s, { type: "step", step: "1.25kg" }, { type: "next" }, { type: "row", index: 0, patch: { weight: "140" } }, { type: "row", index: 1, patch: { mode: "set", weight: "90", reps: "5" } }, { type: "next" });
s = run(s, { type: "day", day: 3 }, { type: "startDate", value: "2026-11-18" }, { type: "next" });
assert.equal(s.at, 3, "on the review");
const before = JSON.stringify({ ...s, at: 0 });
s = run(s, { type: "back" }, { type: "back" }, { type: "back" }, { type: "back" });
assert.equal(s.at, 0, "back stops at the first screen");
assert.equal(JSON.stringify(s), before, "going back keeps every entry");
assert.equal(run(s, { type: "go", at: 9 }).at, 3, "go is clamped");
assert.equal(run(s, { type: "next" }, { type: "next" }, { type: "next" }, { type: "next" }).at, 3, "next stops at the review");
assert.deepEqual(s.days, [1, 5, 6], "a day toggles off");
assert.deepEqual(run(s, { type: "day", day: 2 }).days, [1, 2, 5, 6], "and on, in order");

// ── the maxes, as the server works them out ──
assert.equal(rowMaxKg(s.rows[0], lifts[0], "kg"), 140);
assert.equal(rowMaxKg(s.rows[1], lifts[1], "kg"), 105, "90 x 5 by Epley");
assert.equal(rowMaxKg({ mode: "set", weight: "90", reps: "12" }, lifts[1], "kg"), null, "more than 10 reps reads no max");
assert.equal(rowMaxKg({ mode: "logged", weight: "", reps: "" }, lifts[1], "kg"), 110);
assert.equal(rowMaxKg({ mode: "one_rm", weight: "", reps: "" }, lifts[0], "kg"), null);
assert.deepEqual(maxesKg(s, lifts), { squat: 140, bench: 105 });
assert.deepEqual(maxEntries(s, lifts), [
  { lift: "squat", kind: "one_rm", weight: 140, reps: null },
  { lift: "bench", kind: "set", weight: 90, reps: 5 },
]);

// ── a unit switch carries typed weights over and resets the jump ──
const lb = run(s, { type: "unit", unit: "lb" });
assert.equal(lb.unit, "lb");
assert.equal(lb.step, "5lb");
assert.equal(lb.rows[0].weight, "308.6");
assert.equal(run(lb, { type: "unit", unit: "kg" }).rows[0].weight, "140");
assert.equal(run(s, { type: "unit", unit: "kg" }), s, "the same unit changes nothing");

// ── the review's first week uses the entered max ──
const smolov = platformProgram("smolov-base")!;
const sm: StartLift[] = [{ lift: "squat", label: "Squat", logged: null }];
let ss = initialStart({ lifts: sm, unit: "kg", step: "2.5kg", weekdays: [1, 3, 5, 6], today: "2026-11-16" }, kept);
ss = run(ss, { type: "row", index: 0, patch: { weight: "140" } });
assert.deepEqual(firstWeek(smolov, maxesKg(ss, sm), 2.5, "kg").map((d) => d.lines[0]), ["Back squat 4 x 9 at 97.5 kg", "Back squat 5 x 7 at 105 kg", "Back squat 7 x 5 at 112.5 kg", "Back squat 10 x 3 at 120 kg"]);

// ── a server error shows on its own screen ──
assert.equal(stepForError("Pick a smallest jump in the same unit.", steps), 0);
assert.equal(stepForError("Enter your squat max.", steps), 1);
assert.equal(stepForError("Use a bench press set of 10 reps or fewer.", steps), 1);
assert.equal(stepForError("No deadlift logged in the last 90 days. Enter a max instead.", steps), 1);
assert.equal(stepForError("Add your squat max.", steps), 1);
assert.equal(stepForError("Pick a start date between last week and a year from now.", steps), 2);
assert.equal(stepForError("That program isn't available.", steps), 3);
assert.equal(stepForError("End your current program before you start another.", steps), 3);
assert.equal(stepForError("Pick a start date between last week and a year from now.", startSteps(false)), 1, "without the maxes screen");

console.log("programs/startFlow: ok");
