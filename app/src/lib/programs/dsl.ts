// app/src/lib/programs/dsl.ts
/** Small builders the template files use, so a program reads like its spreadsheet. Pure. */
import type { DayRx, ExerciseRx, LiftKey, Reps, SetRx, WeekRx } from "./types";

export function pct(p: number, reps: number, rest = 180, opts: { addKg?: number; drives?: boolean } = {}): SetRx {
  return { kind: "pct", pct: p, reps, rest, ...(opts.addKg ? { addKg: opts.addKg } : {}), ...(opts.drives ? { drives: true } : {}) };
}

export function amrap(p: number, reps: number, rest = 180, opts: { addKg?: number; drives?: boolean } = {}): SetRx {
  return { kind: "amrap", pct: p, reps, rest, ...(opts.addKg ? { addKg: opts.addKg } : {}), ...(opts.drives ? { drives: true } : {}) };
}

export function rpe(r: number, reps: number, rest = 180): SetRx {
  return { kind: "rpe", rpe: r, reps, rest };
}

export function fixed(reps: Reps, rest = 120, isAmrap = false): SetRx {
  return isAmrap ? { kind: "fixed", reps, rest, amrap: true } : { kind: "fixed", reps, rest };
}

export function range(min: number, max: number): Reps {
  return { min, max };
}

export function times(n: number, s: SetRx): SetRx[] {
  return Array.from({ length: n }, () => ({ ...s }));
}

/** n sets of reps at one percentage: sxr(4, 9, 0.7) is 4 x 9 at 70%. */
export function sxr(n: number, reps: number, p: number, rest = 180, addKg = 0): SetRx[] {
  return times(n, pct(p, reps, rest, { addKg }));
}

export function ex(name: string, sets: SetRx[], opts: Omit<ExerciseRx, "name" | "sets"> = {}): ExerciseRx {
  return { name, sets, ...opts };
}

export function day(name: string, exercises: ExerciseRx[], test = false): DayRx {
  return test ? { name, exercises, test: true } : { name, exercises };
}

export function week(days: DayRx[], label?: string): WeekRx {
  return label ? { label, days } : { days };
}

export const MAX_TEST_NOTE = "Work up to a new 1-rep max. Use safety bars or a spotter. Stop when the bar slows down a lot.";

/** A test-day exercise: warm-ups by percentage, then a max attempt the engine reads. */
export function maxTest(name: string, lift: LiftKey): ExerciseRx {
  return ex(name, [pct(0.5, 5, 120), pct(0.7, 3, 150), pct(0.85, 1, 180), pct(0.95, 1, 240), rpe(10, 1, 300)], { lift, notes: MAX_TEST_NOTE });
}
