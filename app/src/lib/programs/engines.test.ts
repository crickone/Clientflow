// app/src/lib/programs/engines.test.ts
// Run: npm test -- src/lib/programs/engines.test.ts
//
// Each engine is a pure function (state, template, session results) -> (new
// state, reasons). Covers: all reps hit, a missed set, three misses in a row,
// AMRAP scoring, the end of a cycle, and test day, for all five engines.
import assert from "node:assert/strict";

import { amrap, day, ex, fixed, maxTest, pct, range, sxr, times, week } from "./dsl";
import { initState, progress, skipSession, skipState } from "./engines";
import { planSession } from "./planner";
import type { DoneSet, EngineState, PlannedSet, ProgramTemplate, SessionResult, WeightUnit } from "./types";

type Perform = (name: string, i: number, p: PlannedSet) => DoneSet;

const base = {
  author: "Test",
  family: "strength" as const,
  level: "beginner" as const,
  daysPerWeek: 1,
  lengthWeeks: 1,
  tmPct: 1,
  who: "Testers.",
  description: "Test.",
};

function run(t: ProgramTemplate, state: EngineState, perform: Perform) {
  const session = planSession(t, state, { stepKg: 2.5 });
  assert.ok(session, "there is a session to run");
  const result: SessionResult = { exercises: session.exercises.map((e) => ({ planned: e, sets: e.sets.map((s, i) => perform(e.name, i, s)) })) };
  return progress({ template: t, state, result, stepKg: 2.5, unit: "kg" });
}

const asPlanned: Perform = (_n, _i, s) => ({ kg: s.kg, reps: s.amrap ? s.reps + 2 : s.repsMax ?? s.reps, done: true });

// ── 1. Linear with deloads ────────────────────────────────────────────────
const lin: ProgramTemplate = {
  ...base,
  key: "lin",
  name: "Lin",
  lifts: ["squat", "deadlift"],
  engine: { key: "linear", increment: 2.5, increments: { deadlift: 5 }, deloadAfter: 3, deloadPct: 0.1, startPct: 0.5 },
  weeks: [week([day("A", [ex("Back squat", times(5, fixed(5)), { lift: "squat" }), ex("Deadlift", [fixed(5)], { lift: "deadlift" })])])],
};
const l0 = initState(lin, { squat: 200, deadlift: 200 }, 2.5);
assert.equal(l0.weights["back squat"], 100);
assert.equal(l0.weights["deadlift"], 100);
assert.equal(l0.tms.squat, 200);

// all reps hit: +2.5 kg, +5 kg on the deadlift
const l1 = run(lin, l0, asPlanned);
assert.equal(l1.state.weights["back squat"], 102.5);
assert.equal(l1.state.weights["deadlift"], 105);
assert.ok(l1.reasons.includes("Next back squat 102.5 kg. You did all 5 sets of 5."));
assert.ok(l1.reasons.includes("Next deadlift 105 kg. You did your set of 5."));
assert.equal(l1.state.cycle, 1, "a one-day template wraps to the next cycle");

// a missed set: the weight stays
const missSet4: Perform = (n, i, p) => (n === "Back squat" && i === 3 ? { kg: p.kg, reps: 3, done: true } : asPlanned(n, i, p));
const m1 = run(lin, l1.state, missSet4);
assert.equal(m1.state.weights["back squat"], 102.5);
assert.equal(m1.state.misses["back squat"], 1);
assert.ok(m1.reasons.includes("Back squat stays at 102.5 kg. You got 3 of 5 on set 4. Try it again next time."));

// three misses in a row: 10% lighter
const m2 = run(lin, m1.state, missSet4);
const m3 = run(lin, m2.state, missSet4);
assert.equal(m3.state.weights["back squat"], 92.5);
assert.equal(m3.state.misses["back squat"], 0);
assert.ok(m3.reasons.includes("Next back squat 92.5 kg, 10% lighter. You missed reps three sessions in a row."));

// an unticked set is a miss too
const unticked = run(lin, l1.state, (n, i, p) => (n === "Deadlift" ? { kg: p.kg, reps: null, done: false } : asPlanned(n, i, p)));
assert.ok(unticked.reasons.includes("Deadlift stays at 105 kg. Set 1 wasn't ticked. Try it again next time."));

