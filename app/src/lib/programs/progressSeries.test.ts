// Run: npm test -- src/lib/programs/progressSeries.test.ts
import assert from "node:assert/strict";

import { initState } from "./engines";
import { platformProgram } from "./registry";
import { CHART_LABEL, chartKind, hasPlusSets, inRound, liftSeries, liftValue, plannedSeries, plusSetRows, soFarSeries, type Snapshot } from "./progressSeries";
import { simulate } from "./simulate";
import { emptyState } from "./types";
import { roundToStep } from "./units";

const get = (k: string) => platformProgram(k)!;
const snap = (s: ReturnType<typeof initState>): Snapshot => ({ week: s.week, day: s.day, cycle: s.cycle, maxes: s.maxes, tms: s.tms, weights: s.weights });

// kinds
assert.equal(chartKind(get("531-bbb")), "tm");
assert.equal(chartKind(get("texas-method")), "tm");
assert.equal(chartKind(get("stronglifts-5x5")), "weight");
assert.equal(chartKind(get("gzclp")), "weight");
assert.equal(chartKind(get("smolov-base")), "top");
assert.equal(CHART_LABEL.tm, "Training max");

// 5/3/1: the training max rises each 4-week cycle, planned to week 12
{
  const t = get("531-bbb");
  const s = initState(t, { squat: 100, bench: 80, deadlift: 120, press: 50 }, 2.5);
  assert.deepEqual(liftSeries(t, [snap(s)], s, 2.5, "kg").map((l) => l.lift), ["bench", "deadlift", "press", "squat"]);
  assert.equal(liftValue(t, s, "squat", 2.5), 100);
  const p = plannedSeries(t, s, "squat", 2.5, "kg");
  assert.equal(p[0].week, 1);
  assert.equal(p[0].kg, 100);
  assert.equal(p.at(-1)!.week, 12);
  assert.equal(p.at(-1)!.kg, 110, "two rises of 5 kg inside 12 weeks: after weeks 4 and 8");
  // so far, from the change log: start, then a finished cycle
  const run = simulate(t, { maxes: { squat: 100, bench: 80, deadlift: 120, press: 50 }, sessions: 16 });
  const snaps = [snap(s), ...run.states.map(snap)];
  const sf = soFarSeries(t, snaps, "squat", 2.5);
  assert.equal(sf[0].week, 1);
  assert.equal(sf[0].kg, 100);
  assert.equal(sf.at(-1)!.kg, 105, "after one cycle the squat training max is 105");
  assert.ok(sf.every((pt, i) => i === 0 || pt.week > sf[i - 1].week), "one point per week, in order");
}

