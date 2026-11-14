// Run: npm test -- src/lib/programs/memberEdit.test.ts
//
// Edit-while-running: kept, new, removed and changed-rule exercises; a start
// weight changed in the builder; a new percent lift; the current week removed
// or moved; and the change-log lines.
import assert from "node:assert/strict";

import { initState } from "./engines";
import { platformProgram } from "./registry";
import { editReason, normaliseOrigins, rebaseEdit } from "./memberEdit";
import { trainingMax } from "./units";
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
assert.deepEqual(d.lines, ["Add your squat max on My program to get its weights.", "Added days: Legs.", "Added exercises: Back squat."]);
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
assert.deepEqual(removed.lines, ["The week you were on was removed, so you're now on week 2.", "Weeks: 4 to 3."]);
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
const rule = (r: ExerciseRx["rule"]) => edit(before, program([[[{ ...bench, rule: r }, curl], [row]]]), running).lines.filter((l) => !l.startsWith("Add your"))[0];
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

// ── final wave ──
// 9. the position line and the max lines come first and are never cut by the cap
const capWeek = program([[many(12).map((e) => ({ ...e, rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 40 } as ExerciseRx["rule"] }))], [[bench]]]);
const capWeekAfter = program([[[...many(12).map((e): ExerciseRx => ({ ...e, rule: { kind: "linear", incKg: 2.5, deloadAfter: 3, startKg: 50 } })), squat]]]);
const capFirst = edit(capWeek, capWeekAfter, { ...initState(capWeek, {}, 2.5), week: 1 }, [0]);
assert.equal(capFirst.lines[0], "The week you were on was removed, so you're now on week 1.");
assert.equal(capFirst.lines[1], "Add your squat max on My program to get its weights.");
assert.equal(capFirst.lines.length, 11, "2 lines first, then 8 changes and the more line");
assert.match(capFirst.lines[10], /^and \d+ more changes\.$/);

// 10. a notes-only edit does not reopen a finished program; a change to the work does
const doneState: EngineState = { ...running, finished: true };
const notesOnly = edit(before, program([[[benchNotes, curl], [row]]]), doneState);
assert.equal(notesOnly.state.finished, true, "notes only: still finished");
assert.deepEqual(notesOnly.lines, ["Sets, reps or notes changed."]);
const labelled: ProgramTemplate = { ...before, name: "New name", weeks: before.weeks.map((w) => ({ ...w, label: "Base" })) };
assert.equal(edit(before, labelled, doneState).state.finished, true, "name and week label only: still finished");
assert.equal(edit(before, program([[[benchAt75, curl], [row]]]), doneState).state.finished, false, "a new start weight reopens it");
assert.equal(edit(before, program([[[benchRange, curl], [row]]]), doneState).state.finished, false, "a new rule reopens it");

// 11. no origins and several identical weeks: the member keeps their place (same index, clamped)
const fourSame = program([[[bench]], [[bench]], [[bench]], [[bench]]]);
const onThirdWeek: EngineState = { ...initState(fourSame, {}, 2.5), week: 2 };
const toThree = noOrigins(fourSame, program([[[bench]], [[bench]], [[bench]]]), onThirdWeek);
assert.equal(toThree.state.week, 2, "4 to 3 identical weeks: still week 3");
assert.ok(!toThree.lines.some((l) => l.startsWith("The week you were on")));
const toFive = noOrigins(fourSame, program([[[bench]], [[bench]], [[bench]], [[bench]], [[bench]]]), onThirdWeek);
assert.equal(toFive.state.week, 2, "4 to 5 identical weeks: still week 3");
const onFourth: EngineState = { ...initState(fourSame, {}, 2.5), week: 3 };
assert.equal(noOrigins(fourSame, program([[[bench]], [[bench]]]), onFourth).state.week, 1, "4 to 2 from week 4: clamped to the last week");
assert.deepEqual(
  normaliseOrigins(undefined, 4, 3, { before: fourSame.weeks, after: fourSame.weeks.slice(0, 3), current: 2 }),
  [0, 1, 2],
);

