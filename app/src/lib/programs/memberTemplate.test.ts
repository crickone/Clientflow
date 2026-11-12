// Run: npm test -- src/lib/programs/memberTemplate.test.ts
//
// Builder validation: the fields a member never picks are filled in, errors
// read in plain words with the week, day and exercise, and the limits hold.
import assert from "node:assert/strict";

import { blankMemberTemplate, finishMemberTemplate, memberKey, memberLength, memberLine, parseMemberKey, percentLifts, validateMemberTemplate } from "./memberTemplate";
import { initState, progress } from "./engines";
import { planSession } from "./planner";
import type { ExerciseRx, ProgramTemplate } from "./types";

const bench: ExerciseRx = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3 } };
const squat: ExerciseRx = { name: "Back squat", lift: "squat", sets: [{ kind: "pct", pct: 0.8, reps: 3, rest: 180 }], rule: { kind: "percent" } };

function program(mutate: (t: ProgramTemplate) => void = () => {}): ProgramTemplate {
  const t = blankMemberTemplate();
  t.name = "Strength block";
  t.weeks = [{ days: [{ name: "Push A", exercises: [structuredClone(squat), structuredClone(bench)] }] }];
  mutate(t);
  return t;
}

function errorsOf(t: ProgramTemplate): string[] {
  const r = validateMemberTemplate(t, memberKey(7));
  assert.equal(r.ok, false, "expected errors");
  return r.ok ? [] : r.errors;
}

// ── keys ──
assert.equal(memberKey(7), "member:7");
assert.equal(parseMemberKey("member:7"), 7);
assert.equal(parseMemberKey("member:x"), null);
assert.equal(parseMemberKey("copy-7"), null);

// ── lengths: about 12 weeks in whole blocks ──
assert.deepEqual([1, 2, 4, 5, 7, 12].map(memberLength), [12, 12, 12, 15, 14, 12]);

// ── the line on the member's list ──
assert.equal(memberLine(program()), "1 day a week, one week that repeats");
assert.equal(memberLine(program((p) => void (p.weeks = [{ days: [p.weeks[0].days[0], p.weeks[0].days[0], p.weeks[0].days[0]] }, p.weeks[0]]))), "3 days a week, 2 weeks that repeat");

// ── what the member never picks ──
const ok = validateMemberTemplate(
  program((t) => {
    t.key = "anything";
    t.author = "Someone else";
    t.tmPct = 0.9;
    t.lifts = ["bench", "deadlift"];
    t.weeks[0].days[0].exercises[0].joined = true;
    t.weeks[0].days[0].exercises[1].lift = "bench";
  }),
  memberKey(7),
);
assert.ok(ok.ok, JSON.stringify(ok));
const t = ok.template;
assert.equal(t.key, "member:7");
assert.equal(t.author, "Built by the member");
assert.deepEqual(t.engine, { key: "own_rules" });
assert.equal(t.tmPct, 1);
assert.deepEqual(t.lifts, ["squat"], "a max only for lifts a percent exercise uses");
assert.equal(t.weeks[0].days[0].exercises[0].joined, undefined, "the first exercise joins nothing");
assert.equal(t.weeks[0].days[0].exercises[1].lift, "bench", "a linear exercise keeps its lift, for the empty-bar floor");
assert.equal(t.daysPerWeek, 1);
assert.equal(t.lengthWeeks, 12);
assert.deepEqual(percentLifts(t), ["squat"]);
assert.deepEqual(finishMemberTemplate(t, "member:7"), t, "finishing is stable");

// ── a blank program needs an exercise ──
assert.deepEqual(errorsOf(blankMemberTemplate()), ["Week 1, Day 1: add at least one exercise."]);

