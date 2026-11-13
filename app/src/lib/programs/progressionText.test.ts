// app/src/lib/programs/progressionText.test.ts
// Run: npm test -- src/lib/programs/progressionText.test.ts
//
// "How your weights move" for every platform program (kg and lb) and for
// every own rule: plain sentences with the real numbers and nothing undefined.
import assert from "node:assert/strict";

import { listText } from "./content";
import { initState, progress, skipSession } from "./engines";
import { applyRule, newExercise } from "./memberEditing";
import { blankMemberTemplate } from "./memberTemplate";
import { howWeightsMove, ruleSentence } from "./progressionText";
import { PLATFORM_PROGRAMS, platformProgram } from "./registry";
import { nsunsStyle } from "./templates/nsuns";
import { planSession } from "./planner";
import { LIFT_LABEL, type EngineState, type ExerciseRx, type LiftKey, type ProgramTemplate, type WeightUnit } from "./types";
import { STEP_5LB_KG, formatWeight, roundToStep } from "./units";

const get = (key: string) => platformProgram(key)!;

/** Change a logged set from the plan: return what the member did instead. */
type Hook = (name: string, setIdx: number, planned: { reps: number; repsMax: number | null; kg: number | null }) => { kg?: number | null; reps?: number | null; done?: boolean } | undefined;
/** Finish the session at the state's position with the REAL planner and engine: every set as planned unless the hook says otherwise. */
function finish(t: ProgramTemplate, st: EngineState, step: number, unit: WeightUnit, hook: Hook = () => undefined) {
  const plan = planSession(t, st, { stepKg: step })!;
  const result = { exercises: plan.exercises.map((p) => ({ planned: p, sets: p.sets.map((s, i) => ({ kg: s.kg, reps: s.reps, done: true, ...(hook(p.name, i, s) ?? {}) })) })) };
  return { plan, ...progress({ template: t, state: st, result, stepKg: step, unit }) };
}
/** Run every session of one pass through the program, finishing (or skipping) each. */
function cycle(t: ProgramTemplate, st: EngineState, step: number, unit: WeightUnit, each: (pos: number, liftOfDay: LiftKey | null) => Hook | "skip" = () => () => undefined): EngineState {
  const n = t.weeks.reduce((a, w) => a + w.days.length, 0);
  for (let i = 0; i < n; i++) {
    const plan = planSession(t, st, { stepKg: step })!;
    const what = each(i, plan.exercises[0]?.lift ?? null);
    st = what === "skip" ? skipSession(t, st, unit).state : finish(t, st, step, unit, what).state;
  }
  return st;
}

assert.deepEqual(howWeightsMove(get("stronglifts-5x5"), "kg", 2.5), [
  "Each lift starts at 50% of your max.",
  "Get every rep on every set and the weight goes up next time: 2.5 kg, or 5 kg on the deadlift.",
  "Miss reps three sessions in a row and that lift drops 10%.",
  "A lift never drops below the empty bar (20 kg).",
]);

// Greyskull's 1.25 kg upper-body jump rounds to the member's smallest jump.
const grey = howWeightsMove(get("greyskull-lp"), "kg", 2.5);
assert.ok(grey.includes("Get every rep on every set and the weight goes up next time: 2.5 kg."), grey.join(" | "));
assert.ok(grey.includes("Ten or more reps on the last set doubles the jump on the squat and deadlift."), grey.join(" | "));
assert.ok(grey.includes("Fall short on any set and that lift drops 10% next time."));
assert.ok(grey.includes("Chin-up is bodyweight. Add reps when you can."));
assert.ok(howWeightsMove(get("greyskull-lp"), "kg", 1.25).includes("Get every rep on every set and the weight goes up next time: 1.25 kg, or 2.5 kg on the squat and deadlift."));
const greyLb = howWeightsMove(get("greyskull-lp"), "lb", STEP_5LB_KG);
assert.ok(greyLb.includes("Get every rep on every set and the weight goes up next time: 5 lb."), greyLb.join(" | "));
assert.ok(greyLb.includes("A lift never drops below the empty bar (45 lb)."));

