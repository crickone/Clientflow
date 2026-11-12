// app/src/lib/programs/engines.ts
/**
 * The five progression engines. Each takes the session just finished (at
 * state.week/day), what the member actually lifted, and returns the new state
 * with a reason for every change. progress() then moves the position on.
 * Pure: no server imports.
 */
import { advance, isLastSession, progresses, schemeLabel, stateKey } from "./planner";
import {
  LIFT_LABEL,
  OWN_DELOAD_PCT,
  emptyState,
  type EngineState,
  type ExerciseResult,
  type ExerciseRx,
  type FixedVolumeSettings,
  type LiftKey,
  type LinearSettings,
  type ProgramTemplate,
  type SessionResult,
  type TmCycleSettings,
  type WeightUnit,
} from "./types";
import { formatWeight, maxFromSet, roundToStep, trainingMax } from "./units";

export interface ProgressInput {
  template: ProgramTemplate;
  state: EngineState;
  result: SessionResult;
  stepKg: number;
  unit: WeightUnit;
}

export interface ProgressOutput {
  state: EngineState;
  reasons: string[];
}

interface Ctx extends ProgressInput {
  atCycleEnd: boolean;
  reasons: string[];
  fmt: (kg: number) => string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const countWord = (n: number) => WORDS[n] ?? String(n);
const clone = (s: EngineState): EngineState => JSON.parse(JSON.stringify(s)) as EngineState;
const sameKg = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** The empty bar, rounded to the member's smallest jump. No lift goes below it. */
export function barKg(stepKg: number): number {
  return roundToStep(20, stepKg);
}

/** A set counts as done at the planned weight if it was at most one smallest jump lighter. */
function lighterThanPlanned(d: { kg: number | null }, p: { kg: number | null }, stepKg: number): boolean {
  if (p.kg === null) return false;
  return d.kg === null || d.kg < p.kg - stepKg - 0.01;
}

/**
 * 5/3/1: why a lift is short this cycle, kept in `misses` under `short:<lift>`
 * next to the `short` flag so the end of the cycle can say why. First cause wins.
 */
const SHORT_REPS = 1;
const SHORT_UNLOGGED = 2;
const SHORT_LIGHT = 3;
const shortKey = (lift: LiftKey) => `short:${lift}`;
function markShort(state: EngineState, lift: LiftKey, cause: number): void {
  state.short[lift] = true;
  if (state.misses[shortKey(lift)] === undefined) state.misses[shortKey(lift)] = cause;
}

function engineStartPct(t: ProgramTemplate): number | undefined {
  const e = t.engine;
  if (e.key === "linear" || e.key === "fixed_volume") return e.startPct;
  if (e.key === "tm_cycle") return e.startPct;
  return undefined;
}

/** A member-built exercise's starting weight, if its rule has one. */
function ownStartKg(ex: ExerciseRx): number | undefined {
  const r = ex.rule;
  if (!r || (r.kind !== "linear" && r.kind !== "range" && r.kind !== "manual")) return undefined;
  return r.startKg !== undefined && r.startKg > 0 ? r.startKg : undefined;
}

/** The state a member starts a program with, from their maxes. */
export function initState(t: ProgramTemplate, maxes: Partial<Record<LiftKey, number>>, stepKg: number): EngineState {
  const s = emptyState();
  for (const lift of t.lifts) {
    const m = maxes[lift];
    if (m && m > 0) {
      s.maxes[lift] = round2(m);
      s.tms[lift] = trainingMax(m, t.tmPct);
    }
  }
  const fallback = engineStartPct(t);
  const bar = barKg(stepKg);
  for (const w of t.weeks)
    for (const d of w.days)
      for (const ex of d.exercises) {
        const key = stateKey(ex);
        if (key in s.weights || !progresses(ex)) continue;
        const own = ownStartKg(ex);
        if (own !== undefined) {
          s.weights[key] = roundToStep(own, stepKg);
          continue;
        }
        if (!ex.lift) continue;
        const startPct = ex.startPct ?? fallback;
        const max = s.maxes[ex.lift];
        if (!startPct || !max) continue;
        s.weights[key] = Math.max(bar, roundToStep(max * startPct, stepKg));
        if (ex.tier === "t2") s.t2Base[key] = s.weights[key];
      }
  return s;
}

/** Every planned set has a ticked set at or above its reps (a + set counts its minimum). */
export function hitAll(r: ExerciseResult): boolean {
  return r.planned.sets.every((p, i) => {
    const d = r.sets[i];
    return !!d && d.done && d.reps !== null && d.reps >= p.reps;
  });
}

function hitTop(r: ExerciseResult): boolean {
  return r.planned.sets.every((p, i) => {
    const d = r.sets[i];
    return !!d && d.done && d.reps !== null && d.reps >= (p.repsMax ?? p.reps);
  });
}

/** The lightest weight the member actually used on a ticked planned set. Extra sets do not count. */
export function workingKg(r: ExerciseResult): number | null {
  const ks = r.sets
    .slice(0, r.planned.sets.length)
    .filter((s) => s.done && s.kg !== null && s.kg > 0)
    .map((s) => s.kg as number);
  return ks.length ? Math.min(...ks) : null;
}

function missText(r: ExerciseResult): string {
  const i = r.planned.sets.findIndex((p, k) => {
    const d = r.sets[k];
    return !d || !d.done || d.reps === null || d.reps < p.reps;
  });
  if (i === -1) return "";
  const d = r.sets[i];
  return d && d.done && d.reps !== null ? `You got ${d.reps} of ${r.planned.sets[i].reps} on set ${i + 1}.` : `Set ${i + 1} wasn't ticked.`;
}

function lastAmrap(r: ExerciseResult): { want: number; got: number | null } | null {
  for (let i = r.planned.sets.length - 1; i >= 0; i--) {
    if (!r.planned.sets[i].amrap) continue;
    const d = r.sets[i];
    return { want: r.planned.sets[i].reps, got: d && d.done ? d.reps : null };
  }
  return null;
}

function setCountText(r: ExerciseResult): string {
  const sets = r.planned.sets;
  const reps = sets[0]?.reps;
  if (sets.length && sets.every((s) => s.reps === reps && !s.amrap && s.repsMax === null)) {
    return sets.length === 1 ? `your set of ${reps}` : `all ${sets.length} sets of ${reps}`;
  }
  return "every set";
}

type LinearRule = Pick<LinearSettings, "increment" | "increments" | "deloadAfter" | "deloadPct" | "doubleAt">;

/** One exercise under linear progression: up after every rep, the same after a miss, lighter after deloadAfter misses in a row. */
function linearExercise(c: Ctx, r: ExerciseResult, s: LinearRule): void {
  const p = r.planned;
  if (!p.progresses) return;
  const prev: number | undefined = c.state.weights[p.stateKey];
  const used: number | undefined = workingKg(r) ?? prev;
  if (used === undefined) return;
  const inc = (p.lift ? s.increments?.[p.lift] : undefined) ?? s.increment;
  const name = p.name.toLowerCase();
  if (hitAll(r)) {
    const a = lastAmrap(r);
    const double = s.doubleAt !== undefined && a !== null && a.got !== null && a.got >= s.doubleAt;
    const next = roundToStep(used + (double ? inc * 2 : inc), c.stepKg);
    c.state.weights[p.stateKey] = next;
    c.state.misses[p.stateKey] = 0;
    c.reasons.push(
      double ? `Next ${name} ${c.fmt(next)}. You got ${a!.got} on the last set, so it goes up twice as much.` : `Next ${name} ${c.fmt(next)}. You did ${setCountText(r)}.`,
    );
    return;
  }
  const misses = (c.state.misses[p.stateKey] ?? 0) + 1;
  if (misses >= s.deloadAfter) {
    const raw = roundToStep(used * (1 - s.deloadPct), c.stepKg);
    const bar = p.lift ? barKg(c.stepKg) : 0;
    const next = Math.max(bar, raw);
    c.state.weights[p.stateKey] = next;
    c.state.misses[p.stateKey] = 0;
    const why = misses === 1 ? missText(r) : `You missed reps ${countWord(misses)} sessions in a row.`;
    if (raw >= bar) c.reasons.push(`Next ${name} ${c.fmt(next)}, ${Math.round(s.deloadPct * 100)}% lighter. ${why}`);
    else if (prev !== undefined && sameKg(prev, next)) c.reasons.push(`${p.name} stays at ${c.fmt(next)}, the empty bar. ${why}`);
    else c.reasons.push(`Next ${name} ${c.fmt(next)}, the empty bar. ${why}`);
  } else {
    c.state.weights[p.stateKey] = used;
    c.state.misses[p.stateKey] = misses;
    if (prev !== undefined && sameKg(prev, used)) c.reasons.push(`${p.name} stays at ${c.fmt(used)}. ${missText(r)} Try it again next time.`);
    else c.reasons.push(`Next ${name} ${c.fmt(used)}, the weight you used. ${missText(r)}`);
  }
}

function linear(c: Ctx, s: LinearSettings): void {
  for (const r of c.result.exercises) linearExercise(c, r, s);
}

function tableKg(table: { minReps: number; kg: number }[], reps: number): number {
  let kg = 0;
  for (const row of [...table].sort((a, b) => a.minReps - b.minReps)) if (reps >= row.minReps) kg = row.kg;
  return kg;
}

function tmCycle(c: Ctx, s: TmCycleSettings): void {
  if (s.rule === "gzclp") return gzclp(c, s);
  const inc = (lift: LiftKey) => s.increments?.[lift] ?? s.increment;
  for (const r of c.result.exercises) {
    const lift = r.planned.lift;
    if (!lift) continue;
    r.planned.sets.forEach((p, i) => {
      const d = r.sets[i];
      const got = d && d.done ? d.reps : null;
      const light = got !== null && lighterThanPlanned(d, p, c.stepKg);
      const repsWord = got === 1 ? "rep" : "reps";
      if (s.rule === "cycle" && p.amrap) {
        if (got === null) {
          markShort(c.state, lift, SHORT_UNLOGGED);
          c.reasons.push(`${LIFT_LABEL[lift]}: the ${p.reps}+ set wasn't logged.`);
        } else if (light) {
          markShort(c.state, lift, SHORT_LIGHT);
          c.reasons.push(`${LIFT_LABEL[lift]}: ${got} ${repsWord} on the ${p.reps}+ set, lighter than planned.`);
        } else {
          c.reasons.push(`${LIFT_LABEL[lift]}: ${got} ${repsWord} on the ${p.reps}+ set.`);
          if (got < p.reps) markShort(c.state, lift, SHORT_REPS);
        }
      }
      const cur = c.state.tms[lift];
      if (!p.drives || cur === undefined) return;
      if (s.rule === "amrap_table") {
        if (got === null) {
          c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(cur)}. The ${p.reps}+ set wasn't logged.`);
          return;
        }
        if (light) {
          c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(cur)}. The ${p.reps}+ set was lighter than planned.`);
          return;
        }
        const kg = tableKg(s.amrapTable ?? [], got);
        if (kg > 0) {
          const next = round2(cur + kg);
          c.state.tms[lift] = next;
          c.reasons.push(`${LIFT_LABEL[lift]} training max goes up to ${c.fmt(next)}. You got ${got} on the ${p.reps}+ set.`);
        } else {
          c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(cur)}. You got ${got} on the ${p.reps}+ set.`);
        }
      } else if (s.rule === "drive_set") {
        if (got !== null && light) {
          c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(cur)}. The top set was lighter than planned.`);
        } else if (got !== null && got >= p.reps) {
          const next = round2(cur + inc(lift));
          c.state.tms[lift] = next;
          c.reasons.push(`${LIFT_LABEL[lift]} training max goes up to ${c.fmt(next)}. You got all ${p.reps} reps on your top set.`);
        } else {
          c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(cur)}. You got ${got ?? 0} of ${p.reps} on your top set.`);
        }
      }
    });
  }
}

