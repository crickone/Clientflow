// app/src/lib/programs/startFlow.ts
/**
 * Starting a program, one question per screen: weights, maxes, days, then a
 * review. The screens share one state, so going back keeps everything. The
 * server checks the entries exactly as before; its error is shown on the
 * screen it belongs to. Pure: the start form runs it in the browser.
 */
import type { LiftKey, WeightUnit } from "./types";
import { convertTyped, maxFromSet, parseWeightIn, type StepKey } from "./units";

export type StartStep = "weights" | "maxes" | "days" | "review";
export const STEP_TITLE: Record<StartStep, string> = { weights: "Weights", maxes: "Maxes", days: "Training days", review: "Review" };

/** The screens in order. A program that takes no max skips the maxes screen. */
export function startSteps(hasMaxes: boolean): StartStep[] {
  return hasMaxes ? ["weights", "maxes", "days", "review"] : ["weights", "days", "review"];
}

export type MaxMode = "one_rm" | "set" | "logged";
export interface MaxRow {
  mode: MaxMode;
  /** As typed, in the member's unit. */
  weight: string;
  reps: string;
}

export interface StartState {
  /** Index into startSteps. */
  at: number;
  unit: WeightUnit;
  step: StepKey;
  rows: MaxRow[];
  startDate: string;
  days: number[];
}

export interface StartLift {
  lift: LiftKey;
  label: string;
  logged: { kg: number; reps: number; e1rm: number } | null;
  /** A max carried from the member's last program, filled in as their 1-rep max. */
  keptKg?: number | null;
}

export function initialStart(input: { lifts: StartLift[]; unit: WeightUnit; step: StepKey; weekdays: number[]; today: string }, keptInUnit: (kg: number) => string): StartState {
  return {
    at: 0,
    unit: input.unit,
    // The smallest jump is always in the member's unit.
    step: input.unit === "lb" ? "5lb" : input.step === "5lb" ? "2.5kg" : input.step,
    rows: input.lifts.map((l) => (l.keptKg ? { mode: "one_rm", weight: keptInUnit(l.keptKg), reps: "" } : { mode: l.logged ? "logged" : "one_rm", weight: "", reps: "" })),
    startDate: input.today,
    days: [...input.weekdays],
  };
}

export type StartAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "go"; at: number }
  | { type: "unit"; unit: WeightUnit }
  | { type: "step"; step: StepKey }
  | { type: "row"; index: number; patch: Partial<MaxRow> }
  | { type: "day"; day: number }
  | { type: "startDate"; value: string };

/** One change to the start flow. `count` is how many screens there are. */
export function reduceStart(s: StartState, a: StartAction, count: number): StartState {
  switch (a.type) {
    case "next":
      return { ...s, at: Math.min(count - 1, s.at + 1) };
    case "back":
      return { ...s, at: Math.max(0, s.at - 1) };
    case "go":
      return { ...s, at: Math.max(0, Math.min(count - 1, a.at)) };
    case "unit":
      if (a.unit === s.unit) return s;
      // A max or set weight already typed in follows the switch.
      return { ...s, unit: a.unit, step: a.unit === "lb" ? "5lb" : "2.5kg", rows: s.rows.map((r) => (r.weight ? { ...r, weight: convertTyped(r.weight, s.unit, a.unit) } : r)) };
    case "step":
      return { ...s, step: a.step };
    case "row":
      return { ...s, rows: s.rows.map((r, i) => (i === a.index ? { ...r, ...a.patch } : r)) };
    case "day":
      return { ...s, days: s.days.includes(a.day) ? s.days.filter((d) => d !== a.day) : [...s.days, a.day].sort((x, y) => x - y) };
    case "startDate":
      return { ...s, startDate: a.value };
    default: {
      const never: never = a;
      return never;
    }
  }
}

/** A row's max in kg, as the server will work it out; null when it can't be read yet. */
export function rowMaxKg(r: MaxRow, lift: Pick<StartLift, "logged">, unit: WeightUnit): number | null {
  if (r.mode === "logged") return lift.logged?.e1rm ?? null;
  const kg = parseWeightIn(r.weight, unit);
  if (kg === null || kg <= 0) return null;
  return r.mode === "one_rm" ? kg : maxFromSet(kg, Number(r.reps));
}

/** Every lift's max that can be read, for the previews and the review. */
export function maxesKg(s: StartState, lifts: StartLift[]): Partial<Record<LiftKey, number>> {
  const out: Partial<Record<LiftKey, number>> = {};
  lifts.forEach((l, i) => {
    const kg = rowMaxKg(s.rows[i], l, s.unit);
    if (kg !== null) out[l.lift] = kg;
  });
  return out;
}

/** The maxes as startProgramAction takes them, weights in the member's unit. */
export function maxEntries(s: StartState, lifts: StartLift[]): { lift: LiftKey; kind: MaxMode; weight: number | null; reps: number | null }[] {
  return s.rows.map((r, i) => ({
    lift: lifts[i].lift,
    kind: r.mode,
    weight: r.mode === "logged" ? null : Number(r.weight.replace(",", ".")) || null,
    reps: r.mode === "set" ? Number(r.reps) || null : null,
  }));
}

/** The screen a server error belongs to, so it shows where it can be fixed. */
export function stepForError(error: string, steps: StartStep[]): number {
  const at = (step: StartStep) => Math.max(0, steps.indexOf(step));
  if (/smallest jump/i.test(error)) return at("weights");
  if (/start date/i.test(error)) return at("days");
  if (steps.includes("maxes") && /\bmax\b|\bset of\b|logged in the last/i.test(error)) return at("maxes");
  return at("review");
}