// ── plain words with the week, day and exercise ──
assert.deepEqual(
  errorsOf(
    program((p) => {
      p.weeks.push(structuredClone(p.weeks[0]));
      p.weeks[1].days[0].exercises[1].sets[0] = { kind: "fixed", reps: 0, rest: 120 };
    }),
  ),
  ["Week 2, Push A, exercise 2, set 1: add reps."],
);
assert.deepEqual(errorsOf(program((p) => void delete p.weeks[0].days[0].exercises[1].rule)), ["Week 1, Push A, exercise 2: pick a rule."]);
assert.deepEqual(errorsOf(program((p) => void delete p.weeks[0].days[0].exercises[0].lift)), ["Week 1, Push A, exercise 1: pick the max it uses."]);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[0].sets = [{ kind: "pct", pct: 1.5, reps: 1, rest: 60 }]))),
  ["Week 1, Push A, exercise 1: 150% is outside 30% to 110%."],
);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[1].rule = { kind: "range" }))),
  ["Week 1, Push A, exercise 2: every set needs a rep range."],
);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[1].rule = { kind: "rpe" }))),
  ["Week 1, Push A, exercise 2: every set needs an RPE."],
);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[1].sets = [{ kind: "fixed", reps: { min: 5, max: 8 }, rest: 60 }]))),
  ["Week 1, Push A, exercise 2: every set needs a rep count."],
);
assert.deepEqual(errorsOf(program((p) => void (p.name = ""))), ["Add a name."]);

// ── limits: 12 weeks, 7 days, 15 exercises, 10 sets, 80-character names, 300-character notes ──
assert.deepEqual(errorsOf(program((p) => void (p.weeks = Array.from({ length: 13 }, () => structuredClone(p.weeks[0]))))), ["No more than 12 weeks."]);
assert.ok(validateMemberTemplate(program((p) => void (p.weeks = Array.from({ length: 12 }, () => structuredClone(p.weeks[0])))), "member:7").ok);
assert.deepEqual(errorsOf(program((p) => void (p.weeks[0].days = Array.from({ length: 8 }, (_, i) => ({ name: `Day ${i + 1}`, exercises: [structuredClone(bench)] }))))), ["Week 1: no more than 7 days."]);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises = Array.from({ length: 16 }, () => structuredClone(bench))))),
  ["Week 1, Push A: no more than 15 exercises in a day."],
);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[1].sets = Array.from({ length: 11 }, () => ({ kind: "fixed" as const, reps: 5, rest: 60 }))))),
  ["Week 1, Push A, exercise 2: no more than 10 sets in an exercise."],
);
assert.deepEqual(errorsOf(program((p) => void (p.name = "x".repeat(81)))), ["The name is too long (80 characters at most)."]);
assert.deepEqual(
  errorsOf(program((p) => void (p.weeks[0].days[0].exercises[1].notes = "x".repeat(301)))),
  ["Week 1, Push A, exercise 2: the notes are too long (300 characters at most)."],
);
assert.ok(validateMemberTemplate(program((p) => void (p.weeks[0].days[0].exercises[1].name = "Cable crossover, low to high")), "member:7").ok, "any exercise name");

// ── a linear barbell lift (a converted squat) never deloads below the empty bar, and asks for no max ──
const linSquat: ExerciseRx = { name: "Back squat", lift: "squat", sets: [{ kind: "fixed", reps: 5, rest: 180 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 1, startKg: 20 } };
const rawCurl: ExerciseRx = { name: "Hammer curl", lift: "row", sets: [{ kind: "fixed", reps: 10, rest: 60 }], rule: { kind: "manual" } };
const barCheck = validateMemberTemplate(program((p) => void (p.weeks[0].days[0].exercises = [structuredClone(linSquat), structuredClone(rawCurl)])), memberKey(7));
assert.ok(barCheck.ok, JSON.stringify(barCheck));
const barT = barCheck.template;
assert.equal(barT.weeks[0].days[0].exercises[0].lift, "squat", "the linear squat keeps its lift");
assert.equal(barT.weeks[0].days[0].exercises[1].lift, undefined, "a manual exercise drops it");
assert.deepEqual(barT.lifts, [], "no max is asked for a linear lift");
const barState = initState(barT, {}, 2.5);
assert.equal(barState.weights["linear:back squat"], 20);
const barPlan = planSession(barT, barState, { stepKg: 2.5 })!;
const missed = progress({
  template: barT,
  state: barState,
  result: { exercises: barPlan.exercises.map((e) => ({ planned: e, sets: e.sets.map((x) => ({ kg: x.kg, reps: 2, done: true })) })) },
  stepKg: 2.5,
  unit: "kg",
});
assert.equal(missed.state.weights["linear:back squat"], 20, "the deload stops at the empty bar");

console.log("programs/memberTemplate: ok");