const SHORT_TEXT: Record<number, string> = {
  [SHORT_REPS]: "You fell short on a + set this cycle.",
  [SHORT_UNLOGGED]: "A + set wasn't logged this cycle.",
  [SHORT_LIGHT]: "A + set was lighter than planned this cycle.",
};

/**
 * The end of a training-max cycle (5/3/1): each lift that was not short goes up
 * by its increment, then `short` is cleared for the new cycle. Runs whether the
 * last session was finished or skipped. Changes `state` in place.
 */
function endOfCycle(t: ProgramTemplate, state: EngineState, fmt: (kg: number) => string): string[] {
  const e = t.engine;
  if (e.key !== "tm_cycle" || e.rule !== "cycle") return [];
  const reasons: string[] = [];
  for (const lift of t.lifts) {
    const tm = state.tms[lift];
    if (tm === undefined) continue;
    if (state.short[lift]) {
      const why = SHORT_TEXT[state.misses[shortKey(lift)] ?? SHORT_REPS] ?? SHORT_TEXT[SHORT_REPS];
      reasons.push(`${LIFT_LABEL[lift]} training max stays at ${fmt(tm)}. ${why}`);
    } else {
      const next = round2(tm + (e.increments?.[lift] ?? e.increment));
      state.tms[lift] = next;
      reasons.push(`${LIFT_LABEL[lift]} training max goes up to ${fmt(next)} for the next cycle.`);
    }
  }
  state.short = {};
  for (const k of Object.keys(state.misses)) if (k.startsWith("short:")) delete state.misses[k];
  return reasons;
}

