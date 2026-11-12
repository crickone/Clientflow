// app/src/lib/programs/editing.ts
/** Helpers for the gym-copy editor. Pure. */
import type { ExerciseRx, ProgramTemplate, Reps, SetRx } from "./types";

export const SET_KINDS: { value: SetRx["kind"]; label: string }[] = [
  { value: "pct", label: "% of training max" },
  { value: "amrap", label: "% and as many as you can" },
  { value: "rpe", label: "RPE target" },
  { value: "fixed", label: "Weight from progression" },
  { value: "same_as_last", label: "Same as the set before" },
];

export function repsMin(r: Reps): number {
  return typeof r === "number" ? r : r.min;
}

export function repsMax(r: Reps): number | null {
  return typeof r === "number" ? null : r.max;
}

/** A plain rep count, or a range when the top is above the bottom. */
export function withReps(min: number, max: number | null): Reps {
  return max !== null && max > min ? { min, max } : min;
}

/** Change a set's type, keeping its reps, rest and percentage where they still make sense. */
export function convertSet(s: SetRx, kind: SetRx["kind"]): SetRx {
  const reps = repsMin(s.reps);
  const p = s.kind === "pct" || s.kind === "amrap" ? s.pct : 0.7;
  switch (kind) {
    case "pct":
      return { kind: "pct", pct: p, reps, rest: s.rest };
    case "amrap":
      return { kind: "amrap", pct: p, reps, rest: s.rest };
    case "rpe":
      return { kind: "rpe", rpe: 8, reps, rest: s.rest };
    case "fixed":
      return { kind: "fixed", reps: s.reps, rest: s.rest };
    case "same_as_last":
      return { kind: "same_as_last", reps: s.reps, rest: s.rest };
    default: {
      const never: never = kind;
      return never;
    }
  }
}

export function blankExercise(): ExerciseRx {
  return { name: "Back squat", sets: [{ kind: "fixed", reps: 5, rest: 120 }] };
}

/**
 * True when the program's weeks are its whole length (every fixed block).
 * A gym copy of one is as long as its weeks; a short cycle repeated for
 * longer (StrongLifts' two weeks run for 12) keeps the length it is given.
 */
export function isFullBlock(t: Pick<ProgramTemplate, "weeks" | "lengthWeeks">): boolean {
  return t.weeks.length === t.lengthWeeks;
}

/** The most days in any one week. */
export function mostDays(t: Pick<ProgramTemplate, "weeks">): number {
  return Math.max(1, ...t.weeks.map((w) => w.days.length));
}
