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
  emptyState,
  type EngineState,
  type ExerciseResult,
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

function engineStartPct(t: ProgramTemplate): number | undefined {
  const e = t.engine;
  if (e.key === "linear" || e.key === "fixed_volume") return e.startPct;
  if (e.key === "tm_cycle") return e.startPct;
  return undefined;
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
  const bar = roundToStep(20, stepKg);
  for (const w of t.weeks)
    for (const d of w.days)
      for (const ex of d.exercises) {
        const key = stateKey(ex);
        if (key in s.weights || !progresses(ex) || !ex.lift) continue;
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

/** The lightest weight the member actually used on a ticked set. */
export function workingKg(r: ExerciseResult): number | null {
  const ks = r.sets.filter((s) => s.done && s.kg !== null && s.kg > 0).map((s) => s.kg as number);
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

function linear(c: Ctx, s: LinearSettings): void {
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses) continue;
    const used: number | undefined = workingKg(r) ?? c.state.weights[p.stateKey];
    if (used === undefined) continue;
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
      continue;
    }
    const misses = (c.state.misses[p.stateKey] ?? 0) + 1;
    if (misses >= s.deloadAfter) {
      const next = roundToStep(used * (1 - s.deloadPct), c.stepKg);
      c.state.weights[p.stateKey] = next;
      c.state.misses[p.stateKey] = 0;
      c.reasons.push(
        `Next ${name} ${c.fmt(next)}, ${Math.round(s.deloadPct * 100)}% lighter. ${misses === 1 ? missText(r) : `You missed reps ${countWord(misses)} sessions in a row.`}`,
      );
    } else {
      c.state.weights[p.stateKey] = used;
      c.state.misses[p.stateKey] = misses;
      c.reasons.push(`${p.name} stays at ${c.fmt(used)}. ${missText(r)} Try it again next time.`);
    }
  }
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
      if (s.rule === "cycle" && p.amrap && got !== null) {
        c.reasons.push(`${LIFT_LABEL[lift]}: ${got} ${got === 1 ? "rep" : "reps"} on the ${p.reps}+ set.`);
        if (got < p.reps) c.state.short[lift] = true;
      }
      const cur = c.state.tms[lift];
      if (!p.drives || cur === undefined) return;
      if (s.rule === "amrap_table") {
        if (got === null) {
          c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(cur)}. The ${p.reps}+ set wasn't logged.`);
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
        if (got !== null && got >= p.reps) {
          const next = round2(cur + inc(lift));
          c.state.tms[lift] = next;
          c.reasons.push(`${LIFT_LABEL[lift]} training max goes up to ${c.fmt(next)}. You got all ${p.reps} reps on your top set.`);
        } else {
          c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(cur)}. You got ${got ?? 0} of ${p.reps} on your top set.`);
        }
      }
    });
  }
  if (s.rule === "cycle" && c.atCycleEnd) {
    for (const lift of c.template.lifts) {
      const tm = c.state.tms[lift];
      if (tm === undefined) continue;
      if (c.state.short[lift]) {
        c.reasons.push(`${LIFT_LABEL[lift]} training max stays at ${c.fmt(tm)}. You fell short on a + set this cycle.`);
      } else {
        const next = round2(tm + inc(lift));
        c.state.tms[lift] = next;
        c.reasons.push(`${LIFT_LABEL[lift]} training max goes up to ${c.fmt(next)} for the next cycle.`);
      }
    }
    c.state.short = {};
  }
}

function gzclp(c: Ctx, s: TmCycleSettings): void {
  const day = c.template.weeks[c.state.week]?.days[c.state.day];
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses || !p.tier) continue;
    const stages = day?.exercises[p.index]?.stages ?? [];
    const used: number | undefined = workingKg(r) ?? c.state.weights[p.stateKey];
    if (used === undefined) continue;
    const name = p.name.toLowerCase();
    const inc = (p.lift ? s.increments?.[p.lift] : undefined) ?? s.increment;
    if (p.tier === "t3") {
      const a = lastAmrap(r);
      if (a && a.got !== null && a.got >= (s.t3AmrapTarget ?? 25)) {
        const next = roundToStep(used + c.stepKg, c.stepKg);
        c.state.weights[p.stateKey] = next;
        c.reasons.push(`Next ${name} ${c.fmt(next)}. You got ${a.got} on the last set.`);
      } else {
        c.state.weights[p.stateKey] = used;
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
      const next = roundToStep(used * 0.85, c.stepKg);
      c.state.stages[p.stateKey] = 0;
      c.state.weights[p.stateKey] = next;
      c.reasons.push(`${p.name} goes back to ${schemeLabel(stages[0] ?? [])} at ${c.fmt(next)}, 85% of where it stalled.`);
    } else {
      const next = roundToStep((c.state.t2Base[p.stateKey] ?? used) + (s.t2ResetKg ?? 5), c.stepKg);
      c.state.stages[p.stateKey] = 0;
      c.state.weights[p.stateKey] = next;
      c.state.t2Base[p.stateKey] = next;
      c.reasons.push(`${p.name} goes back to ${schemeLabel(stages[0] ?? [])} at ${c.fmt(next)}.`);
    }
  }
}

function fixedBlock(c: Ctx): void {
  const day = c.template.weeks[c.state.week]?.days[c.state.day];
  if (day?.test) {
    for (const r of c.result.exercises) {
      const lift = r.planned.lift;
      if (!lift) continue;
      let best: { e1: number; kg: number; reps: number } | null = null;
      for (const d of r.sets) {
        if (!d.done || d.kg === null || d.reps === null) continue;
        const e1 = maxFromSet(d.kg, d.reps);
        if (e1 !== null && (!best || e1 > best.e1)) best = { e1, kg: d.kg, reps: d.reps };
      }
      const label = LIFT_LABEL[lift].toLowerCase();
      if (best) {
        c.state.testMaxes[lift] = best.e1;
        c.reasons.push(`Your new ${label} max is about ${c.fmt(roundToStep(best.e1, c.stepKg))}, from ${c.fmt(best.kg)} x ${best.reps}.`);
      } else {
        c.reasons.push(`No ${label} max from today. Enter one when you start again.`);
      }
    }
  }
  if (c.atCycleEnd) c.reasons.push("Block done. Start it again from your new max when you're ready.");
}

function doubleProgression(c: Ctx): void {
  let firsts = 0;
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses) continue;
    const used = workingKg(r);
    if (used === null) continue;
    const had = c.state.weights[p.stateKey] !== undefined;
    if (hitTop(r)) {
      const next = roundToStep(used + c.stepKg, c.stepKg);
      c.state.weights[p.stateKey] = next;
      const first = p.sets[0];
      c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(next)}, back to ${first.reps} reps. You hit ${first.repsMax ?? first.reps} on every set.`);
    } else {
      c.state.weights[p.stateKey] = used;
      if (!had) firsts++;
    }
  }
  if (firsts > 0) c.reasons.push("Weights saved from today. Each one goes up when you reach the top of its rep range on every set.");
}