// StrongLifts: the working weight rises each session the lift is done
{
  const t = get("stronglifts-5x5");
  const s = initState(t, { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, 2.5);
  assert.equal(liftValue(t, s, "squat", 2.5), 50);
  const p = plannedSeries(t, s, "squat", 2.5, "kg");
  assert.ok(p.at(-1)!.kg > p[0].kg);
  assert.equal(p.at(-1)!.week, t.lengthWeeks);
  assert.equal(p.at(-1)!.kg, 137.5, "squat rises 2.5 kg every session, to 137.5 kg by week 12");
  assert.equal(p[0].kg, 50, "the planned line starts at the current weight, not after this week's sessions");
}

// the planned line starts where the so-far line ends: day one and mid-week
{
  const maxes = { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 };
  for (const key of ["stronglifts-5x5", "gzclp"]) {
    const t = get(key);
    const s = initState(t, maxes, 2.5);
    const before = structuredClone(s);
    const sf = soFarSeries(t, [snap(s)], "squat", 2.5);
    const p = plannedSeries(t, s, "squat", 2.5, "kg");
    assert.deepEqual(p[0], sf.at(-1), `${key}: day one, planned starts at the so-far end`);
    assert.deepEqual(s, before, `${key}: plannedSeries leaves the caller's state unchanged`);
  }
  assert.equal(plannedSeries(get("gzclp"), initState(get("gzclp"), maxes, 2.5), "squat", 2.5, "kg")[0].kg, 72.5);
  const t = get("stronglifts-5x5");
  const run = simulate(t, { maxes, sessions: 7 });
  assert.ok(run.final.day > 0, "seven sessions of a three-day week ends mid-week");
  const snaps = [snap(initState(t, maxes, 2.5)), ...run.states.map(snap)];
  const sf = soFarSeries(t, snaps, "squat", 2.5);
  const p = plannedSeries(t, run.final, "squat", 2.5, "kg");
  assert.deepEqual(p[0], sf.at(-1), "mid-week: planned starts at the so-far end");
  assert.deepEqual(p[0], { week: 3, kg: 67.5 });
}

// Smolov: the planned top set each week; it does not need a session to show
{
  const t = get("smolov-base");
  const s = initState(t, { squat: 100 }, 2.5);
  const p = plannedSeries(t, s, "squat", 2.5, "kg");
  // week 4 is a single test day, which has no planned top set, so the line has three points
  assert.deepEqual(p, [{ week: 1, kg: 85 }, { week: 2, kg: 95 }, { week: 3, kg: 100 }]);
}

// pounds: the planned values follow the member's step
{
  const t = get("531-bbb");
  const s = initState(t, { squat: 100, bench: 80, deadlift: 120, press: 50 }, 2.26796);
  const p = plannedSeries(t, s, "squat", 2.26796, "lb");
  assert.ok(Math.abs(p.at(-1)!.kg - (100 + 2 * 4.536)) < 0.01, "5/3/1 rises 10 lb a cycle for a pounds member");
}

// day one: one so-far point
{
  const t = get("531-bbb");
  const s = initState(t, { squat: 100, bench: 80, deadlift: 120, press: 50 }, 2.5);
  assert.deepEqual(soFarSeries(t, [snap(s)], "squat", 2.5), [{ week: 1, kg: 100 }]);
}

// + sets
assert.equal(hasPlusSets(get("531-bbb")), true);
assert.equal(hasPlusSets(get("stronglifts-5x5")), false, "StrongLifts is five fixed sets of five: no AMRAP, no drives");
{
  const plan = (amrap: boolean) => ({ index: 0, name: "Back squat", lift: "squat" as const, tier: null, stateKey: "back squat", bodyweight: false, progresses: false, joined: false, notes: null, sets: [{ kg: 85, reps: 5, repsMax: null, amrap: false, rpe: null, pct: 0.85, rest: 180, drives: false }, { kg: 95, reps: 5, repsMax: null, amrap, rpe: null, pct: 0.95, rest: 180, drives: false }] });
  const rows = plusSetRows(
    [
      { session: 1, at: 1, week: 1, plan: plan(true), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 8, done: true }] },
      { session: 2, at: 2, week: 2, plan: plan(true), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 6, done: true }] },
      { session: 3, at: 3, week: 2, plan: plan(false), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 5, done: true }] },
    ],
    true,
    (kg) => `${kg} kg`,
  );
  assert.deepEqual(rows.map((r) => [r.week, r.planned, r.got]), [[2, "95% x 5+", "95 kg x 6"], [1, "95% x 5+", "95 kg x 8"]], "only + sets, newest first");
  const tops = plusSetRows([{ session: 3, at: 3, week: 2, plan: plan(false), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 5, done: true }, { kg: 100, reps: 3, done: false }] }], false, (kg) => `${kg} kg`);
  assert.deepEqual(tops.map((r) => r.got), ["95 kg x 5"], "top set = heaviest DONE set");
  const chin = { ...plan(true), name: "Chin-up", lift: null, bodyweight: true, sets: [{ kg: null, reps: 5, repsMax: null, amrap: true, rpe: null, pct: null, rest: 120, drives: false }] };
  const bw = plusSetRows([{ session: 4, at: 4, week: 3, plan: chin, sets: [{ kg: null, reps: 9, done: true }] }], true, (kg) => `${kg} kg`);
  assert.deepEqual(bw.map((r) => [r.lift, r.planned, r.got]), [["Chin-up", "5+", "Bodyweight x 9"]], "a bodyweight + set is kept");
}

// GZCLP: the chart plots the main (T1) lift, not the lighter T2 that comes first in the week
{
  const t = get("gzclp");
  const s = initState(t, { squat: 100, bench: 80, deadlift: 120, press: 50 }, 2.5);
  const t1 = s.weights["t1:bench press"];
  const t2 = s.weights["t2:bench press"];
  assert.ok(t1 !== undefined && t2 !== undefined && t1 !== t2, "bench has a T1 and a different T2 weight");
  assert.equal(liftValue(t, s, "bench", 2.5), t1, "the bench chart value is the T1 bench weight");
  assert.equal(liftValue(t, s, "squat", 2.5), s.weights["t1:back squat"]);
  const series = liftSeries(t, [snap(s)], s, 2.5, "kg").find((l) => l.lift === "bench")!;
  assert.equal(series.soFar[0].kg, t1);
  assert.equal(series.planned[0].kg, t1, "the plan starts at the T1 weight too");
}

