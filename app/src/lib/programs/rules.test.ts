// Run: npm test -- src/lib/programs/rules.test.ts
//
// The own-rules format: a rule on each exercise, the rule in the state key,
// last session's weight for a fixed set with no engine weight, and the
// template check (shape, plain words, any exercise name).
import assert from "node:assert/strict";

import { planExercise, planSession, stateKey } from "./planner";
import { emptyState, type ExerciseRx, type ProgramTemplate } from "./types";
import { parseTemplate, templateErrors, validateTemplate } from "./validate";

const bench: ExerciseRx = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3 } };
const curl: ExerciseRx = { name: "Cable curl", sets: [{ kind: "fixed", reps: { min: 10, max: 15 }, rest: 60 }], rule: { kind: "range" } };

// ── the rule goes in front of the state key; library keys are unchanged ──
assert.equal(stateKey(bench), "linear:bench press");
assert.equal(stateKey(curl), "range:cable curl@10-15");
assert.equal(stateKey({ name: "Bench press", sets: bench.sets }), "bench press");
assert.equal(stateKey({ ...bench, rule: { kind: "manual" } }), "manual:bench press");

// ── a planned exercise carries its rule; a library one has no rule key at all ──
const planned = planExercise(bench, 0, emptyState(), { stepKg: 2.5 });
assert.deepEqual(planned.rule, { kind: "linear", incKg: 2.5, deloadAfter: 3 });
assert.equal("rule" in planExercise({ name: "Bench press", sets: bench.sets }, 0, emptyState(), { stepKg: 2.5 }), false);

// ── fixed sets: the engine's weight, else last session's, else none ──
assert.equal(planExercise(bench, 0, emptyState(), { stepKg: 2.5 }).sets[0].kg, null);
assert.equal(planExercise(bench, 0, emptyState(), { stepKg: 2.5, lastKg: { "linear:bench press": 60 } }).sets[0].kg, 60);
const withWeight = { ...emptyState(), weights: { "linear:bench press": 62.5 } };
assert.equal(planExercise(bench, 0, withWeight, { stepKg: 2.5, lastKg: { "linear:bench press": 60 } }).sets[0].kg, 62.5);

// ── the template check ──
const own = (exercises: ExerciseRx[]): ProgramTemplate => ({
  key: "member:1",
  name: "My program",
  author: "Built by the member",
  family: "strength",
  level: "intermediate",
  daysPerWeek: 1,
  lengthWeeks: 12,
  lifts: [],
  tmPct: 1,
  who: "Built by the member.",
  description: "Built in the member app.",
  engine: { key: "own_rules" },
  weeks: [{ days: [{ name: "Push A", exercises }] }],
});
assert.ok(validateTemplate(own([bench, curl])).ok, "own rules with a name outside the canonical list pass");
const ownPlan = planSession(own([bench, curl]), emptyState(), { stepKg: 2.5 })!;
assert.equal(ownPlan.exercises[1].rule?.kind, "range");

const libraryStyle = { ...own([{ name: curl.name, sets: curl.sets }]), engine: { key: "double_progression" as const } };
const notListed = validateTemplate(libraryStyle);
assert.equal(notListed.ok, false);
assert.deepEqual(!notListed.ok && notListed.errors, ["Week 1, Push A, Cable curl: not in the exercise list."]);

const errorsOf = (t: unknown): string[] => {
  const r = parseTemplate(t);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.errors;
};
const noReps = errorsOf(own([{ ...bench, sets: [{ kind: "fixed", reps: 0, rest: 120 }] }]));
assert.deepEqual(noReps, ["Week 1, Push A, exercise 1, set 1: add reps."]);
const noTop = errorsOf(own([{ ...curl, sets: [{ kind: "fixed", reps: { min: 10, max: 0 }, rest: 60 }] }]));
assert.equal(noTop[0], "Week 1, Push A, exercise 1, set 1: add reps.");
const tooMany = errorsOf(own([{ ...bench, sets: [{ kind: "fixed", reps: 150, rest: 120 }] }]));
assert.deepEqual(tooMany, ["Week 1, Push A, exercise 1, set 1: reps must be a whole number from 1 to 100."]);
const badInc = errorsOf(own([{ ...bench, rule: { kind: "linear", incKg: 0, deloadAfter: 3 } }]));
assert.deepEqual(badInc, ["Week 1, Push A, exercise 1: the weight to add must be between 0.5 and 50 kg."]);
const badDeload = errorsOf(own([{ ...bench, rule: { kind: "linear", incKg: 2.5, deloadAfter: 0 } }]));
assert.deepEqual(badDeload, ["Week 1, Push A, exercise 1: misses before it gets lighter must be a whole number from 1 to 10."]);
const badStart = errorsOf(own([{ ...bench, rule: { kind: "manual", startKg: 900 } }]));
assert.deepEqual(badStart, ["Week 1, Push A, exercise 1: the starting weight must be between 0 and 600 kg."]);
const badKind = errorsOf(own([{ ...bench, rule: { kind: "guess" } as never }]));
assert.deepEqual(badKind, ["Week 1, Push A, exercise 1: pick a rule."]);
const longDay = own([bench]);
longDay.weeks[0].days[0].name = "x".repeat(80);
assert.ok(parseTemplate(longDay).ok, "day names take up to 80 characters");

// ── a platform program may not carry a rule (it would orphan stored weights) ──
const ruled = { ...own([bench]), engine: { key: "double_progression" as const }, weeks: [{ days: [{ name: "Workout A", exercises: [{ name: "Back squat", sets: bench.sets }, bench] }] }] };
assert.ok(
  templateErrors(ruled).includes("Week 1, Workout A, exercise 2: rules are only for programs you build yourself."),
  JSON.stringify(templateErrors(ruled)),
);

// ── library exercises without a rule keep exactly the keys live members' weights are stored under ──
assert.equal(stateKey({ name: "Back Squat", tier: "t1", sets: [{ kind: "fixed", reps: 3, rest: 180 }] }), "t1:back squat");
assert.equal(stateKey({ name: "Incline  Dumbbell Press", sets: [{ kind: "fixed", reps: { min: 8, max: 12 }, rest: 90 }] }), "incline dumbbell press@8-12");
assert.equal(stateKey({ name: "Back squat", tier: "t2", sets: [{ kind: "fixed", reps: { min: 6, max: 8 }, rest: 90 }] }), "t2:back squat@6-8");

console.log("programs/rules: ok");