function gzclp(c: Ctx, s: TmCycleSettings): void {
  const day = c.template.weeks[c.state.week]?.days[c.state.day];
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses || !p.tier) continue;
    const stages = day?.exercises[p.index]?.stages ?? [];
    const prev: number | undefined = c.state.weights[p.stateKey];
    const used: number | undefined = workingKg(r) ?? prev;
    if (used === undefined) continue;
    const name = p.name.toLowerCase();
    const inc = (p.lift ? s.increments?.[p.lift] : undefined) ?? s.increment;
    if (p.tier === "t3") {
      const a = lastAmrap(r);
      if (a && a.got !== null && a.got >= (s.t3AmrapTarget ?? 25)) {
        const next = roundToStep(used + c.stepKg, c.stepKg);
        c.state.weights[p.stateKey] = next;
        c.reasons.push(`Next ${name} ${c.fmt(next)}. You got ${a.got} on the last set.`);
      } else if (prev === undefined || !sameKg(prev, used)) {
        c.state.weights[p.stateKey] = used;
        c.reasons.push(`Next ${name} ${c.fmt(used)}, the weight you used.`);
      }
      continue;
    }
    const stage = c.state.stages[p.stateKey] ?? 0;
    if (hitAll(r)) {
      const next = roundToStep(used + inc, c.stepKg);
      c.state.weights[p.stateKey] = next;
      if (p.tier === "t2" && stage === 0) c.state.t2Base[p.stateKey] = next;
      c.reasons.push(`Next ${name} ${c.fmt(next)}. You did every set.`);
    } else if (stage + 1 < stages.length) {
      c.state.stages[p.stateKey] = stage + 1;
      c.state.weights[p.stateKey] = used;
      c.reasons.push(`${p.name} moves to ${schemeLabel(stages[stage + 1])} at ${c.fmt(used)}. ${missText(r)}`);
    } else if (p.tier === "t1") {
      const raw = roundToStep(used * 0.85, c.stepKg);
      const bar = p.lift ? barKg(c.stepKg) : 0;
      const next = Math.max(bar, raw);
      c.state.stages[p.stateKey] = 0;
      c.state.weights[p.stateKey] = next;
      c.reasons.push(
        `${p.name} goes back to ${schemeLabel(stages[0] ?? [])} at ${c.fmt(next)}, ${raw >= bar ? "85% of where it stalled" : "the empty bar"}.`,
      );
    } else {
      const next = roundToStep((c.state.t2Base[p.stateKey] ?? used) + (s.t2ResetKg ?? 5), c.stepKg);
      c.state.stages[p.stateKey] = 0;
      c.state.weights[p.stateKey] = next;
      c.state.t2Base[p.stateKey] = next;
      c.reasons.push(`${p.name} goes back to ${schemeLabel(stages[0] ?? [])} at ${c.fmt(next)}.`);
    }
  }
}

