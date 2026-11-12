// Run: npm test -- src/lib/programs/memberEdit.test.ts
//
// Edit-while-running: kept, new, removed and changed-rule exercises; a start
// weight changed in the builder; a new percent lift; the current week removed
// or moved; and the change-log lines.
import assert from "node:assert/strict";

import { initState } from "./engines";
import { editReason, normaliseOrigins, rebaseEdit } from "./memberEdit";
import type { EngineState, ExerciseRx, ProgramTemplate } from "./types";

const bench: ExerciseRx = { name: "Bench press", sets: [{ kind: "fixed", reps: 5, rest: 120 }], rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 60 } };
const row: ExerciseRx = { name: "Cable row", sets: [{ kind: "fixed", reps: { min: 8, max: 12 }, rest: 90 }], rule: { kind: "range", startKg: 50 } };
const curl: ExerciseRx = { name: "Hammer curl", sets: [{ kind: "fixed", reps: 10, rest: 60 }], rule: { kind: "manual", startKg: 15 } };
const squat: ExerciseRx = { name: "Back squat", lift: "squat", sets: [{ kind: "pct", pct: 0.8, reps: 3, rest: 180 }], rule: { kind: "percent" } };

function program(weeks: ExerciseRx[][][]): ProgramTemplate {
  return {
    key: "member:1",
    name: "Mine",
    author: "Built by the member",
    family: "strength",
    level: "intermediate",
    daysPerWeek: 2,
    lengthWeeks: 12,
    lifts: weeks.flat(2).some((e) => e.rule?.kind === "percent") ? ["squat"] : [],
    tmPct: 1,
    who: "Built by the member.",
    description: "Mine.",
    engine: { key: "own_rules" },
    weeks: weeks.map((days) => ({ days: days.map((exercises, i) => ({ name: ["Push", "Pull", "Legs"][i], exercises })) })),
  };
}
const edit = (before: ProgramTemplate, after: ProgramTemplate, state: EngineState, weekOrigins?: (number | null)[]) =>
  rebaseEdit({ before, after, state, weekOrigins: weekOrigins ?? after.weeks.map((_, i) => (i < before.weeks.length ? i : null)), stepKg: 2.5, unit: "kg" });
const noOrigins = (before: ProgramTemplate, after: ProgramTemplate, state: EngineState) =>
  rebaseEdit({ before, after, state, weekOrigins: undefined as unknown as (number | null)[], stepKg: 2.5, unit: "kg" });

const before = program([[[bench, curl], [row]]]);
const running: EngineState = { ...initState(before, {}, 2.5), day: 1, cycle: 2, weights: { "linear:bench press": 72.5, "range:cable row@8-12": 55, "manual:hammer curl": 15 }, misses: { "linear:bench press": 2 } };

// ── kept exercises keep their weight and misses; a new one starts from its rule; a removed one drops out ──
const face: ExerciseRx = { name: "Face pull", sets: [{ kind: "fixed", reps: 15, rest: 60 }], rule: { kind: "manual", startKg: 20 } };
const a = edit(before, program([[[bench, face], [row]]]), running);
assert.deepEqual(a.state.weights, { "linear:bench press": 72.5, "range:cable row@8-12": 55, "manual:face pull": 20 });
assert.deepEqual(a.state.misses, { "linear:bench press": 2 });
assert.deepEqual([a.state.week, a.state.day, a.state.cycle], [0, 1, 2]);
assert.deepEqual(a.lines, ["Added exercises: Face pull.", "Removed exercises: Hammer curl."]);
assert.equal(editReason(a.lines), "You edited the program.\nAdded exercises: Face pull.\nRemoved exercises: Hammer curl.");

// ── a changed rule starts the exercise again, with a reason ──
const benchRange: ExerciseRx = { ...bench, sets: [{ kind: "fixed", reps: { min: 6, max: 10 }, rest: 120 }], rule: { kind: "range" } };
const b = edit(before, program([[[benchRange, curl], [row]]]), running);
assert.equal(b.state.weights["linear:bench press"], undefined);
assert.equal(b.state.weights["range:bench press@6-10"], undefined, "no start weight: last session's weight is planned");
assert.equal(b.state.misses["linear:bench press"], undefined);
assert.deepEqual(b.lines, ["Bench press now goes up through a rep range. It starts again from the new rule."]);
const rowNarrow: ExerciseRx = { ...row, sets: [{ kind: "fixed", reps: { min: 6, max: 10 }, rest: 90 }] };
assert.deepEqual(edit(before, program([[[bench, curl], [rowNarrow]]]), running).lines, ["Cable row has a new rep range. It starts again from there."]);