// Greyskull's doubled jump, against the engine: a line names exactly the lifts where ten reps on the last set lands heavier than a plain hit.
{
  const g = get("greyskull-lp");
  for (const [unit, step] of [["kg", 2.5], ["kg", 1.25], ["lb", STEP_5LB_KG]] as const) {
    const moved = new Set<LiftKey>();
    const doubled = new Set<LiftKey>();
    const st0 = initState(g, { bench: 80, row: 70, squat: 100, press: 50, deadlift: 120 }, step);
    g.weeks[0].days.forEach((_d, di) => {
      const st = { ...st0, week: 0, day: di };
      const plain = finish(g, st, step, unit);
      const ten = finish(g, st, step, unit, (_n, i, p) => (i === plain.plan.exercises.find((e) => e.name === _n)!.sets.length - 1 && p.kg !== null ? { reps: 10 } : undefined));
      for (const ex of plain.plan.exercises) {
        if (!ex.progresses || !ex.lift) continue;
        moved.add(ex.lift);
        assert.ok(plain.state.weights[ex.stateKey] > st.weights[ex.stateKey], `${ex.name} goes up on a hit`);
        if (ten.state.weights[ex.stateKey] > plain.state.weights[ex.stateKey] + 0.01) doubled.add(ex.lift);
      }
    });
    const lines = howWeightsMove(g, unit, step);
    const line = lines.find((l) => l.includes("doubles the jump"));
    const names = g.lifts.filter((l) => doubled.has(l)).map((l) => LIFT_LABEL[l].toLowerCase());
    const want = doubled.size === 0 ? undefined : doubled.size === moved.size ? "Ten or more reps on the last set doubles the jump." : `Ten or more reps on the last set doubles the jump on the ${listText(names)}.`;
    assert.equal(line, want, `greyskull ${unit} ${step}: ${lines.join(" | ")}`);
  }
  // Every lift doubles with small plates; in pounds only the 2.5 kg lifts do.
  assert.ok(howWeightsMove(g, "kg", 1.25).includes("Ten or more reps on the last set doubles the jump."));
  assert.ok(greyLb.includes("Ten or more reps on the last set doubles the jump on the squat and deadlift."), greyLb.join(" | "));
  // A program whose jumps never double at this step says nothing about doubling.
  const flat: ProgramTemplate = { ...g, engine: { ...g.engine, increment: 0.5, increments: {} } as ProgramTemplate["engine"] };
  assert.ok(!howWeightsMove(flat, "kg", 2.5).some((l) => l.includes("doubles")));
}

assert.deepEqual(howWeightsMove(get("531-bbb"), "kg", 2.5), [
  "Your training max is 90% of your max. Every percentage is taken from it.",
  "The last set of each main lift in weeks 1 to 3 is as many reps as you can.",
  "After each four-week cycle, your training max goes up 2.5 kg, or 5 kg on the deadlift and squat.",
  "If you finish a session and its + set falls short, isn't ticked, or is more than one jump lighter than planned, that lift's training max stays the same for the next cycle. Skipped sessions don't hold it back.",
  "You pick the weight for dumbbell row and lying leg curl. The program does not change it.",
  "Chin-up and hanging leg raise are bodyweight. Add reps when you can.",
]);
// 5/3/1 against the engine: what holds a training max, and what does not.
{
  const t = get("531-bbb");
  const maxes = { press: 60, deadlift: 160, bench: 100, squat: 140 };
  const st0 = initState(t, maxes, 2.5);
  const press0 = st0.tms.press!;
  const firstPress = (hook: Hook) => (pos: number, lift: LiftKey | null) => (lift === "press" && pos === 0 ? hook : () => undefined);
  const plus = (fn: (kg: number | null, reps: number) => ReturnType<Hook>): Hook => (n, i, p) => (n === "Overhead press" && i === 2 ? fn(p.kg, p.reps) : undefined);
  assert.equal(cycle(t, st0, 2.5, "kg").tms.press, press0 + 2.5, "a full cycle raises it");
  assert.equal(cycle(t, st0, 2.5, "kg", firstPress(plus((_kg, r) => ({ reps: r - 1 })))).tms.press, press0, "a short + set holds it");
  assert.equal(cycle(t, st0, 2.5, "kg", firstPress(plus(() => ({ done: false, reps: null })))).tms.press, press0, "an unticked + set holds it");
  assert.equal(cycle(t, st0, 2.5, "kg", firstPress(plus((kg) => ({ kg: kg! - 5 })))).tms.press, press0, "a + set two jumps light holds it");
  assert.equal(cycle(t, st0, 2.5, "kg", firstPress(plus((kg) => ({ kg: kg! - 2.5 })))).tms.press, press0 + 2.5, "one jump light still counts");
  assert.equal(cycle(t, st0, 2.5, "kg", (_pos, lift) => (lift === "press" ? "skip" : () => undefined)).tms.press, press0 + 2.5, "skipped sessions do not hold it");
  // Which weeks end on a + set, from the planner.
  const plusWeeks = t.weeks.map((w, wi) => planSession(t, { ...st0, week: wi, day: 0 }, { stepKg: 2.5 })!.exercises[0].sets.at(-1)!.amrap);
  assert.deepEqual(plusWeeks, [true, true, true, false]);
}
// A training max moves by the raw amount, shown in pounds.
assert.ok(howWeightsMove(get("531-bbb"), "lb", STEP_5LB_KG).includes("After each four-week cycle, your training max goes up 5 lb, or 10 lb on the deadlift and squat."));