// the weight actually lifted counts
const heavier = run(lin, l1.state, (n, _i, p) => ({ kg: n === "Back squat" ? 110 : p.kg, reps: p.reps, done: true }));
assert.equal(heavier.state.weights["back squat"], 112.5);

// AMRAP scoring (Greyskull): 10+ reps doubles the jump; any miss resets 10%
const gs: ProgramTemplate = {
  ...base,
  key: "gs",
  name: "Gs",
  lifts: ["squat"],
  engine: { key: "linear", increment: 1.25, increments: { squat: 2.5 }, deloadAfter: 1, deloadPct: 0.1, startPct: 0.5, doubleAt: 10 },
  weeks: [week([day("A", [ex("Back squat", [fixed(5), fixed(5), fixed(5, 180, true)], { lift: "squat" })])])],
};
const g0 = initState(gs, { squat: 200 }, 2.5);
const big = run(gs, g0, (_n, i, p) => ({ kg: p.kg, reps: i === 2 ? 12 : 5, done: true }));
assert.equal(big.state.weights["back squat"], 105);
assert.ok(big.reasons.includes("Next back squat 105 kg. You got 12 on the last set, so it goes up twice as much."));
const small = run(gs, g0, (_n, i, p) => ({ kg: p.kg, reps: i === 2 ? 4 : 5, done: true }));
assert.equal(small.state.weights["back squat"], 90);
assert.ok(small.reasons.includes("Next back squat 90 kg, 10% lighter. You got 4 of 5 on set 3."));

// ── 2. Training-max cycles ────────────────────────────────────────────────
// 2a. cycle rule (5/3/1): + sets are scored; the training max rises at the end of the cycle
const wave = (a: number, b: number, c: number, reps: number, plus = true) =>
  ex("Bench press", [pct(a, reps), pct(b, reps), plus ? amrap(c, reps) : pct(c, reps)], { lift: "bench" });
const cyc: ProgramTemplate = {
  ...base,
  key: "cyc",
  name: "Cyc",
  lifts: ["bench"],
  tmPct: 0.9,
  engine: { key: "tm_cycle", rule: "cycle", increment: 2.5, increments: { squat: 5 } },
  weeks: [week([day("Bench", [wave(0.65, 0.75, 0.85, 5)])]), week([day("Deload", [wave(0.4, 0.5, 0.6, 5, false)])])],
};
const c0 = initState(cyc, { bench: 111.11 }, 2.5);
assert.equal(c0.tms.bench, 100);
const c1 = run(cyc, c0, (_n, i, p) => ({ kg: p.kg, reps: i === 2 ? 7 : 5, done: true }));
assert.deepEqual(c1.reasons, ["Bench press: 7 reps on the 5+ set."]);
assert.equal(c1.state.tms.bench, 100, "no change inside the cycle");
assert.equal(c1.state.week, 1);
const c2 = run(cyc, c1.state, asPlanned);
assert.equal(c2.state.tms.bench, 102.5);
assert.ok(c2.reasons.includes("Bench press training max goes up to 102.5 kg for the next cycle."));
assert.equal(c2.state.cycle, 1);
assert.equal(c2.state.week, 0);
// short on a + set: the training max holds at the end of the cycle
const s1 = run(cyc, c0, (_n, i, p) => ({ kg: p.kg, reps: i === 2 ? 3 : 5, done: true }));
assert.equal(s1.state.short.bench, true);
const s2 = run(cyc, s1.state, asPlanned);
assert.equal(s2.state.tms.bench, 100);
assert.ok(s2.reasons.includes("Bench press training max stays at 100 kg. You fell short on a + set this cycle."));
assert.deepEqual(s2.state.short, {});

