// app/src/lib/programs/planner.test.ts
// Run: npm test -- src/lib/programs/planner.test.ts
import assert from "node:assert/strict";

import { amrap, day, ex, fixed, maxTest, range, sxr, week } from "./dsl";
import {
  advance,
  isLastSession,
  planSession,
  positionOf,
  progresses,
  schemeLabel,
  sessionCount,
  stateKey,
  summarisePlanned,
  summariseRx,
  weekNumber,
} from "./planner";
import { emptyState, type EngineState, type ProgramTemplate } from "./types";
import { STEP_5LB_KG } from "./units";

const t: ProgramTemplate = {
  key: "test",
  name: "Test",
  author: "Test",
  family: "strength",
  level: "beginner",
  daysPerWeek: 2,
  lengthWeeks: 2,
  lifts: ["squat", "bench"],
  tmPct: 0.9,
  who: "Testers.",
  description: "Test.",
  engine: { key: "fixed_block" },
  weeks: [
    week([
      day("Day 1", [ex("Back squat", sxr(4, 9, 0.7), { lift: "squat" }), ex("Bench press", [amrap(0.85, 5)], { lift: "bench" })]),
      day("Day 2", [
        ex("Back squat", sxr(2, 3, 0.8, 180, 10), { lift: "squat" }),
        ex("Barbell row", [fixed(range(8, 12)), { kind: "same_as_last", reps: 8, rest: 90 }]),
        ex("Chin-up", [fixed(10)], { bodyweight: true }),
      ]),
    ]),
    week([day("Test day", [maxTest("Back squat", "squat")], true)], "Test"),
  ],
};

const state: EngineState = { ...emptyState(), maxes: { squat: 166.67, bench: 100 }, tms: { squat: 150, bench: 90 }, weights: { "barbell row@8-12": 60 } };

// State keys: name, tier and rep range.
assert.equal(stateKey(ex("Barbell row", [fixed(range(8, 12))])), "barbell row@8-12");
assert.equal(stateKey(ex("Back squat", [fixed(3)], { tier: "t1" })), "t1:back squat");
assert.equal(stateKey(ex("Bench press", sxr(3, 5, 0.8))), "bench press");
assert.equal(progresses(ex("Barbell row", [fixed(5)])), true);
assert.equal(progresses(ex("Chin-up", [fixed(5)], { bodyweight: true })), false);
assert.equal(progresses(ex("Back squat", sxr(3, 5, 0.8), { lift: "squat" })), false);

// Day 1: percentages of the training max, rounded to 2.5 kg.
const d1 = planSession(t, state, { stepKg: 2.5 })!;
assert.equal(d1.dayName, "Day 1");
assert.equal(d1.position, 0);
assert.equal(summarisePlanned(d1.exercises[0].sets, "kg"), "4 x 9 at 105 kg");
assert.equal(summarisePlanned(d1.exercises[1].sets, "kg"), "1 x 5+ at 77.5 kg");
assert.equal(d1.exercises[1].sets[0].amrap, true);

// Day 2: a fixed kg on top, engine weights, same as last, bodyweight.
const d2 = planSession(t, { ...state, day: 1 }, { stepKg: 2.5 })!;
assert.equal(d2.position, 1);
assert.equal(summarisePlanned(d2.exercises[0].sets, "kg"), "2 x 3 at 130 kg");
assert.deepEqual(d2.exercises[1].sets.map((s) => [s.kg, s.reps, s.repsMax]), [[60, 8, 12], [60, 8, null]]);
assert.equal(d2.exercises[2].sets[0].kg, null);
assert.equal(d2.exercises[2].bodyweight, true);

// Test day: warm-ups from the training max, the attempt from the max.
const td = planSession(t, { ...state, week: 1, day: 0 }, { stepKg: 2.5 })!;
assert.equal(td.test, true);
assert.equal(td.weekLabel, "Test");
assert.deepEqual(td.exercises[0].sets.map((s) => s.kg), [75, 105, 127.5, 142.5, 167.5]);
const td2 = planSession(t, { ...state, week: 1, day: 0 }, { stepKg: 2.5, e1rm: { "back squat": 200 } })!;
assert.equal(td2.exercises[0].sets[4].kg, 200);

// Pounds: the smallest jump is 5 lb.
const lb = planSession(t, state, { stepKg: STEP_5LB_KG })!;
assert.equal(summarisePlanned(lb.exercises[0].sets, "lb"), "4 x 9 at 230 lb");

// A finished block has no next session.
assert.equal(planSession(t, { ...state, finished: true }, { stepKg: 2.5 }), null);

// Positions.
assert.equal(sessionCount(t), 3);
assert.equal(positionOf(t, 1, 0), 2);
assert.equal(isLastSession(t, 1, 0), true);
assert.equal(isLastSession(t, 0, 1), false);
assert.deepEqual(advance(t, { week: 0, day: 0, cycle: 0 }), { week: 0, day: 1, cycle: 0, wrapped: false });
assert.deepEqual(advance(t, { week: 0, day: 1, cycle: 0 }), { week: 1, day: 0, cycle: 0, wrapped: false });
assert.deepEqual(advance(t, { week: 1, day: 0, cycle: 0 }), { week: 0, day: 0, cycle: 1, wrapped: true });
assert.equal(weekNumber(t, { week: 1, cycle: 2 }), 6);

// Summaries for the staff preview.
assert.equal(summariseRx(sxr(4, 9, 0.7)), "4 x 9 at 70%");
assert.equal(summariseRx(sxr(2, 3, 0.8, 180, 10)), "2 x 3 at 80% + 10 kg");
assert.equal(summariseRx(sxr(3, 2, 0.725)), "3 x 2 at 72.5%");
assert.equal(summariseRx([fixed(range(8, 12)), fixed(range(8, 12))]), "2 x 8-12");
assert.equal(
  summariseRx(maxTest("Back squat", "squat").sets),
  "1 x 5 at 50%, then 1 x 3 at 70%, then 1 x 1 at 85%, then 1 x 1 at 95%, then 1 x 1 at RPE 10",
);
assert.equal(schemeLabel([fixed(3), fixed(3), fixed(3), fixed(3), fixed(3, 180, true)]), "5 x 3+");
assert.equal(schemeLabel([fixed(10), fixed(10), fixed(10)]), "3 x 10");

console.log("programs/planner: ok");