const texas = howWeightsMove(get("texas-method"), "kg", 2.5);
assert.equal(texas[0], "Your training max is your 5-rep max, about 86% of your max. Every percentage is taken from it.");
assert.equal(texas[1], "Get all 5 reps on a top set and that lift's training max goes up 2.5 kg, or 5 kg on the deadlift.");
assert.equal(texas[2], "If the top set falls short, isn't ticked, or is more than one jump lighter than planned, the training max stays the same.");
{
  // The Texas top set against the engine: the intensity day's squat top set.
  const t = get("texas-method");
  const st = { ...initState(t, { squat: 140, bench: 100, press: 60, deadlift: 180 }, 2.5), week: 0, day: 2 };
  const top = (fn: (kg: number | null, reps: number) => ReturnType<Hook>): Hook => (n, i, p) => (n === "Back squat" && i === 0 ? fn(p.kg, p.reps) : undefined);
  const sq = st.tms.squat!;
  assert.equal(finish(t, st, 2.5, "kg").state.tms.squat, sq + 2.5);
  assert.equal(finish(t, st, 2.5, "kg", top((_k, r) => ({ reps: r - 1 }))).state.tms.squat, sq, "short");
  assert.equal(finish(t, st, 2.5, "kg", top(() => ({ done: false, reps: null }))).state.tms.squat, sq, "unticked");
  assert.equal(finish(t, st, 2.5, "kg", top((kg) => ({ kg: kg! - 5 }))).state.tms.squat, sq, "lighter");
}

assert.deepEqual(howWeightsMove(get("gzclp"), "kg", 2.5), [
  "Main lifts (T1) start at 73% of your max and second lifts (T2) at 55%.",
  "Hit every rep and the lift goes up next time: 2.5 kg, or 5 kg on the squat and deadlift.",
  "Miss on a main lift and it moves on to 6 x 2+, then 10 x 1+ at the same weight. Miss on 10 x 1+ and it goes back to 5 x 3+ at 85% of that weight.",
  "Miss on a second lift and it moves on to 3 x 8, then 3 x 6. Miss on 3 x 6 and it goes back to 3 x 10, 5 kg heavier than it last started.",
  "Accessories (T3) go up 2.5 kg once the last set reaches 25 reps.",
]);

{
  // GZCLP T2 against the engine: a miss on each scheme in turn, and the third miss resets to 3 x 10.
  const t = get("gzclp");
  let st = initState(t, { squat: 140, bench: 100, press: 60, deadlift: 180 }, 2.5);
  const base = finish(t, st, 2.5, "kg").plan.exercises[1];
  const said: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = finish(t, { ...st, week: 0, day: 0 }, 2.5, "kg", (n, si) => (n === base.name && si === 0 ? { reps: 0 } : undefined));
    st = r.state;
    said.push(r.reasons.find((x) => x.startsWith(base.name))!);
  }
  assert.ok(said[1].includes("moves to 3 x 6") && said[2].includes(`goes back to 3 x 10 at ${formatWeight(base.sets[0].kg! + 5, "kg")}`), said.join(" | "));
}

