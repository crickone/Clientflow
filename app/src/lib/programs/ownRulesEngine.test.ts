// Run: npm test -- src/lib/programs/ownRulesEngine.test.ts
//
// The own_rules engine: one session with all five rules gives the right
// weights and reasons; starting weights; a linear deload; a range with its own
// jump; a test day moves the max; an exercise no longer in the program
// changes nothing; skipping and finishing wrap a repeating week.
import assert from "node:assert/strict";

import { initState, progress, skipSession } from "./engines";
import { planSession } from "./planner";
import type { DoneSet, EngineState, ExerciseRx, PlannedSession, ProgramTemplate, SessionResult } from "./types";

const squat: ExerciseRx = {
  name: "Back squat",
  lift: "squat",
  sets: [
    { kind: "pct", pct: 0.75, reps: 5, rest: 180 },
    { kind: "amrap", pct: 0.85, reps: 3, rest: 180 },
  ],
  rule: { kind: "percent" },
};
const bench: ExerciseRx = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }, { kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 2, startKg: 60 } };
const row: ExerciseRx = { name: "Cable row", sets: [{ kind: "fixed", reps: { min: 8, max: 12 }, rest: 90 }, { kind: "fixed", reps: { min: 8, max: 12 }, rest: 90 }], rule: { kind: "range", incKg: 5, startKg: 50 } };
const press: ExerciseRx = { name: "Incline dumbbell press", sets: [{ kind: "rpe", rpe: 8, reps: 8, rest: 120 }], rule: { kind: "rpe" } };
const curl: ExerciseRx = { name: "Hammer curl", sets: [{ kind: "fixed", reps: 10, rest: 60 }], rule: { kind: "manual", startKg: 15 } };

const t: ProgramTemplate = {
  key: "member:1",
  name: "My program",
  author: "Built by the member",
  family: "strength",
  level: "intermediate",
  daysPerWeek: 2,
  lengthWeeks: 12,
  lifts: ["squat"],
  tmPct: 1,
  who: "Built by the member.",
  description: "Built in the member app.",
  engine: { key: "own_rules" },
  weeks: [{ days: [{ name: "Day A", exercises: [squat, bench, row, press, curl] }, { name: "Test", exercises: [{ ...squat, sets: [{ kind: "pct", pct: 0.9, reps: 1, rest: 240 }, { kind: "pct", pct: 1, reps: 1, rest: 300 }] }], test: true }] }],
};
const ctx = { stepKg: 2.5, e1rm: { "rpe:incline dumbbell press": 40 } };

// ── starting weights come from each rule; percentages from the max ──
const s0 = initState(t, { squat: 140 }, 2.5);
assert.deepEqual(s0.weights, { "linear:bench press": 60, "range:cable row@8-12": 50, "manual:hammer curl": 15 });
assert.equal(s0.tms.squat, 140);
const plan = planSession(t, s0, ctx)!;
assert.deepEqual(plan.exercises.map((e) => e.sets.map((s) => s.kg)), [[105, 120], [60, 60], [50, 50], [30], [15]]);
assert.deepEqual(plan.exercises.map((e) => e.rule?.kind), ["percent", "linear", "range", "rpe", "manual"]);

const done = (p: PlannedSession, pick: (exIndex: number, setIndex: number, kg: number | null, reps: number, repsMax: number | null) => DoneSet): SessionResult => ({
  exercises: p.exercises.map((e, ei) => ({ planned: e, sets: e.sets.map((s, si) => pick(ei, si, s.kg, s.reps, s.repsMax)) })),
});
const run = (state: EngineState, result: SessionResult) => progress({ template: t, state, result, stepKg: 2.5, unit: "kg" });

// ── the rule mix: every rep, the top of the range, a heavier curl ──
const r1 = run(
  s0,
  done(plan, (ei, _si, kg, reps, repsMax) => ({ kg: ei === 4 ? 16 : kg, reps: repsMax ?? reps, done: true })),
);
assert.deepEqual(r1.state.weights, { "linear:bench press": 62.5, "range:cable row@8-12": 55, "manual:hammer curl": 16 });
assert.deepEqual(r1.reasons, [
  "Next bench press 62.5 kg. You did all 2 sets of 5.",
  "Next cable row 55 kg, back to 8 reps. You hit 12 on every set.",
  "Next hammer curl 16 kg, the weight you used.",
]);
assert.equal(r1.state.tms.squat, 140, "a percent exercise never moves the max on a normal day");
assert.deepEqual([r1.state.week, r1.state.day], [0, 1]);