// 12. the week label holds when the week count changes: the overall week stays where it was
const oneWeek = program([[[bench]]]);
const sixthWeek: EngineState = { ...initState(oneWeek, {}, 2.5), week: 0, cycle: 5 };
const overall = (t: ProgramTemplate, s: EngineState) => s.cycle * t.weeks.length + s.week + 1;
assert.equal(overall(oneWeek, sixthWeek), 6);
const pairWeeks = program([[[curl]], [[bench]]]);
const grown = edit(oneWeek, pairWeeks, sixthWeek, [null, 0]);
assert.deepEqual([grown.state.cycle, grown.state.week], [2, 1], "a week in front: cycle 2, second week");
assert.equal(overall(pairWeeks, grown.state), 6, "still week 6");
const behind = edit(oneWeek, program([[[bench]], [[curl]]]), sixthWeek, [0, null]);
assert.ok(Math.abs(overall(pairWeeks, behind.state) - 6) <= 1 && behind.state.cycle >= 0, "a week behind: as close to week 6 as it can be");
const early: EngineState = { ...initState(pairWeeks, {}, 2.5), week: 0, cycle: 0 };
const pushed = edit(pairWeeks, program([[[row]], [[row]], [[curl]], [[bench]]]), early, [null, null, 0, 1]);
assert.deepEqual([pushed.state.cycle, pushed.state.week], [0, 2], "never a negative cycle");
assert.equal(edit(before, program([[[bench, face], [row]]]), running).state.cycle, 2, "the same week count keeps the cycle");

// ── library engines keep their own progress across an edit ──
{
  const bbb = platformProgram("531-bbb")!;
  const s0 = initState(bbb, { squat: 111.11, bench: 111.11, deadlift: 111.11, press: 111.11 }, 2.5);
  // One cycle later: the training maxes rose and the bench + set fell short this cycle.
  const s = { ...structuredClone(s0), cycle: 1, week: 1, day: 2, tms: { squat: 105, bench: 102.5, deadlift: 105, press: 102.5 }, short: { bench: true } };
  const after = structuredClone(bbb);
  after.weeks[1].days[2].exercises[2] = { name: "Barbell row", sets: [{ kind: "fixed", reps: 10, rest: 90 }], progress: false };
  const out = rebaseEdit({ before: bbb, after, state: s, weekOrigins: [0, 1, 2, 3], stepKg: 2.5, unit: "kg" });
  assert.deepEqual(out.state.tms, s.tms, "5/3/1 training maxes are kept, not reset from the max");
  assert.deepEqual(out.state.short, { bench: true }, "the + set hold survives");
  assert.equal(out.state.week, 1);
  assert.equal(out.state.day, 2);
  assert.ok(out.lines.length > 0);
}
{
  const gz = platformProgram("gzclp")!;
  const s0 = initState(gz, { squat: 100, bench: 80, press: 50, deadlift: 120 }, 2.5);
  const s = structuredClone(s0);
  s.stages["t1:back squat"] = 1;
  s.weights["t1:back squat"] = 90;
  const after = structuredClone(gz);
  after.weeks[0].days[0].exercises[2] = { name: "Dumbbell row", sets: [{ kind: "fixed", reps: 15, rest: 60 }, { kind: "fixed", reps: 15, rest: 60 }, { kind: "fixed", reps: 15, rest: 60, amrap: true }], tier: "t3" };
  const out = rebaseEdit({ before: gz, after, state: s, weekOrigins: [0], stepKg: 2.5, unit: "kg" });
  assert.equal(out.state.stages["t1:back squat"], 1, "a GZCLP stage is kept");
  assert.equal(out.state.weights["t1:back squat"], 90, "and its weight");
  assert.equal(out.state.t2Base["t2:bench press"], s.t2Base["t2:bench press"], "a kept T2 base is kept");
}
{
  // An edit that changes nothing writes no lines.
  const jug = platformProgram("juggernaut-style")!;
  const s = initState(jug, { squat: 100, bench: 100, deadlift: 100, press: 100 }, 2.5);
  assert.deepEqual(rebaseEdit({ before: jug, after: structuredClone(jug), state: s, weekOrigins: jug.weeks.map((_, i) => i), stepKg: 2.5, unit: "kg" }).lines, []);
}
assert.equal(editReason(["Weeks: 4 to 5."], "Coach Ann"), "Coach Ann edited the program.\nWeeks: 4 to 5.");
assert.equal(editReason(["Weeks: 4 to 5."]), "You edited the program.\nWeeks: 4 to 5.");

