// app/src/lib/programs/memberEditing.ts
/**
 * Helpers for the member's program builder. The builder edits a copy of its
 * draft and hands it to these (the same style as the gym-copy editor). Week
 * changes keep `origins` in step: for each week, the saved week it came from,
 * so an edit while running can follow the member's week. Pure.
 */
import { canonicalFor } from "./exercises";
import { LIFT_EXERCISE, LIFT_KEYS, type ExerciseRx, type LiftKey, type ProgramTemplate, type RuleKind, type SetRx } from "./types";

export interface BuilderDraft {
  template: ProgramTemplate;
  /** For each week of the template, the saved week it came from; null for a week added since. */
  origins: (number | null)[];
}

export function draftFrom(template: ProgramTemplate, saved: boolean): BuilderDraft {
  return { template, origins: template.weeks.map((_, i) => (saved ? i : null)) };
}

/** 5 kg for a deadlift, 2.5 kg for everything else. */
export function defaultIncKg(name: string): number {
  return /deadlift/i.test(name) ? 5 : 2.5;
}

/** The max an exercise most likely takes its percentages from. */
export function guessLift(name: string): LiftKey {
  const canonical = canonicalFor(name)?.name ?? name;
  const exact = LIFT_KEYS.find((l) => LIFT_EXERCISE[l] === canonical);
  if (exact) return exact;
  const n = name.toLowerCase();
  if (n.includes("deadlift")) return "deadlift";
  if (n.includes("bench")) return "bench";
  if (n.includes("press")) return "press";
  if (n.includes("row")) return "row";
  return "squat";
}

const repsOf = (s: SetRx): number => (typeof s.reps === "number" ? s.reps : s.reps.min);
/** A rep count or a fresh copy of a rep range, so a switched exercise never shares objects with the old one. */
const copyReps = (r: SetRx["reps"]): SetRx["reps"] => (typeof r === "number" ? r : { ...r });
/** A whole index into a list of this length. */
const inRange = (i: number, length: number) => Number.isInteger(i) && i >= 0 && i < length;

/** A new exercise: 3 sets of 5, adding weight each session. */
export function newExercise(name: string): ExerciseRx {
  return { name, sets: [0, 1, 2].map(() => ({ kind: "fixed" as const, reps: 5, rest: 120 })), rule: { kind: "linear", incKg: defaultIncKg(name), deloadAfter: 3 } };
}

function startKgOf(ex: ExerciseRx): number | undefined {
  const r = ex.rule;
  return r && (r.kind === "linear" || r.kind === "range" || r.kind === "manual") ? r.startKg : undefined;
}