// 2b. amrap_table rule (nSuns): the driving 1+ set moves the training max by the table
const tab: ProgramTemplate = {
  ...base,
  key: "tab",
  name: "Tab",
  lifts: ["squat"],
  tmPct: 0.9,
  engine: {
    key: "tm_cycle",
    rule: "amrap_table",
    increment: 0,
    amrapTable: [
      { minReps: 0, kg: 0 },
      { minReps: 2, kg: 2.5 },
      { minReps: 4, kg: 5 },
      { minReps: 6, kg: 7.5 },
    ],
  },
  weeks: [week([day("Squat", [ex("Back squat", [pct(0.75, 5), amrap(0.95, 1, 180, { drives: true }), amrap(0.65, 5)], { lift: "squat" })])])],
};
const t0 = initState(tab, { squat: 111.11 }, 2.5);
const t3reps = run(tab, t0, (_n, i, p) => ({ kg: p.kg, reps: i === 1 ? 3 : p.reps, done: true }));
assert.equal(t3reps.state.tms.squat, 102.5);
assert.ok(t3reps.reasons.includes("Squat training max goes up to 102.5 kg. You got 3 on the 1+ set."));
const t1rep = run(tab, t0, (_n, i, p) => ({ kg: p.kg, reps: i === 1 ? 1 : p.reps, done: true }));
assert.equal(t1rep.state.tms.squat, 100);
assert.ok(t1rep.reasons.includes("Squat training max stays at 100 kg. You got 1 on the 1+ set."));
assert.equal(run(tab, t0, (_n, i, p) => ({ kg: p.kg, reps: i === 1 ? 6 : p.reps, done: true })).state.tms.squat, 107.5);

// 2c. drive_set rule (Texas Method): the top set completed raises the training max
const tex: ProgramTemplate = {
  ...base,
  key: "tex",
  name: "Tex",
  lifts: ["squat"],
  tmPct: 6 / 7,
  engine: { key: "tm_cycle", rule: "drive_set", increment: 2.5 },
  weeks: [week([day("Intensity", [ex("Back squat", [pct(1, 5, 300, { drives: true })], { lift: "squat" })])])],
};
const x0 = initState(tex, { squat: 116.67 }, 2.5);
assert.equal(x0.tms.squat, 100);
const x1 = run(tex, x0, asPlanned);
assert.equal(x1.state.tms.squat, 102.5);
assert.ok(x1.reasons.includes("Squat training max goes up to 102.5 kg. You got all 5 reps on your top set."));
const x2 = run(tex, x0, (_n, _i, p) => ({ kg: p.kg, reps: 4, done: true }));
assert.equal(x2.state.tms.squat, 100);
assert.ok(x2.reasons.includes("Squat training max stays at 100 kg. You got 4 of 5 on your top set."));

// 2d. gzclp rule: a failed lift moves to its next rep scheme
const T1 = [
  [...times(4, fixed(3, 180)), fixed(3, 180, true)],
  [...times(5, fixed(2, 180)), fixed(2, 180, true)],
  [...times(9, fixed(1, 180)), fixed(1, 180, true)],
];
const T2 = [times(3, fixed(10, 120)), times(3, fixed(8, 120)), times(3, fixed(6, 120))];
const gz: ProgramTemplate = {
  ...base,
  key: "gz",
  name: "Gz",
  lifts: ["squat", "bench"],
  engine: { key: "tm_cycle", rule: "gzclp", increment: 2.5, increments: { squat: 5 }, t2ResetKg: 5, t3AmrapTarget: 25 },
  weeks: [
    week([
      day("A1", [
        ex("Back squat", T1[0], { lift: "squat", tier: "t1", stages: T1, startPct: 0.73 }),
        ex("Bench press", T2[0], { lift: "bench", tier: "t2", stages: T2, startPct: 0.55 }),
        ex("Lat pulldown", [fixed(15, 60), fixed(15, 60), fixed(15, 60, true)], { tier: "t3" }),
      ]),
    ]),
  ],
};
const z0 = initState(gz, { squat: 100, bench: 100 }, 2.5);
assert.equal(z0.weights["t1:back squat"], 72.5);
assert.equal(z0.weights["t2:bench press"], 55);
assert.equal(z0.t2Base["t2:bench press"], 55);
const gzPerfect: Perform = (_n, _i, p) => ({ kg: p.kg ?? 30, reps: p.amrap ? p.reps + 2 : p.reps, done: true });
const z1 = run(gz, z0, gzPerfect);
assert.equal(z1.state.weights["t1:back squat"], 77.5);
assert.ok(z1.reasons.includes("Next back squat 77.5 kg. You did every set."));
assert.equal(z1.state.weights["t3:lat pulldown"], 30, "a T3 weight is kept from the first log");
const failT1: Perform = (n, i, p) => ({ kg: p.kg ?? 30, reps: n === "Back squat" && i === 0 ? p.reps - 1 : p.reps, done: true });
const f1 = run(gz, z0, failT1);
assert.equal(f1.state.stages["t1:back squat"], 1);
assert.equal(f1.state.weights["t1:back squat"], 72.5);
assert.ok(f1.reasons.includes("Back squat moves to 6 x 2+ at 72.5 kg. You got 2 of 3 on set 1."));
const f2 = run(gz, f1.state, failT1);
assert.equal(f2.state.stages["t1:back squat"], 2);
const f3 = run(gz, f2.state, failT1);
assert.equal(f3.state.stages["t1:back squat"], 0);
assert.equal(f3.state.weights["t1:back squat"], 62.5);
assert.ok(f3.reasons.includes("Back squat goes back to 5 x 3+ at 62.5 kg, 85% of where it stalled."));
const failT2: Perform = (n, i, p) => ({ kg: p.kg ?? 30, reps: n === "Bench press" && i === 2 ? p.reps - 2 : p.reps, done: true });
const b1 = run(gz, z0, failT2);
assert.equal(b1.state.stages["t2:bench press"], 1);
const b3 = run(gz, run(gz, b1.state, failT2).state, failT2);
assert.equal(b3.state.stages["t2:bench press"], 0);
assert.equal(b3.state.weights["t2:bench press"], 60);
assert.ok(b3.reasons.includes("Bench press goes back to 3 x 10 at 60 kg."));
const t3up = run(gz, z1.state, (n, i, p) => ({ kg: p.kg ?? 30, reps: n === "Lat pulldown" && i === 2 ? 26 : p.reps, done: true }));
assert.equal(t3up.state.weights["t3:lat pulldown"], 32.5);
assert.ok(t3up.reasons.includes("Next lat pulldown 32.5 kg. You got 26 on the last set."));