assert.deepEqual(howWeightsMove(get("smolov-base"), "kg", 2.5), [
  "Every weight is a percentage of the max you enter.",
  "Week 2 adds 10 kg and week 3 adds 15 kg to every set.",
  "The weights are set from the start. They do not change with how a session goes.",
  "The test day works out your max from your best set. Start the block again from it.",
]);

{
  // In pounds the add-ons are rounded to the member's jump, and the planner's weights agree to within one jump.
  const t = get("smolov-base");
  const lb = howWeightsMove(t, "lb", STEP_5LB_KG);
  assert.equal(lb[1], "Week 2 adds about 20 lb and week 3 adds about 35 lb to every set.", lb.join(" | "));
  const st = initState(t, { squat: 140 }, STEP_5LB_KG);
  const at = (w: number) => planSession(t, { ...st, week: w, day: 0 }, { stepKg: STEP_5LB_KG })!.exercises[0].sets[0].kg!;
  for (const [w, said] of [[1, 20], [2, 35]] as const) {
    const diffLb = (at(w) - at(0)) / 0.45359237;
    assert.ok(Math.abs(diffLb - said) <= 5.01, `week ${w + 1}: ${diffLb} lb vs about ${said} lb`);
  }
}

assert.deepEqual(howWeightsMove(get("phul"), "kg", 1.25), [
  "You pick each starting weight.",
  "When every set reaches the top of its rep range, the weight goes up 1.25 kg and the reps go back to the bottom.",
]);
// PHAT's speed sets share names with lifts that progress on the power days: no line says the program leaves them alone.
assert.ok(!howWeightsMove(get("phat"), "kg", 2.5).some((l) => l.includes("pendlay row")));

const gvt = howWeightsMove(get("german-volume-training"), "kg", 2.5);
assert.equal(gvt[0], "Each lift starts at 60% of your max.");
assert.ok(gvt.includes("Get every rep on every set and the weight goes up 2.5 kg next time. Until then it stays the same."));
assert.ok(gvt.includes("You pick the starting weight for lying leg curl and hammer curl."));

assert.ok(
  howWeightsMove(nsunsStyle, "kg", 2.5).includes("The reps on the heavy + set move your training max: 0 to 1 reps changes nothing, 2 to 3 reps adds 2.5 kg, 4 to 5 reps adds 5 kg and 6 or more reps adds 7.5 kg."),
);

{
  // nSuns against the engine: an unticked or light + set leaves the training max where it is.
  const t = nsunsStyle;
  const lines = howWeightsMove(t, "kg", 2.5);
  assert.ok(lines.includes("If the + set isn't ticked or is more than one jump lighter than planned, the training max stays the same."), lines.join(" | "));
  const st0 = initState(t, { bench: 100, squat: 140, press: 60, deadlift: 180 }, 2.5);
  let checked = 0;
  t.weeks[0].days.forEach((_d, di) => {
    const st = { ...st0, week: 0, day: di };
    const plan = planSession(t, st, { stepKg: 2.5 })!;
    for (const pe of plan.exercises) {
      const idx = pe.sets.findIndex((x) => x.drives);
      if (idx < 0 || !pe.lift) continue;
      const lift = pe.lift;
      const on = (fn: ReturnType<Hook>): Hook => (n, i) => (n === pe.name && i === idx ? fn : undefined);
      assert.ok(finish(t, st, 2.5, "kg", on({ reps: 9 })).state.tms[lift]! > st.tms[lift]!, "a big + set raises it");
      assert.equal(finish(t, st, 2.5, "kg", on({ reps: 9, done: false })).state.tms[lift], st.tms[lift], "unticked");
      assert.equal(finish(t, st, 2.5, "kg", on({ reps: 9, kg: pe.sets[idx].kg! - 5 })).state.tms[lift], st.tms[lift], "lighter");
      checked++;
    }
  });
  assert.ok(checked > 0);
}