// ── a start weight changed in the builder applies from the next session; an unchanged one changes nothing ──
const benchAt75: ExerciseRx = { ...bench, rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 75 } };
const c = edit(before, program([[[benchAt75, curl], [row]]]), running);
assert.equal(c.state.weights["linear:bench press"], 75);
assert.equal(c.state.misses["linear:bench press"], 0);
assert.deepEqual(c.lines, ["Bench press: 75 kg from the next session."]);
const benchNotes: ExerciseRx = { ...bench, notes: "Pause on the chest." };
const same = edit(before, program([[[benchNotes, curl], [row]]]), running);
assert.equal(same.state.weights["linear:bench press"], 72.5, "an unchanged start weight leaves the working weight alone");
assert.deepEqual(same.lines, ["Sets, reps or notes changed."]);

// ── a new percent lift: its max comes later; days added and removed ──
const d = edit(before, program([[[bench, curl], [row], [squat]]]), running);
assert.deepEqual(d.lines, ["Added days: Legs.", "Added exercises: Back squat.", "Add your squat max on My program to get its weights."]);
const withMax = edit(before, program([[[bench, curl], [row], [squat]]]), { ...running, maxes: { squat: 150 } });
assert.equal(withMax.state.tms.squat, 150);
assert.deepEqual(edit(before, program([[[bench, curl, row]]]), running).lines, ["Removed days: Pull."]);
assert.equal(edit(before, program([[[bench, curl, row]]]), running).state.day, 0, "the day clamps into the shorter week");
const swapped: ProgramTemplate = { ...before, weeks: [{ days: [before.weeks[0].days[1], before.weeks[0].days[0]] }] };
assert.equal(edit(before, swapped, running).state.day, 0, "Pull moved to the front, and the member stays on Pull");

// ── weeks: the member follows their week when weeks move; a removed week sends them to the nearest earlier one ──
const four = program([[[bench]], [[bench]], [[bench]], [[bench]]]);
const onWeek3: EngineState = { ...initState(four, {}, 2.5), week: 2, day: 0 };
const moved = edit(four, four, onWeek3, [2, 0, 1, 3]);
assert.equal(moved.state.week, 0, "week 3 moved to the front");
const three = program([[[bench]], [[bench]], [[bench]]]);
const removed = edit(four, three, onWeek3, [0, 1, 3]);
assert.deepEqual([removed.state.week, removed.state.day], [1, 0]);
assert.deepEqual(removed.lines, ["Weeks: 4 to 3.", "The week you were on was removed, so you're now on week 2."]);
const firstGone = edit(four, three, { ...onWeek3, week: 0 }, [1, 2, 3]);
assert.equal(firstGone.state.week, 0, "no earlier week: the first one");

// ── week origins that do not fit fall back to the same positions ──
assert.deepEqual(normaliseOrigins([0, 0], 2, 2), [0, 1]);
assert.deepEqual(normaliseOrigins("x", 2, 3), [0, 1, null]);
assert.deepEqual(normaliseOrigins([1, null, 0], 2, 3), [1, null, 0]);
assert.deepEqual(normaliseOrigins([5], 2, 1), [0]);

// ── fix wave ──
const dayProg = (names: string[], ex: ExerciseRx[] = [bench]) => ({
  ...program([[ex]]),
  weeks: [{ days: names.map((name) => ({ name, exercises: ex })) }],
});

// 1. repeated day names: an unchanged save stays on the same day
const ul = dayProg(["Upper", "Lower", "Upper", "Lower"]);
const onThird: EngineState = { ...initState(ul, {}, 2.5), day: 2 };
assert.equal(edit(ul, { ...ul, name: "Renamed" }, onThird).state.day, 2, "stays on index 2");
const ulMoved = dayProg(["Lower", "Upper", "Upper", "Lower"]);
assert.equal(edit(ul, ulMoved, onThird).state.day, 2, "same index with the same name is kept");
assert.equal(edit(ul, dayProg(["Lower", "Upper"]), onThird).state.day, 1, "else the first day with that name");