/** The ticked set with the highest estimated max (sets of 1 to 10 reps). */
function bestTestSet(r: ExerciseResult): { e1: number; kg: number; reps: number } | null {
  let best: { e1: number; kg: number; reps: number } | null = null;
  for (const d of r.sets) {
    if (!d.done || d.kg === null || d.reps === null) continue;
    const e1 = maxFromSet(d.kg, d.reps);
    if (e1 !== null && (!best || e1 > best.e1)) best = { e1, kg: d.kg, reps: d.reps };
  }
  return best;
}

function fixedBlock(c: Ctx): void {
  const day = c.template.weeks[c.state.week]?.days[c.state.day];
  if (day?.test) {
    for (const r of c.result.exercises) {
      const lift = r.planned.lift;
      if (!lift) continue;
      const best = bestTestSet(r);
      const label = LIFT_LABEL[lift].toLowerCase();
      if (best) {
        c.state.testMaxes[lift] = best.e1;
        c.reasons.push(`Your new ${label} max is about ${c.fmt(roundToStep(best.e1, c.stepKg))}, from ${c.fmt(best.kg)} x ${best.reps}.`);
      } else {
        c.reasons.push(`No ${label} max from today. Enter one when you start again.`);
      }
    }
  }
  if (c.atCycleEnd) {
    const hasTest = c.template.weeks.some((w) => w.days.some((d) => d.test));
    c.reasons.push(hasTest ? "Block done. Start it again from your new max when you're ready." : "Block done. You can start it again.");
  }
}