function fixedVolume(c: Ctx, s: FixedVolumeSettings): void {
  for (const r of c.result.exercises) {
    const p = r.planned;
    if (!p.progresses) continue;
    const used: number | undefined = workingKg(r) ?? c.state.weights[p.stateKey];
    if (used === undefined) continue;
    const total = p.sets.reduce((n, x) => n + x.reps, 0);
    const got = r.sets.reduce((n, d) => n + (d.done && d.reps ? d.reps : 0), 0);
    if (got >= total) {
      const next = roundToStep(used + s.increment, c.stepKg);
      c.state.weights[p.stateKey] = next;
      c.reasons.push(`Next ${p.name.toLowerCase()} ${c.fmt(next)}. You did all ${total} reps.`);
    } else {
      c.state.weights[p.stateKey] = used;
      c.reasons.push(`${p.name} stays at ${c.fmt(used)}. You did ${got} of ${total} reps.`);
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
  }
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

/** Move past a session without running the engine. Skipping a block's last session finishes it. */
export function skipState(t: ProgramTemplate, state: EngineState): EngineState {
  const next = clone(state);
  if (t.engine.key === "fixed_block" && isLastSession(t, state.week, state.day)) {
    next.finished = true;
    return next;
  }
  const a = advance(t, state);
  next.week = a.week;
  next.day = a.day;
  next.cycle = a.cycle;
  return next;
}