// 2. no-op edits
const noop = edit(before, before, running);
assert.deepEqual(noop.lines, []);
assert.deepEqual(noop.state, running);
const finishedState: EngineState = { ...running, finished: true };
assert.equal(edit(before, before, finishedState).state.finished, true, "a no-op does not reopen a finished program");
const pctProg = program([[[bench, squat]]]);
assert.deepEqual(edit(pctProg, pctProg, initState(pctProg, {}, 2.5)).lines, [], "no max line on a no-op");
const pctEdited = program([[[{ ...bench, notes: "x" }, squat]]]);
assert.deepEqual(edit(pctProg, pctEdited, initState(pctProg, {}, 2.5)).lines, ["Sets, reps or notes changed."], "an old percent lift without a max is not asked again");

// 3. a start weight that rounds to 0 stores nothing
const benchAt1: ExerciseRx = { ...bench, rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 1 } };
const zero = edit(before, program([[[benchAt1, curl], [row]]]), running);
assert.equal(zero.state.weights["linear:bench press"], undefined);
assert.ok(!zero.lines.some((l) => l.includes("0 kg")));

// 4. rule-change wording
const rule = (r: ExerciseRx["rule"]) => edit(before, program([[[{ ...bench, rule: r }, curl], [row]]]), running).lines[0];
assert.equal(rule({ kind: "manual" }), "Bench press now uses weights you set yourself. It starts again from the new rule.");
assert.equal(rule({ kind: "percent" }), "Bench press now uses a percent of your max. It starts again from the new rule.");
assert.equal(rule({ kind: "rpe", rpe: 8 } as ExerciseRx["rule"]), "Bench press now goes by RPE. It starts again from the new rule.");
const benchManual: ExerciseRx = { ...bench, rule: { kind: "manual" } };
assert.equal(edit(program([[[benchManual, curl], [row]]]), before, { ...running, weights: {}, misses: {} }).lines[0], "Bench press now adds weight each session. It starts again from the new rule.");

// 5. the first week removed
const firstGone2 = edit(four, three, { ...onWeek3, week: 0 }, [1, 2, 3]);
assert.equal(firstGone2.state.week, 0);
assert.ok(firstGone2.lines.includes("The week you were on was removed, so you're now on week 1."));

// 6. change log accuracy
const reordered = edit(four, four, onWeek3, [1, 0, 2, 3]);
assert.ok(reordered.lines.includes("Weeks reordered."));
const twoBench = program([[[bench, benchManual]]]);
const oneBench = program([[[bench]]]);
assert.deepEqual(edit(twoBench, oneBench, initState(twoBench, {}, 2.5)).lines, ["Removed: Bench press (weights you set yourself)."]);
const weekA = [{ name: "Push", exercises: [bench] }, { name: "Pull", exercises: [curl] }];
const twoWeeks: ProgramTemplate = { ...before, weeks: [{ days: weekA }, { days: weekA }] };
const oneDayLess: ProgramTemplate = { ...twoWeeks, weeks: [{ days: weekA }, { days: [weekA[0]] }] };
assert.deepEqual(edit(twoWeeks, oneDayLess, initState(twoWeeks, {}, 2.5)).lines, ["Week 2: removed Pull."]);

// 7. the log is capped at 8 lines
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...bench, name: `Move ${i}` }));
const manyBefore = program([[many(12).map((e) => ({ ...e, rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 40 } as ExerciseRx["rule"] }))]]);
const manyAfter = program([[many(12).map((e) => ({ ...e, rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 50 } as ExerciseRx["rule"] }))]]);
const cap = edit(manyBefore, manyAfter, initState(manyBefore, {}, 2.5));
assert.equal(cap.lines.length, 9);
assert.equal(cap.lines[8], "and 4 more changes.");

// 8. lb weight line; a week added before the current one
const lb = rebaseEdit({ before, after: program([[[benchAt75, curl], [row]]]), state: running, weekOrigins: [0], stepKg: 2.26796, unit: "lb" });
assert.deepEqual(lb.lines, ["Bench press: 165 lb from the next session."]);
const aB = program([[[bench]], [[bench, curl]]]);
const onB: EngineState = { ...initState(aB, {}, 2.5), week: 1 };
const nWeek = program([[[row]], [[bench]], [[bench, curl]]]);
assert.equal(edit(aB, nWeek, onB, [null, 0, 1]).state.week, 2, "with origins the member stays on their week");
assert.equal(noOrigins(aB, nWeek, onB).state.week, 2, "no origins: the identical week is found by content");
const nWeekEdited = program([[[row]], [[bench]], [[bench, curl, row]]]);
assert.equal(noOrigins(aB, nWeekEdited, onB).state.week, 1, "no origins and no identical week: the same index");
assert.deepEqual(normaliseOrigins(undefined, 2, 2), [0, 1]);

console.log("programs/memberEdit: ok");