const FIRST_RANGE_WEIGHTS = "Weights saved from today. Each one goes up when you reach the top of its rep range on every set.";

/** One exercise under double progression: up by `inc` and back to the bottom of the range once every set reaches the top. True when this is its first saved weight. */
function rangeExercise(c: Ctx, r: ExerciseResult, inc: number): boolean {
  const p = r.planned;
  if (!p.progresses || p.sets.length === 0) return false;
  const used = workingKg(r);
  if (used === null) return false;
  const prev: number | undefined = c.state.weights[p.stateKey];
  if (hitTop(r)) {
    const next = roundToStep(used + inc, c.stepKg);
    c.state.weights[p.stateKey] = next;
    const first = p.sets[0];
    c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(next)}, back to ${first.reps} reps. You hit ${first.repsMax ?? first.reps} on every set.`);
    return false;
  }
  c.state.weights[p.stateKey] = used;
  if (prev === undefined) return true;
  if (!sameKg(prev, used)) c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(used)}, the weight you used.`);
  return false;
}

function doubleProgression(c: Ctx): void {
  let firsts = 0;
  for (const r of c.result.exercises) if (rangeExercise(c, r, c.stepKg)) firsts++;
  if (firsts > 0) c.reasons.push(FIRST_RANGE_WEIGHTS);
}

