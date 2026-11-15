// Run: npm test -- src/lib/programs/progressSeries.test.ts
import assert from "node:assert/strict";

import { initState } from "./engines";
import { platformProgram } from "./registry";
import { CHART_LABEL, chartKind, chartLifts, hasPlusSets, liftValue, plannedSeries, plusSetRows, soFarSeries, type Snapshot } from "./progressSeries";
import { simulate } from "./simulate";

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
  assert.deepEqual(chartLifts(t, s, 2.5), ["press", "deadlift", "bench", "squat"]);
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
      { at: 1, week: 1, plan: plan(true), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 8, done: true }] },
      { at: 2, week: 2, plan: plan(true), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 6, done: true }] },
      { at: 3, week: 2, plan: plan(false), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 5, done: true }] },
    ],
    true,
    (kg) => `${kg} kg`,
  );
  assert.deepEqual(rows.map((r) => [r.week, r.planned, r.got]), [[2, "95% x 5+", "95 kg x 6"], [1, "95% x 5+", "95 kg x 8"]], "only + sets, newest first");
  const tops = plusSetRows([{ at: 3, week: 2, plan: plan(false), sets: [{ kg: 85, reps: 5, done: true }, { kg: 95, reps: 5, done: true }, { kg: 100, reps: 3, done: false }] }], false, (kg) => `${kg} kg`);
  assert.deepEqual(tops.map((r) => r.got), ["95 kg x 5"], "top set = heaviest DONE set");
  const chin = { ...plan(true), name: "Chin-up", lift: null, bodyweight: true, sets: [{ kg: null, reps: 5, repsMax: null, amrap: true, rpe: null, pct: null, rest: 120, drives: false }] };
  const bw = plusSetRows([{ at: 4, week: 3, plan: chin, sets: [{ kg: null, reps: 9, done: true }] }], true, (kg) => `${kg} kg`);
  assert.deepEqual(bw.map((r) => [r.lift, r.planned, r.got]), [["Chin-up", "5+", "Bodyweight x 9"]], "a bodyweight + set is kept");
}

console.log("programs/progressSeries: ok");
