// app/src/lib/programs/convert.ts
/**
 * A library program (or the member's current one) as a member-built program:
 * each exercise gets the nearest own rule. Linear engines become `linear`,
 * double progression `range`, percentages of a max `percent` (scaled so the
 * percentage is of the max, not the training max; RPE sets on a lift the
 * program takes a max for count as the share of the max they plan), other RPE-only exercises `rpe`,
 * and anything else `manual`. Carried weights become start weights and carried
 * training maxes become maxes, so the converted program plans the same
 * weights. Pure.
 */
import { setsFor, stateKey } from "./planner";
import { percentLifts } from "./memberTemplate";
import type { ExerciseRx, LiftKey, OwnRule, ProgramTemplate, SetRx } from "./types";
import { weightForRpe } from "./units";

export interface Carry {
  /** Working weight per state key of the original (its engine state). */
  weights?: Record<string, number>;
  /** Training max per lift of the original. */
  tms?: Partial<Record<LiftKey, number>>;
  /** GZCLP stage per state key of the original: a tiered exercise keeps the sets and reps of the stage it is on. */
  stages?: Record<string, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function asFixed(s: SetRx): SetRx {
  return s.kind === "fixed" ? s : { kind: "fixed", reps: s.reps, rest: s.rest };
}

/** A percentage of the max: a training-max percentage scaled by tmPct, an RPE set as the share of the max it plans. */
function asPctOfMax(s: SetRx, tmPct: number): SetRx {
  if (s.kind === "pct" || s.kind === "amrap") return { kind: s.kind, pct: s.pct * tmPct, reps: s.reps, rest: s.rest, ...(s.addKg ? { addKg: s.addKg } : {}) };
  if (s.kind === "rpe") return { kind: "pct", pct: weightForRpe(1, s.reps, s.rpe), reps: s.reps, rest: s.rest };
  return s;
}

function fixedRule(t: ProgramTemplate, ex: ExerciseRx, sets: SetRx[]): OwnRule {
  const e = t.engine;
  if (ex.bodyweight || ex.progress === false) return { kind: "manual" };
  if (sets.some((s) => s.kind === "fixed" && typeof s.reps !== "number")) return { kind: "range" };
  const inc = (incs: Partial<Record<LiftKey, number>> | undefined, base: number) => (ex.lift ? incs?.[ex.lift] : undefined) ?? base;
  if (e.key === "linear") return { kind: "linear", incKg: inc(e.increments, e.increment), deloadAfter: e.deloadAfter };
  if (e.key === "tm_cycle" && e.rule === "gzclp" && ex.tier !== "t3") return { kind: "linear", incKg: inc(e.increments, e.increment), deloadAfter: Math.max(1, ex.stages?.length ?? 3) };
  if (e.key === "fixed_volume") return { kind: "linear", incKg: e.increment, deloadAfter: 10 };
  return { kind: "manual" };
}

function withStart(rule: OwnRule, startKg: number | undefined): OwnRule {
  if (startKg === undefined || !(startKg > 0)) return rule;
  if (rule.kind === "linear" || rule.kind === "range" || rule.kind === "manual") return { ...rule, startKg };
  return rule;
}

function convertExercise(t: ProgramTemplate, ex: ExerciseRx, carry: Carry): ExerciseRx {
  const startKg = carry.weights?.[stateKey(ex)];
  // A GZCLP lift converts at the rep scheme it is on now, not its first one.
  const sets = setsFor(ex, carry.stages ?? {});
  const base: ExerciseRx = { name: ex.name, sets };
  if (ex.tier) base.tier = ex.tier;
  if (ex.bodyweight) base.bodyweight = true;
  if (ex.joined) base.joined = true;
  if (ex.notes) base.notes = ex.notes;
  if (ex.rule) return { ...base, ...(ex.lift ? { lift: ex.lift } : {}), rule: withStart(ex.rule, startKg) };
  const pctLike = sets.every((s) => s.kind === "pct" || s.kind === "amrap" || s.kind === "rpe");
  // An RPE-only exercise on a lift the program takes a max for plans from that max, so it stays a percentage of it.
  const fromMax = ex.lift !== undefined && (sets.some((s) => s.kind === "pct" || s.kind === "amrap") || t.lifts.includes(ex.lift));
  if (pctLike && ex.lift && fromMax) {
    return { ...base, lift: ex.lift, sets: sets.map((s) => asPctOfMax(s, t.tmPct)), rule: { kind: "percent" } };
  }
  if (sets.every((s) => s.kind === "rpe")) return { ...base, rule: { kind: "rpe" } };
  const fixed = sets.map(asFixed);
  const mixed = !sets.every((s) => s.kind === "fixed" || s.kind === "same_as_last");
  const rule = mixed ? ({ kind: "manual" } as const) : fixedRule(t, ex, fixed);
  return { ...base, sets: fixed, rule: withStart(rule, startKg) };
}

/** The member-built version of a program, and the maxes that plan the same weights. */
export function toOwnRules(t: ProgramTemplate, carry: Carry = {}): { template: ProgramTemplate; maxes: Partial<Record<LiftKey, number>> } {
  const weeks = t.weeks.map((w) => ({
    ...(w.label ? { label: w.label } : {}),
    days: w.days.map((d) => ({ name: d.name, exercises: d.exercises.map((ex) => convertExercise(t, ex, carry)), ...(d.test ? { test: true } : {}) })),
  }));
  const own = t.engine.key === "own_rules";
  const template: ProgramTemplate = {
    ...t,
    name: (own ? t.name : `My ${t.name}`).slice(0, 80),
    who: "Built by the member.",
    description: own ? t.description : `Based on ${t.name}.`,
    engine: { key: "own_rules" },
    tmPct: 1,
    weeks,
  };
  delete template.warning;
  template.lifts = percentLifts(template);
  const maxes: Partial<Record<LiftKey, number>> = {};
  for (const lift of template.lifts) {
    const tm = carry.tms?.[lift];
    if (tm !== undefined && tm > 0) maxes[lift] = round2(tm / t.tmPct);
  }
  return { template, maxes };
}