// ── 3. Fixed block with re-test ───────────────────────────────────────────
const blk: ProgramTemplate = {
  ...base,
  key: "blk",
  name: "Blk",
  lifts: ["squat"],
  engine: { key: "fixed_block" },
  weeks: [week([day("Day 1", [ex("Back squat", sxr(4, 9, 0.7), { lift: "squat" })])]), week([day("Test day", [maxTest("Back squat", "squat")], true)])],
};
const k0 = initState(blk, { squat: 150 }, 2.5);
const k1 = run(blk, k0, asPlanned);
assert.deepEqual(k1.reasons, [], "no changes inside the block");
assert.deepEqual(k1.state.tms, k0.tms);
assert.equal(k1.state.week, 1);
const k2 = run(blk, k1.state, (_n, i, p) => ({ kg: i === 4 ? 160 : p.kg, reps: i === 4 ? 2 : p.reps, done: true }));
assert.equal(k2.state.testMaxes.squat, 170.67);
assert.equal(k2.state.finished, true);
assert.equal(k2.state.week, 1, "a finished block does not wrap");
assert.ok(k2.reasons.includes("Your new squat max is about 170 kg, from 160 kg x 2."));
assert.ok(k2.reasons.includes("Block done. Start it again from your new max when you're ready."));
assert.equal(planSession(blk, k2.state, { stepKg: 2.5 }), null);
const kNo = run(blk, k1.state, (_n, _i, p) => ({ kg: p.kg, reps: null, done: false }));
assert.ok(kNo.reasons.includes("No squat max from today. Enter one when you start again."));

// ── 4. Double progression ─────────────────────────────────────────────────
const dp: ProgramTemplate = {
  ...base,
  key: "dp",
  name: "Dp",
  lifts: [],
  engine: { key: "double_progression" },
  weeks: [
    week([
      day("Upper", [
        ex("Incline dumbbell press", times(3, fixed(range(8, 12), 90))),
        ex("Lateral raise", times(3, fixed(range(12, 15), 60)), { progress: false }),
      ]),
    ]),
  ],
};
const d0 = initState(dp, {}, 2.5);
const d1 = run(dp, d0, () => ({ kg: 30, reps: 10, done: true }));
assert.equal(d1.state.weights["incline dumbbell press@8-12"], 30);
assert.equal(d1.state.weights["lateral raise@12-15"], undefined);
assert.deepEqual(d1.reasons, ["Weights saved from today. Each one goes up when you reach the top of its rep range on every set."]);
const d2 = run(dp, d1.state, (_n, _i, p) => ({ kg: p.kg ?? 10, reps: p.repsMax ?? p.reps, done: true }));
assert.equal(d2.state.weights["incline dumbbell press@8-12"], 32.5);
assert.deepEqual(d2.reasons, ["Next incline dumbbell press 32.5 kg, back to 8 reps. You hit 12 on every set."]);
const d3 = run(dp, d2.state, (_n, i, p) => ({ kg: p.kg ?? 10, reps: i === 2 ? 11 : 12, done: true }));
assert.equal(d3.state.weights["incline dumbbell press@8-12"], 32.5);
assert.deepEqual(d3.reasons, []);