// Smolov: a fixed block keeps its chart in the test week and after the test
{
  const t = get("smolov-base");
  const maxes = { squat: 100 };
  const initial = initState(t, maxes, 2.5);
  const week3 = simulate(t, { maxes, sessions: 12 });
  assert.equal(week3.final.week, 3, "twelve sessions put the member on the test week");
  assert.equal(week3.final.finished, false);
  assert.equal(liftValue(t, week3.final, "squat", 2.5), null, "the test day plans no top set");
  const snapsAtTest = [snap(initial), ...week3.states.map(snap)];
  const atTest = liftSeries(t, snapsAtTest, week3.final, 2.5, "kg");
  assert.deepEqual(atTest.map((l) => l.lift), ["squat"], "the squat chart is still drawn in the test week");
  assert.equal(atTest[0].soFar.at(-1)!.week, 3);
  assert.deepEqual(atTest[0].planned, [], "nothing is planned for the test day");

  const done = simulate(t, { maxes, sessions: 13 });
  assert.equal(done.final.finished, true);
  const tested = done.final.testMaxes.squat;
  assert.ok(tested !== undefined, "the test set a max");
  const snapsDone = [snap(initial), ...done.states.map(snap)];
  const afterTest = liftSeries(t, snapsDone, done.final, 2.5, "kg");
  assert.deepEqual(afterTest.map((l) => l.lift), ["squat"], "and after the test");
  assert.deepEqual(afterTest[0].soFar.at(-1), { week: 4, kg: roundToStep(tested!, 2.5) }, "the last so-far point is the test max, in the test week");
  assert.ok(afterTest[0].soFar.length > 1, "the weeks before are kept");
  assert.equal(soFarSeries(t, snapsDone, "squat", 2.5).at(-1)!.week, 3, "without the finished state the series stops at the last planned week");
  assert.deepEqual(afterTest[0].planned, [], "a finished block plans nothing more");
  // a progressing program never reads the test max
  const sl = get("stronglifts-5x5");
  assert.deepEqual(soFarSeries(sl, [snap(initState(sl, { squat: 100, bench: 80, row: 70, press: 50, deadlift: 120 }, 2.5))], "squat", 2.5, { ...emptyState(), finished: true, testMaxes: { squat: 999 } }), [{ week: 1, kg: 50 }]);
}

// the series after round 1: the so-far line starts at the round's first week, a carried value held there
assert.deepEqual(inRound([{ week: 1, kg: 100 }, { week: 5, kg: 105 }], 1), [{ week: 1, kg: 100 }, { week: 5, kg: 105 }]);
assert.deepEqual(inRound([{ week: 1, kg: 100 }, { week: 5, kg: 105 }, { week: 14, kg: 110 }], 13), [{ week: 13, kg: 105 }, { week: 14, kg: 110 }], "the value carried into the round starts it");
assert.deepEqual(inRound([{ week: 1, kg: 100 }, { week: 13, kg: 105 }], 13), [{ week: 13, kg: 105 }], "a point on the first week is kept as it is");
assert.deepEqual(inRound([{ week: 1, kg: 100 }], 13), [{ week: 13, kg: 100 }], "no change yet this round: the carried value alone");

// a program without lifts (PHUL, PPL and so on): each session's first weighted exercise is its top-set row
{
  const ex = (name: string) => ({ index: 0, name, lift: null, tier: null, stateKey: name, bodyweight: false, progresses: true, joined: false, notes: null, sets: [{ kg: 60, reps: 8, repsMax: 10, amrap: false, rpe: null, pct: null, rest: 120, drives: false }, { kg: 60, reps: 8, repsMax: 10, amrap: false, rpe: null, pct: null, rest: 120, drives: false }] });
  const rows = [
    { session: 1, at: 10, week: 1, plan: ex("Bench press"), sets: [{ kg: 60, reps: 8, done: false }, { kg: null, reps: null, done: false }] },
    { session: 1, at: 10, week: 1, plan: ex("Incline dumbbell press"), sets: [{ kg: 30, reps: 9, done: true }, { kg: 32, reps: 8, done: true }] },
    { session: 1, at: 10, week: 1, plan: ex("Cable row"), sets: [{ kg: 50, reps: 10, done: true }] },
    { session: 2, at: 20, week: 1, plan: ex("Bench press"), sets: [{ kg: 62.5, reps: 8, done: true }, { kg: 60, reps: 9, done: true }] },
    { session: 2, at: 20, week: 1, plan: ex("Cable row"), sets: [{ kg: 55, reps: 10, done: true }] },
  ];
  const f = (kg: number) => `${kg} kg`;
  assert.deepEqual(plusSetRows(rows, false, f, true), [], "with lifts, an exercise without a lift is not a row");
  const got = plusSetRows(rows, false, f, false);
  assert.deepEqual(got.map((r) => [r.at, r.lift, r.got]), [[20, "Bench press", "62.5 kg x 8"], [10, "Incline dumbbell press", "32 kg x 8"]], "one row per session: its first exercise with a weight done, the heaviest set");
}

console.log("programs/progressSeries: ok");