// ── misses: bench stays, then drops 10% after two in a row; the row keeps its weight ──
const missAll = (state: EngineState) => run(state, done(planSession(t, state, ctx)!, (_ei, si, kg, reps) => ({ kg, reps: si === 1 ? reps - 2 : reps, done: true })));
const m1 = missAll({ ...r1.state, day: 0 });
assert.equal(m1.state.weights["linear:bench press"], 62.5);
assert.equal(m1.reasons[0], "Bench press stays at 62.5 kg. You got 3 of 5 on set 2. Try it again next time.");
assert.equal(m1.state.weights["range:cable row@8-12"], 55);
const m2 = missAll({ ...m1.state, day: 0 });
assert.equal(m2.state.weights["linear:bench press"], 57.5);
assert.equal(m2.reasons[0], "Next bench press 57.5 kg, 10% lighter. You missed reps two sessions in a row.");

// ── a range rule with no jump of its own uses the smallest jump ──
const tSmall: ProgramTemplate = { ...t, weeks: [{ days: [{ name: "Day A", exercises: [{ ...row, rule: { kind: "range" } }] }] }] };
const sSmall = initState(tSmall, {}, 2.5);
assert.equal(sSmall.weights["range:cable row@8-12"], undefined, "no start weight: the first session sets it");
const pSmall = planSession(tSmall, sSmall, { stepKg: 2.5, lastKg: { "range:cable row@8-12": 45 } })!;
assert.equal(pSmall.exercises[0].sets[0].kg, 45, "last session's weight is planned");
const rSmall = progress({ template: tSmall, state: sSmall, result: done(pSmall, (_e, _s, kg, _r, repsMax) => ({ kg, reps: repsMax!, done: true })), stepKg: 2.5, unit: "kg" });
assert.equal(rSmall.state.weights["range:cable row@8-12"], 47.5);

// ── a test day moves the squat max, and its percentages follow ──
const atTest = { ...r1.state, week: 0, day: 1 };
const testPlan = planSession(t, atTest, ctx)!;
assert.equal(testPlan.test, true);
const rt = run(atTest, done(testPlan, (_ei, si, kg) => ({ kg: si === 1 ? 150 : kg, reps: 1, done: true })));
assert.equal(rt.state.maxes.squat, 150);
assert.equal(rt.state.tms.squat, 150);
assert.equal(rt.reasons.at(-1), "Your new squat max is about 150 kg, from 150 kg x 1. Its percentages use it from the next session.");
assert.deepEqual([rt.state.week, rt.state.day, rt.state.cycle], [0, 0, 1], "the week repeats");
assert.equal(planSession(t, rt.state, ctx)!.exercises[0].sets[0].kg, 112.5);
const noTest = run(atTest, done(testPlan, () => ({ kg: null, reps: null, done: false })));
assert.equal(noTest.state.maxes.squat, 140);
assert.equal(noTest.reasons.at(-1), "No squat max from today. It stays at 140 kg.");

// ── an exercise no longer in the program (finished after an edit) changes nothing ──
const edited: ProgramTemplate = { ...t, weeks: [{ days: [{ name: "Day A", exercises: [squat, row, press, curl] }, t.weeks[0].days[1]] }] };
const r2 = progress({ template: edited, state: s0, result: done(plan, (_ei, _si, kg, reps, repsMax) => ({ kg, reps: repsMax ?? reps, done: true })), stepKg: 2.5, unit: "kg" });
assert.equal(r2.state.weights["linear:bench press"], 60, "bench was removed, so its weight is untouched");
assert.ok(!r2.reasons.some((x) => x.includes("bench")));

// ── skipping moves on and wraps ──
const sk = skipSession(t, { ...s0, day: 1 });
assert.deepEqual([sk.state.week, sk.state.day, sk.state.cycle, sk.state.finished], [0, 0, 1, false]);
assert.deepEqual(sk.reasons, []);

console.log("programs/ownRulesEngine: ok");