// ── 5. Fixed volume ───────────────────────────────────────────────────────
const gv: ProgramTemplate = {
  ...base,
  key: "gv",
  name: "Gv",
  lifts: ["bench"],
  engine: { key: "fixed_volume", increment: 2.5, startPct: 0.6 },
  weeks: [week([day("Chest", [ex("Bench press", times(10, fixed(10, 90)), { lift: "bench" })])])],
};
const v0 = initState(gv, { bench: 100 }, 2.5);
assert.equal(v0.weights["bench press"], 60);
const v1 = run(gv, v0, asPlanned);
assert.equal(v1.state.weights["bench press"], 62.5);
assert.ok(v1.reasons.includes("Next bench press 62.5 kg. You did all 100 reps."));
const v2 = run(gv, v0, (_n, i, p) => ({ kg: p.kg, reps: i >= 7 ? 6 : 10, done: true }));
assert.equal(v2.state.weights["bench press"], 60);
assert.ok(v2.reasons.includes("Bench press stays at 60 kg. You did 88 of 100 reps."));

// ── skipping ──────────────────────────────────────────────────────────────
assert.equal(skipState(blk, k1.state).finished, true, "skipping the last block session finishes it");
const skipped = skipState(cyc, c0);
assert.equal(skipped.week, 1);
assert.equal(skipped.tms.bench, 100, "a skip runs no engine");

// ── a lighter bar never goes below 20 kg ─────────────────────────────────
assert.equal(initState(lin, { squat: 30, deadlift: 30 }, 2.5).weights["back squat"], 20);

// ── review fixes ──────────────────────────────────────────────────────────
// Each check runs on its own so a failure names the case.
interface RunOpts {
  stepKg?: number;
  unit?: WeightUnit;
  /** Extra sets logged after the planned ones, by exercise name. */
  extra?: Record<string, DoneSet[]>;
}
function runWith(t: ProgramTemplate, state: EngineState, perform: Perform, o: RunOpts = {}) {
  const stepKg = o.stepKg ?? 2.5;
  const session = planSession(t, state, { stepKg });
  assert.ok(session, "there is a session to run");
  const result: SessionResult = {
    exercises: session.exercises.map((e) => ({ planned: e, sets: [...e.sets.map((s, i) => perform(e.name, i, s)), ...(o.extra?.[e.name] ?? [])] })),
  };
  return progress({ template: t, state, result, stepKg, unit: o.unit ?? "kg" });
}