/** The exercise under another rule, keeping its sets, reps, rest, notes and start weight where they still make sense. */
export function applyRule(ex: ExerciseRx, kind: RuleKind): ExerciseRx {
  if (ex.rule?.kind === kind) return ex;
  const start = startKgOf(ex);
  const withStart = start !== undefined ? { startKg: start } : {};
  const base: ExerciseRx = { name: ex.name, sets: [] };
  if (ex.tier) base.tier = ex.tier;
  if (ex.bodyweight) base.bodyweight = true;
  if (ex.joined) base.joined = true;
  if (ex.notes) base.notes = ex.notes;
  const sets = ex.sets.length ? ex.sets : [{ kind: "fixed" as const, reps: 5, rest: 120 }];
  switch (kind) {
    case "linear":
      return { ...base, sets: sets.map((s) => ({ kind: "fixed", reps: repsOf(s), rest: s.rest })), rule: { kind: "linear", incKg: defaultIncKg(ex.name), deloadAfter: 3, ...withStart } };
    case "range":
      return {
        ...base,
        sets: sets.map((s) => ({ kind: "fixed", reps: typeof s.reps !== "number" ? { ...s.reps } : { min: s.reps, max: s.reps + 4 }, rest: s.rest })),
        rule: { kind: "range", ...withStart },
      };
    case "percent":
      return {
        ...base,
        lift: ex.lift ?? guessLift(ex.name),
        sets: sets.map((s) => (s.kind === "pct" || s.kind === "amrap" ? { ...s } : { kind: "pct", pct: 0.75, reps: repsOf(s), rest: s.rest })),
        rule: { kind: "percent" },
      };
    case "rpe":
      return { ...base, sets: sets.map((s) => (s.kind === "rpe" ? { ...s } : { kind: "rpe", rpe: 8, reps: repsOf(s), rest: s.rest })), rule: { kind: "rpe" } };
    case "manual":
      return { ...base, sets: sets.map((s) => ({ kind: "fixed", reps: s.kind === "fixed" ? copyReps(s.reps) : repsOf(s), rest: s.rest })), rule: { kind: "manual", ...withStart } };
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** One more set, the same as the last. */
export function addSet(ex: ExerciseRx): void {
  const last = ex.sets[ex.sets.length - 1];
  if (last) ex.sets.push(structuredClone(last));
}

/** Every set's rest, in seconds (0 to 900). Not a number changes nothing. */
export function setRest(ex: ExerciseRx, seconds: number): void {
  if (!Number.isFinite(seconds)) return;
  const rest = Math.max(0, Math.min(900, Math.round(seconds)));
  for (const s of ex.sets) s.rest = rest;
}

function swap<T>(xs: T[], i: number, j: number): boolean {
  if (!inRange(i, xs.length) || !inRange(j, xs.length)) return false;
  [xs[i], xs[j]] = [xs[j], xs[i]];
  return true;
}

/** "Add a week": a copy of week w right after it. Returns the new week's index, or -1 when there is no week w. */
export function addWeek(d: BuilderDraft, w: number): number {
  if (!inRange(w, d.template.weeks.length)) return -1;
  d.template.weeks.splice(w + 1, 0, structuredClone(d.template.weeks[w]));
  d.origins.splice(w + 1, 0, null);
  return w + 1;
}

/** Remove week w; the last week stays. */
export function removeWeek(d: BuilderDraft, w: number): void {
  if (d.template.weeks.length <= 1 || !inRange(w, d.template.weeks.length)) return;
  d.template.weeks.splice(w, 1);
  d.origins.splice(w, 1);
}

/** Move week w one place earlier (-1) or later (1). */
export function moveWeek(d: BuilderDraft, w: number, dir: -1 | 1): boolean {
  return swap(d.template.weeks, w, w + dir) && swap(d.origins, w, w + dir);
}

/** The exercises of day di of week w; null when there is no such day. */
function dayExercises(t: ProgramTemplate, w: number, di: number): ExerciseRx[] | null {
  if (!inRange(w, t.weeks.length) || !inRange(di, t.weeks[w].days.length)) return null;
  return t.weeks[w].days[di].exercises;
}

export function addDay(t: ProgramTemplate, w: number): void {
  if (!inRange(w, t.weeks.length)) return;
  const days = t.weeks[w].days;
  days.push({ name: `Day ${days.length + 1}`, exercises: [] });
}

export function removeDay(t: ProgramTemplate, w: number, di: number): void {
  if (!inRange(w, t.weeks.length) || !inRange(di, t.weeks[w].days.length)) return;
  if (t.weeks[w].days.length > 1) t.weeks[w].days.splice(di, 1);
}

export function moveDay(t: ProgramTemplate, w: number, di: number, dir: -1 | 1): boolean {
  if (!inRange(w, t.weeks.length)) return false;
  return swap(t.weeks[w].days, di, di + dir);
}

export function moveExercise(t: ProgramTemplate, w: number, di: number, xi: number, dir: -1 | 1): boolean {
  const list = dayExercises(t, w, di);
  if (!list) return false;
  const moved = swap(list, xi, xi + dir);
  if (moved && list[0]?.joined) delete list[0].joined;
  return moved;
}

export function removeExercise(t: ProgramTemplate, w: number, di: number, xi: number): void {
  const list = dayExercises(t, w, di);
  if (!list || !inRange(xi, list.length)) return;
  list.splice(xi, 1);
  if (list[0]?.joined) delete list[0].joined;
}