/** Manual: nothing goes up or down; the weight used is kept for next time. */
function manualExercise(c: Ctx, r: ExerciseResult): void {
  const p = r.planned;
  if (!p.progresses) return;
  const used = workingKg(r);
  if (used === null) return;
  const prev: number | undefined = c.state.weights[p.stateKey];
  c.state.weights[p.stateKey] = used;
  if (prev === undefined || !sameKg(prev, used)) c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(used)}, the weight you used.`);
}

/** A test day in a member-built program: each lift's max moves to the best set, and its percentages use it from the next session. */
function ownTestMaxes(c: Ctx): void {
  for (const r of c.result.exercises) {
    const lift = r.planned.lift;
    if (!lift || !c.template.lifts.includes(lift)) continue;
    const label = LIFT_LABEL[lift].toLowerCase();
    const best = bestTestSet(r);
    if (!best) {
      const cur = c.state.maxes[lift];
      c.reasons.push(cur !== undefined ? `No ${label} max from today. It stays at ${c.fmt(cur)}.` : `No ${label} max from today.`);
      continue;
    }
    const e1 = Math.round(best.e1 * 100) / 100;
    c.state.maxes[lift] = e1;
    c.state.tms[lift] = trainingMax(e1, c.template.tmPct);
    c.reasons.push(`Your new ${label} max is about ${c.fmt(roundToStep(e1, c.stepKg))}, from ${c.fmt(best.kg)} x ${best.reps}. Its percentages use it from the next session.`);
  }
}

/**
 * A member-built program: each exercise moves by its own rule, with the same
 * per-exercise logic the library engines use. An exercise no longer in the
 * program (an open session finished after an edit) changes nothing.
 */
function ownRules(c: Ctx): void {
  const live = new Set(c.template.weeks.flatMap((w) => w.days.flatMap((d) => d.exercises.map((ex) => stateKey(ex)))));
  let firsts = 0;
  for (const r of c.result.exercises) {
    const rule = r.planned.rule;
    if (!rule || !live.has(r.planned.stateKey)) continue;
    switch (rule.kind) {
      case "linear":
        linearExercise(c, r, { increment: rule.incKg, deloadAfter: rule.deloadAfter, deloadPct: OWN_DELOAD_PCT });
        break;
      case "range":
        if (rangeExercise(c, r, rule.incKg ?? c.stepKg)) firsts++;
        break;
      case "manual":
        manualExercise(c, r);
        break;
      case "percent":
      case "rpe":
        break;
      default: {
        const never: never = rule;
        return never;
      }
    }
  }
  if (firsts > 0) c.reasons.push(FIRST_RANGE_WEIGHTS);
  if (c.template.weeks[c.state.week]?.days[c.state.day]?.test) ownTestMaxes(c);
}

function fixedVolume(c: Ctx, s: FixedVolumeSettings): void {
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses) continue;
    const prev: number | undefined = c.state.weights[p.stateKey];
    const used: number | undefined = workingKg(r) ?? prev;
    if (used === undefined) continue;
    // Each planned set needs its own reps: extra reps on one set or extra sets do not cover a short one.
    const total = p.sets.reduce((n, x) => n + x.reps, 0);
    const got = p.sets.reduce((n, x, i) => {
      const d = r.sets[i];
      return n + (d && d.done && d.reps ? Math.min(d.reps, x.reps) : 0);
    }, 0);
    if (hitAll(r)) {
      const next = roundToStep(used + s.increment, c.stepKg);
      c.state.weights[p.stateKey] = next;
      c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(next)}. You did all ${total} reps.`);
    } else {
      c.state.weights[p.stateKey] = used;
      if (prev !== undefined && sameKg(prev, used)) c.reasons.push(`${p.name} stays at ${c.fmt(used)}. You did ${got} of ${total} reps.`);
      else c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(used)}, the weight you used. You did ${got} of ${total} reps.`);
    }
  }
}

/** Run the program's engine on the finished session, then move to the next session. */
export function progress(input: ProgressInput): ProgressOutput {
  const t = input.template;
  const c: Ctx = {
    ...input,
    state: clone(input.state),
    atCycleEnd: isLastSession(t, input.state.week, input.state.day),
    reasons: [],
    fmt: (kg) => formatWeight(kg, input.unit),
  };
  const e = t.engine;
  switch (e.key) {
    case "linear":
      linear(c, e);
      break;
    case "tm_cycle":
      tmCycle(c, e);
      break;
    case "fixed_block":
      fixedBlock(c);
      break;
    case "double_progression":
      doubleProgression(c);
      break;
    case "fixed_volume":
      fixedVolume(c, e);
      break;
    case "own_rules":
      ownRules(c);
      break;
  }
  if (c.atCycleEnd) c.reasons.push(...endOfCycle(t, c.state, c.fmt));
  if (e.key === "fixed_block" && c.atCycleEnd) {
    c.state.finished = true;
    return { state: c.state, reasons: c.reasons };
  }
  const next = advance(t, c.state);
  c.state.week = next.week;
  c.state.day = next.day;
  c.state.cycle = next.cycle;
  return { state: c.state, reasons: c.reasons };
}

/**
 * Move past a session without running the engine on it. Skipping a block's last
 * session finishes it. Skipping the last session of a training-max cycle still
 * runs the end of the cycle, so the reasons say what changed.
 */
export function skipSession(t: ProgramTemplate, state: EngineState, unit: WeightUnit = "kg"): ProgressOutput {
  const next = clone(state);
  const last = isLastSession(t, state.week, state.day);
  if (t.engine.key === "fixed_block" && last) {
    next.finished = true;
    return { state: next, reasons: [] };
  }
  const reasons = last ? endOfCycle(t, next, (kg) => formatWeight(kg, unit)) : [];
  const a = advance(t, state);
  next.week = a.week;
  next.day = a.day;
  next.cycle = a.cycle;
  return { state: next, reasons };
}

/** skipSession without the reasons. */
export function skipState(t: ProgramTemplate, state: EngineState): EngineState {
  return skipSession(t, state).state;
}