const fixChecks: [string, () => void][] = [
  [
    "1a. an extra lighter back-off set does not drag the linear weight down",
    () => {
      const o = runWith(lin, l0, asPlanned, { extra: { "Back squat": [{ kg: 60, reps: 10, done: true }] } });
      assert.equal(o.state.weights["back squat"], 102.5);
      assert.ok(o.reasons.includes("Next back squat 102.5 kg. You did all 5 sets of 5."));
    },
  ],
  [
    "1b. fixed volume counts each planned set, not a total across extra sets",
    () => {
      const o = runWith(gv, v0, (_n, i, p) => ({ kg: p.kg, reps: i === 9 ? 5 : 10, done: true }), {
        extra: { "Bench press": [{ kg: 20, reps: 10, done: true }] },
      });
      assert.equal(o.state.weights["bench press"], 60);
      assert.ok(o.reasons.includes("Bench press stays at 60 kg. You did 95 of 100 reps."));
    },
  ],
  [
    "1c. fixed volume: extra reps on one set do not cover a short set",
    () => {
      const o = runWith(gv, v0, (_n, i, p) => ({ kg: p.kg, reps: i === 0 ? 15 : i === 9 ? 5 : 10, done: true }));
      assert.equal(o.state.weights["bench press"], 60);
      assert.ok(o.reasons.includes("Bench press stays at 60 kg. You did 95 of 100 reps."));
    },
  ],
  [
    "2. 5/3/1: a + set not logged holds the training max at the end of the cycle",
    () => {
      const none: Perform = (_n, _i, p) => ({ kg: p.kg, reps: null, done: false });
      const n1 = runWith(cyc, c0, none);
      assert.equal(n1.state.short.bench, true);
      assert.ok(n1.reasons.includes("Bench press: the 5+ set wasn't logged."));
      const n2 = runWith(cyc, n1.state, none);
      assert.equal(n2.state.tms.bench, 100);
      assert.ok(n2.reasons.includes("Bench press training max stays at 100 kg. A + set wasn't logged this cycle."));
      assert.deepEqual(n2.state.short, {});
      assert.equal(n2.state.misses["short:bench"], undefined, "the cause is cleared for the new cycle");
    },
  ],
  [
    "3a. skipping the last session of a cycle still raises the training max",
    () => {
      const k1 = runWith(cyc, c0, asPlanned);
      const k2 = skipSession(cyc, k1.state, "kg");
      assert.equal(k2.state.tms.bench, 102.5);
      assert.equal(k2.state.cycle, 1);
      assert.equal(k2.state.week, 0);
      assert.ok(k2.reasons.includes("Bench press training max goes up to 102.5 kg for the next cycle."));
      assert.equal(skipState(cyc, k1.state).tms.bench, 102.5, "skipState runs the same step");
    },
  ],
  [
    "3b. skipping the last session after a short + set holds the max and clears short",
    () => {
      const k1 = runWith(cyc, c0, (_n, i, p) => ({ kg: p.kg, reps: i === 2 ? 2 : 5, done: true }));
      const k2 = skipState(cyc, k1.state);
      assert.equal(k2.tms.bench, 100);
      assert.deepEqual(k2.short, {});
      assert.equal(k2.cycle, 1);
    },
  ],
  [
    "4a. nSuns: a 1+ set done far lighter does not move the training max",
    () => {
      const o = runWith(tab, t0, (_n, i, p) => ({ kg: i === 1 ? 40 : p.kg, reps: i === 1 ? 8 : p.reps, done: true }));
      assert.equal(o.state.tms.squat, 100);
      assert.ok(o.reasons.includes("Squat training max stays at 100 kg. The 1+ set was lighter than planned."));
    },
  ],
  [
    "4b. nSuns: one smallest jump lighter still counts",
    () => {
      const o = runWith(tab, t0, (_n, i, p) => ({ kg: i === 1 && p.kg !== null ? p.kg - 2.5 : p.kg, reps: i === 1 ? 3 : p.reps, done: true }));
      assert.equal(o.state.tms.squat, 102.5);
    },
  ],
  [
    "4c. Texas: a lighter top set does not move the training max",
    () => {
      const o = runWith(tex, x0, (_n, _i, p) => ({ kg: (p.kg ?? 0) - 10, reps: 5, done: true }));
      assert.equal(o.state.tms.squat, 100);
      assert.ok(o.reasons.includes("Squat training max stays at 100 kg. The top set was lighter than planned."));
      const ok = runWith(tex, x0, (_n, _i, p) => ({ kg: (p.kg ?? 0) - 2.5, reps: 5, done: true }));
      assert.equal(ok.state.tms.squat, 102.5);
    },
  ],
  [
    "4d. 5/3/1: a lighter + set holds the training max at the end of the cycle",
    () => {
      const k1 = runWith(cyc, c0, (_n, i, p) => ({ kg: i === 2 ? (p.kg ?? 0) - 5 : p.kg, reps: i === 2 ? 7 : 5, done: true }));
      assert.equal(k1.state.short.bench, true);
      assert.ok(k1.reasons.includes("Bench press: 7 reps on the 5+ set, lighter than planned."));
      const k2 = runWith(cyc, k1.state, asPlanned);
      assert.equal(k2.state.tms.bench, 100);
      assert.ok(k2.reasons.includes("Bench press training max stays at 100 kg. A + set was lighter than planned this cycle."));
      const near = runWith(cyc, c0, (_n, i, p) => ({ kg: i === 2 ? (p.kg ?? 0) - 2.5 : p.kg, reps: i === 2 ? 7 : 5, done: true }));
      assert.equal(near.state.short.bench, undefined, "one smallest jump lighter still counts");
    },
  ],
  [
    "5a. double progression: a changed weight below the top of the range says so",
    () => {
      const o = runWith(dp, d1.state, () => ({ kg: 32.5, reps: 10, done: true }));
      assert.equal(o.state.weights["incline dumbbell press@8-12"], 32.5);
      assert.deepEqual(o.reasons, ["Next incline dumbbell press 32.5 kg, the weight you used."]);
    },
  ],
  [
    "5b. GZCLP T3: a replaced weight carries a reason",
    () => {
      const o = runWith(gz, z1.state, (n, _i, p) => ({ kg: n === "Lat pulldown" ? 35 : p.kg ?? 30, reps: p.reps, done: true }));
      assert.equal(o.state.weights["t3:lat pulldown"], 35);
      assert.ok(o.reasons.includes("Next lat pulldown 35 kg, the weight you used."));
    },
  ],
  [
    "5c. linear miss at a changed weight names that weight and the miss",
    () => {
      const o = runWith(lin, l1.state, (n, i, p) => (n === "Back squat" ? { kg: 110, reps: i === 3 ? 3 : 5, done: true } : asPlanned(n, i, p)));
      assert.equal(o.state.weights["back squat"], 110);
      assert.ok(o.reasons.includes("Next back squat 110 kg, the weight you used. You got 3 of 5 on set 4."));
      assert.ok(!o.reasons.some((x) => x.startsWith("Back squat stays at")), "no stays-at sentence with a changed number");
    },
  ],
  [
    "6a. a linear deload never goes below the 20 kg bar",
    () => {
      const st: EngineState = { ...l0, weights: { ...l0.weights, "back squat": 20 }, misses: { "back squat": 2 } };
      const o = runWith(lin, st, (n, i, p) => (n === "Back squat" ? { kg: 20, reps: 3, done: true } : asPlanned(n, i, p)));
      assert.equal(o.state.weights["back squat"], 20);
      assert.ok(o.reasons.includes("Back squat stays at 20 kg, the empty bar. You missed reps three sessions in a row."));
    },
  ],
  [
    "6b. the GZCLP 85% reset never goes below the 20 kg bar",
    () => {
      const st: EngineState = { ...z0, weights: { ...z0.weights, "t1:back squat": 20 }, stages: { "t1:back squat": 2 } };
      const o = runWith(gz, st, failT1);
      assert.equal(o.state.weights["t1:back squat"], 20);
      assert.equal(o.state.stages["t1:back squat"], 0);
      assert.ok(o.reasons.includes("Back squat goes back to 5 x 3+ at 20 kg, the empty bar."));
    },
  ],
  [
    "6c. the bar floor rounds to a 5 lb step",
    () => {
      const step = 2.26796;
      const st: EngineState = { ...l0, weights: { ...l0.weights, "back squat": 22.68 }, misses: { "back squat": 2 } };
      const o = runWith(lin, st, (n, i, p) => (n === "Back squat" ? { kg: 20.412, reps: 3, done: true } : asPlanned(n, i, p)), { stepKg: step, unit: "lb" });
      assert.equal(o.state.weights["back squat"], 20.412);
      assert.ok(o.reasons.includes("Next back squat 45 lb, the empty bar. You missed reps three sessions in a row."));
    },
  ],
  [
    "7. a fixed block with no test day does not mention a new max",
    () => {
      const noTest: ProgramTemplate = { ...blk, key: "blk2", weeks: [blk.weeks[0]] };
      const o = runWith(noTest, initState(noTest, { squat: 150 }, 2.5), asPlanned);
      assert.equal(o.state.finished, true);
      assert.deepEqual(o.reasons, ["Block done. You can start it again."]);
    },
  ],
  [
    "8. double progression with no planned sets leaves the state alone",
    () => {
      const session = planSession(dp, d1.state, { stepKg: 2.5 });
      assert.ok(session);
      const result: SessionResult = { exercises: session.exercises.map((e) => ({ planned: { ...e, sets: [] }, sets: [{ kg: 40, reps: 12, done: true }] })) };
      const o = progress({ template: dp, state: d1.state, result, stepKg: 2.5, unit: "kg" });
      assert.deepEqual(o.state.weights, d1.state.weights);
      assert.deepEqual(o.reasons, []);
    },
  ],
  [
    "a 1.25 kg step goes up by the program's increment",
    () => {
      const s0 = initState(lin, { squat: 201, deadlift: 200 }, 1.25);
      assert.equal(s0.weights["back squat"], 100);
      const o = runWith(lin, s0, asPlanned, { stepKg: 1.25 });
      assert.equal(o.state.weights["back squat"], 102.5);
      const dp1 = runWith(dp, d1.state, (_n, _i, p) => ({ kg: p.kg ?? 10, reps: p.repsMax ?? p.reps, done: true }), { stepKg: 1.25 });
      assert.equal(dp1.state.weights["incline dumbbell press@8-12"], 31.25, "double progression goes up by the smallest jump");
    },
  ],
  [
    "a 5 lb step rounds every weight to 5 lb and reasons read in lb",
    () => {
      const step = 2.26796;
      const s0 = initState(lin, { squat: 100, deadlift: 100 }, step);
      assert.equal(s0.weights["back squat"], 49.895);
      const o = runWith(lin, s0, asPlanned, { stepKg: step, unit: "lb" });
      assert.equal(o.state.weights["back squat"], 52.163);
      assert.ok(o.reasons.includes("Next back squat 115 lb. You did all 5 sets of 5."));
      const m = runWith(lin, o.state, missSet4, { stepKg: step, unit: "lb" });
      assert.ok(m.reasons.includes("Back squat stays at 115 lb. You got 3 of 5 on set 4. Try it again next time."));
      const tmLb = runWith(tex, x0, asPlanned, { stepKg: step, unit: "lb" });
      assert.ok(tmLb.reasons.includes("Squat training max goes up to 225 lb. You got all 5 reps on your top set."));
      assert.equal(tmLb.state.tms.squat, Math.round((x0.tms.squat! + 2.268) * 100) / 100, "a pounds member's training max goes up 5 lb, not 2.5 kg");
    },
  ],
  [
    "miss, hit, miss: the miss counter resets after a success",
    () => {
      const a = run(lin, l1.state, missSet4);
      const b = run(lin, a.state, missSet4);
      assert.equal(b.state.misses["back squat"], 2);
      const hit = run(lin, b.state, asPlanned);
      assert.equal(hit.state.misses["back squat"], 0);
      const c = run(lin, hit.state, missSet4);
      assert.equal(c.state.misses["back squat"], 1);
      assert.equal(c.state.weights["back squat"], hit.state.weights["back squat"], "no deload");
    },
  ],
  [
    "progress() leaves its input deeply unchanged",
    () => {
      for (const [t, st] of [
        [lin, l1.state],
        [cyc, c1.state],
        [gz, z1.state],
        [dp, d1.state],
        [gv, v0],
        [blk, k1.state],
      ] as [ProgramTemplate, EngineState][]) {
        const before = structuredClone(st);
        const session = planSession(t, st, { stepKg: 2.5 });
        assert.ok(session);
        const result: SessionResult = { exercises: session.exercises.map((e) => ({ planned: e, sets: e.sets.map(() => ({ kg: 40, reps: 3, done: true })) })) };
        const resultBefore = structuredClone(result);
        progress({ template: t, state: st, result, stepKg: 2.5, unit: "kg" });
        skipSession(t, st, "kg");
        assert.deepEqual(st, before, `${t.key}: state unchanged`);
        assert.deepEqual(result, resultBefore, `${t.key}: result unchanged`);
      }
    },
  ],
];

const fixFailures: string[] = [];
for (const [name, fn] of fixChecks) {
  try {
    fn();
  } catch (e) {
    fixFailures.push(`${name}: ${(e as Error).message.split("\n")[0]}`);
  }
}
assert.deepEqual(fixFailures, [], `failing checks:\n${fixFailures.join("\n")}`);

console.log("programs/engines: ok");