// ── library engines: what drops out and what is filled in ──
{
  const gz = platformProgram("gzclp")!;
  const s = initState(gz, { squat: 100, bench: 80, press: 50, deadlift: 120 }, 2.5);
  s.weights["t2:overhead press"] = 30;
  s.misses["t2:overhead press"] = 2;
  s.misses["t2:bench press"] = 1;
  assert.ok(s.t2Base["t2:overhead press"] !== undefined, "the T2 press has a base before the edit");
  const after = structuredClone(gz);
  after.weeks[0].days[3].exercises[1] = { name: "Dumbbell curl", sets: [{ kind: "fixed", reps: 12, rest: 60 }], tier: "t3" };
  const out = rebaseEdit({ before: gz, after, state: s, weekOrigins: [0], stepKg: 2.5, unit: "kg" });
  assert.equal(out.state.weights["t2:overhead press"], undefined, "a removed exercise loses its weight");
  assert.equal(out.state.misses["t2:overhead press"], undefined, "and its misses");
  assert.equal(out.state.t2Base["t2:overhead press"], undefined, "a removed T2 loses its base");
  assert.equal(out.state.t2Base["t2:bench press"], s.t2Base["t2:bench press"], "a kept T2 keeps its base");
  assert.equal(out.state.misses["t2:bench press"], 1, "a kept exercise keeps its misses");
}
{
  const bbb = platformProgram("531-bbb")!;
  const s = initState(bbb, { squat: 100, bench: 100, deadlift: 100, press: 100 }, 2.5);
  s.short = { press: true, bench: true };
  s.testMaxes = { press: 95, bench: 90 };
  const after = structuredClone(bbb);
  after.lifts = after.lifts.filter((l) => l !== "press");
  for (const w of after.weeks) for (const d of w.days) d.exercises = d.exercises.map((e) => (e.lift === "press" ? { name: "Dips", sets: [{ kind: "fixed", reps: 10, rest: 90 }] } : e));
  const out = rebaseEdit({ before: bbb, after, state: s, weekOrigins: [0, 1, 2, 3], stepKg: 2.5, unit: "kg" });
  assert.deepEqual(out.state.short, { bench: true }, "a hold for a lift that left the program is dropped");
  assert.deepEqual(out.state.testMaxes, { bench: 90 }, "so is its test max");
}
{
  const bbb = platformProgram("531-bbb")!;
  const s = initState(bbb, { squat: 100, bench: 111.11, deadlift: 100, press: 100 }, 2.5);
  delete s.tms.bench;
  s.tms.squat = 95;
  const after = structuredClone(bbb);
  after.weeks[0].days[0].exercises[2] = { name: "Barbell row", sets: [{ kind: "fixed", reps: 10, rest: 90 }], progress: false };
  const out = rebaseEdit({ before: bbb, after, state: s, weekOrigins: [0, 1, 2, 3], stepKg: 2.5, unit: "kg" });
  assert.equal(out.state.tms.bench, trainingMax(111.11, after.tmPct), "a lift with a max and no training max gets one from the max");
  assert.equal(out.state.tms.squat, 95, "a training max already there is kept");
}

console.log("programs/memberEdit: ok");