// Every platform program, in kg and in pounds: sentences, no gaps.
for (const t of [...PLATFORM_PROGRAMS, nsunsStyle]) {
  for (const [unit, step] of [["kg", 2.5], ["kg", 1.25], ["lb", STEP_5LB_KG]] as const) {
    const lines = howWeightsMove(t, unit, step);
    assert.ok(lines.length >= 2, `${t.key}: at least two lines`);
    for (const l of lines) {
      assert.ok(!/undefined|NaN|null|\[object/.test(l), `${t.key}: ${l}`);
      assert.ok(/^[A-Z0-9]/.test(l) && l.endsWith("."), `${t.key}: a sentence: ${l}`);
      assert.ok(!/\p{Extended_Pictographic}/u.test(l), `${t.key}: no emojis`);
      if (unit === "lb") assert.ok(!/\bkg\b/.test(l), `${t.key}: pounds only: ${l}`);
    }
  }
}

// ── every own rule ──
const bench = (kind: Parameters<typeof applyRule>[1]): ExerciseRx => applyRule(newExercise("Bench press"), kind);
assert.equal(ruleSentence(newExercise("Back squat"), "kg", 2.5), "Back squat goes up 2.5 kg after a session with every rep, and drops 10% after three misses in a row.");
assert.equal(ruleSentence(newExercise("Deadlift"), "lb", STEP_5LB_KG), "Deadlift goes up 10 lb after a session with every rep, and drops 10% after three misses in a row.");
const oneMiss = newExercise("Bench press");
if (oneMiss.rule?.kind === "linear") oneMiss.rule.deloadAfter = 1;
assert.equal(ruleSentence(oneMiss, "kg", 2.5), "Bench press goes up 2.5 kg after a session with every rep, and drops 10% after a miss.");
const tiny = newExercise("Curl");
if (tiny.rule?.kind === "linear") tiny.rule.incKg = 0.5;
assert.equal(ruleSentence(tiny, "kg", 2.5), "Curl adds 0.5 kg, less than your smallest jump, so it only changes when it drops 10% after three misses in a row.");
const range = bench("range");
range.sets = range.sets.concat([structuredClone(range.sets[0])]).map((s) => ({ ...s, reps: { min: 3, max: 5 } }) as typeof s);
assert.equal(ruleSentence(range, "kg", 2.5), "Bench press goes up 2.5 kg once all 4 sets reach 5 reps, then the reps go back to 3.");
assert.equal(ruleSentence({ ...range, sets: range.sets.slice(0, 1) }, "kg", 2.5), "Bench press goes up 2.5 kg once your set reaches 5 reps, then the reps go back to 3.");
const mixed = structuredClone(range);
mixed.sets[0] = { kind: "fixed", reps: { min: 6, max: 10 }, rest: 120 };
assert.equal(ruleSentence(mixed, "kg", 2.5), "Bench press goes up 2.5 kg once every set reaches the top of its range, then the reps go back to the bottom.");
if (range.rule?.kind === "range") range.rule.incKg = 5;
assert.equal(ruleSentence(range, "kg", 2.5), "Bench press goes up 5 kg once all 4 sets reach 5 reps, then the reps go back to 3.");

// Own rules against the engine.
const ownOf = (...exs: ExerciseRx[]): ProgramTemplate => {
  const t = blankMemberTemplate();
  t.engine = { key: "own_rules" };
  t.weeks = [{ days: [{ name: "A", exercises: exs }] }];
  return t;
};
const ownRun = (ex: ExerciseRx, startKg: number, reps: (planned: { reps: number; repsMax: number | null }) => number, times = 1, step = 2.5) => {
  const t = ownOf(ex);
  let st = initState(t, {}, step);
  const key = planSession(t, st, { stepKg: step })!.exercises[0].stateKey;
  st.weights[key] = startKg;
  for (let i = 0; i < times; i++) st = finish(t, st, step, "kg", (_n, _i, p) => ({ reps: reps(p) })).state;
  return st.weights[key];
};
{
  // A linear jump under the member's step: a hit keeps the weight, three misses drop it 10%.
  assert.equal(ownRun(tiny, 20, (p) => p.reps), 20);
  assert.equal(ownRun(tiny, 20, () => 1, 2), 20);
  assert.equal(ownRun(tiny, 20, () => 1, 3), roundToStep(18, 2.5));
  const one = structuredClone(tiny);
  if (one.rule?.kind === "linear") one.rule.deloadAfter = 1;
  assert.equal(ruleSentence(one, "kg", 2.5), "Curl adds 0.5 kg, less than your smallest jump, so it only changes when it drops 10% after a miss.");
  // A range jump under the member's step: the top of the range keeps the weight.
  const small = bench("range");
  if (small.rule?.kind === "range") small.rule.incKg = 1;
  assert.equal(ownRun(small, 60, (p) => p.repsMax ?? p.reps), 60);
  assert.equal(ruleSentence(small, "kg", 2.5), "Bench press adds 1 kg, less than your smallest jump, so its weight stays the same.");
  assert.equal(ownRun(bench("range"), 60, (p) => p.repsMax ?? p.reps), 62.5);
  assert.equal(ruleSentence(bench("range"), "kg", 2.5), "Bench press goes up 2.5 kg once all 3 sets reach 9 reps, then the reps go back to 5.");
  // A bodyweight exercise: no weight is planned and the engine keeps none.
  const pull = applyRule({ ...newExercise("Pull-up"), bodyweight: true }, "manual");
  assert.equal(ruleSentence(pull, "kg", 2.5), "Pull-up uses your bodyweight. Add reps when you can.");
  const pt = ownOf(pull);
  const pr = finish(pt, initState(pt, {}, 2.5), 2.5, "kg", () => ({ kg: 10 }));
  assert.ok(pr.plan.exercises[0].sets.every((x) => x.kg === null));
  assert.deepEqual(pr.state.weights, {});
  assert.equal(ruleSentence(applyRule({ ...newExercise("Dip"), bodyweight: true }, "linear"), "kg", 2.5), "Dip uses your bodyweight. Add reps when you can.");
}
{
  // A test day in a member program moves the max.
  const t = ownOf(bench("percent"));
  t.lifts = ["bench"];
  assert.ok(!howWeightsMove(t, "kg", 2.5).some((l) => l.includes("test day")));
  t.weeks.push({ days: [{ name: "Test", test: true, exercises: [bench("percent")] }] });
  const lines = howWeightsMove(t, "kg", 2.5);
  assert.ok(lines.includes("A test day works out your max from your best set. Its percentages use it from the next session."), lines.join(" | "));
  const st = { ...initState(t, { bench: 100 }, 2.5), week: 1, day: 0 };
  const r = finish(t, st, 2.5, "kg", (_n, i) => (i === 0 ? { kg: 100, reps: 5 } : undefined));
  assert.ok(r.state.maxes.bench! > 100, "the test day raised the max");
}

const pct = bench("percent");
assert.equal(ruleSentence(pct, "kg", 2.5), "Bench press is 75% of your bench press max. It moves when you change the max.");
pct.sets[2] = { kind: "pct", pct: 0.85, reps: 3, rest: 120 };
assert.equal(ruleSentence(pct, "kg", 2.5), "Bench press is 75% to 85% of your bench press max. It moves when you change the max.");
assert.equal(ruleSentence(bench("rpe"), "kg", 2.5), "Bench press is worked out for RPE 8 from your best logged set.");
assert.equal(ruleSentence(bench("manual"), "kg", 2.5), "Bench press stays at the weight you choose.");

// A member program gives one line per distinct rule.
const mine = blankMemberTemplate();
mine.engine = { key: "own_rules" };
mine.weeks = [
  { days: [{ name: "A", exercises: [newExercise("Back squat"), bench("percent")] }] },
  { days: [{ name: "A", exercises: [newExercise("Back squat"), bench("manual")] }] },
];
assert.deepEqual(howWeightsMove(mine, "kg", 2.5), [
  "Back squat goes up 2.5 kg after a session with every rep, and drops 10% after three misses in a row.",
  "Bench press is 75% of your bench press max. It moves when you change the max.",
  "Bench press stays at the weight you choose.",
]);

console.log("programs/progressionText: ok");
