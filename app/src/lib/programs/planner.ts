// app/src/lib/programs/planner.ts
/**
 * Template + engine state -> the session a member does next, with every
 * weight worked out. Also position helpers and the text summaries the cards,
 * previews and the logger show. Pure.
 */
import type { DayRx, EngineState, ExerciseRx, PlannedExercise, PlannedSession, PlannedSet, ProgramTemplate, Reps, SetRx, WeightUnit } from "./types";
import { STEP_5LB_KG, formatWeight, kgToUnit, roundToStep, weightForRpe } from "./units";

/**
 * The key an exercise's working weight is kept under: its name, its GZCLP
 * tier, and its rep range, so the same lift done in two rep ranges (PHAT)
 * keeps two weights. A member-built exercise's rule goes in front
 * ("linear:bench press"), so changing the rule starts the exercise again.
 */
export function stateKey(ex: Pick<ExerciseRx, "name" | "tier" | "sets" | "rule">): string {
  const base = ex.name.trim().toLowerCase().replace(/\s+/g, " ");
  const first = ex.sets[0];
  const rangeTag = first && first.kind === "fixed" && typeof first.reps !== "number" ? `@${first.reps.min}-${first.reps.max}` : "";
  return `${ex.rule ? `${ex.rule.kind}:` : ""}${ex.tier ? `${ex.tier}:` : ""}${base}${rangeTag}`;
}

/** The sets an exercise uses now: its current GZCLP stage, or its sets. */
export function setsFor(ex: ExerciseRx, stages: Record<string, number>): SetRx[] {
  if (!ex.stages || ex.stages.length === 0) return ex.sets;
  const i = Math.min(Math.max(0, stages[stateKey(ex)] ?? 0), ex.stages.length - 1);
  return ex.stages[i];
}

/** The engine can move this exercise's weight: fixed-weight sets, not bodyweight, not switched off. */
export function progresses(ex: ExerciseRx): boolean {
  if (ex.bodyweight || ex.progress === false) return false;
  return [...ex.sets, ...(ex.stages ?? []).flat()].some((s) => s.kind === "fixed");
}

export function sessionCount(t: Pick<ProgramTemplate, "weeks">): number {
  return t.weeks.reduce((n, w) => n + w.days.length, 0);
}

export function positionOf(t: Pick<ProgramTemplate, "weeks">, week: number, day: number): number {
  let n = 0;
  for (let w = 0; w < week && w < t.weeks.length; w++) n += t.weeks[w].days.length;
  return n + day;
}

export function dayAt(t: Pick<ProgramTemplate, "weeks">, week: number, day: number): DayRx | null {
  return t.weeks[week]?.days[day] ?? null;
}

export function isLastSession(t: Pick<ProgramTemplate, "weeks">, week: number, day: number): boolean {
  const last = t.weeks.length - 1;
  return week === last && day === t.weeks[last].days.length - 1;
}

/** The position after this one; after the last session it wraps to the start of the next cycle. */
export function advance(
  t: Pick<ProgramTemplate, "weeks">,
  pos: { week: number; day: number; cycle: number },
): { week: number; day: number; cycle: number; wrapped: boolean } {
  const w = t.weeks[pos.week];
  if (w && pos.day + 1 < w.days.length) return { week: pos.week, day: pos.day + 1, cycle: pos.cycle, wrapped: false };
  if (pos.week + 1 < t.weeks.length) return { week: pos.week + 1, day: 0, cycle: pos.cycle, wrapped: false };
  return { week: 0, day: 0, cycle: pos.cycle + 1, wrapped: true };
}

/** "Week 3": weeks run on across repeats of a short cycle. */
export function weekNumber(t: Pick<ProgramTemplate, "weeks">, s: Pick<EngineState, "week" | "cycle">): number {
  return s.cycle * t.weeks.length + s.week + 1;
}

/** Where a week falls in the program's length: week 3 of 8 in round 1, or week 1 of 8 in round 2 once it runs past its length. */
export function weekInRound(t: Pick<ProgramTemplate, "weeks" | "lengthWeeks">, s: Pick<EngineState, "week" | "cycle">): { week: number; of: number; round: number } {
  const n = weekNumber(t, s);
  const len = Math.max(1, t.lengthWeeks);
  return { week: ((n - 1) % len) + 1, of: len, round: Math.floor((n - 1) / len) + 1 };
}

/** "Week 3 of 8", and "Week 1 of 8, round 2" once a program runs past its length (a restart, or a repeat). */
export function weekLabel(t: Pick<ProgramTemplate, "weeks" | "lengthWeeks">, s: Pick<EngineState, "week" | "cycle">): string {
  const r = weekInRound(t, s);
  return r.round === 1 ? `Week ${r.week} of ${r.of}` : `Week ${r.week} of ${r.of}, round ${r.round}`;
}

/** "Workout A, week 3 of 8", or "Workout A, week 1 of 8, round 2": a day named with weekLabel's week. */
export function dayTitle(dayName: string, t: Pick<ProgramTemplate, "weeks" | "lengthWeeks">, s: Pick<EngineState, "week" | "cycle">): string {
  const w = weekLabel(t, s);
  return `${dayName}, ${w.charAt(0).toLowerCase()}${w.slice(1)}`;
}

export interface PlanContext {
  stepKg: number;
  /** Best estimated max per state key, from the member's logs, for RPE sets. */
  e1rm?: Record<string, number>;
  /** Member-built programs: last session's weight per state key, for a fixed set the engine has no weight for yet. */
  lastKg?: Record<string, number>;
}

function repsOf(r: Reps): { reps: number; repsMax: number | null } {
  return typeof r === "number" ? { reps: r, repsMax: null } : { reps: r.min, repsMax: r.max };
}

function planSet(s: SetRx, ex: ExerciseRx, key: string, state: EngineState, ctx: PlanContext, prev: PlannedSet | undefined): PlannedSet {
  switch (s.kind) {
    case "pct":
    case "amrap": {
      const tm = ex.lift ? state.tms[ex.lift] : undefined;
      return {
        kg: tm ? roundToStep(tm * s.pct + (s.addKg ?? 0), ctx.stepKg) : null,
        reps: s.reps,
        repsMax: null,
        amrap: s.kind === "amrap",
        rpe: null,
        pct: s.pct,
        rest: s.rest,
        drives: s.drives === true,
      };
    }
    case "rpe": {
      const e1 = ctx.e1rm?.[key] ?? (ex.lift ? state.maxes[ex.lift] : undefined);
      return { kg: e1 ? roundToStep(weightForRpe(e1, s.reps, s.rpe), ctx.stepKg) : null, reps: s.reps, repsMax: null, amrap: false, rpe: s.rpe, pct: null, rest: s.rest, drives: false };
    }
    case "fixed":
      return { kg: state.weights[key] ?? ctx.lastKg?.[key] ?? null, ...repsOf(s.reps), amrap: s.amrap === true, rpe: null, pct: null, rest: s.rest, drives: false };
    case "same_as_last":
      return { kg: prev ? prev.kg : null, ...repsOf(s.reps), amrap: false, rpe: null, pct: null, rest: s.rest, drives: false };
    default: {
      const never: never = s;
      return never;
    }
  }
}

export function planExercise(ex: ExerciseRx, index: number, state: EngineState, ctx: PlanContext): PlannedExercise {
  const key = stateKey(ex);
  const sets: PlannedSet[] = [];
  for (const s of setsFor(ex, state.stages)) {
    const p = planSet(s, ex, key, state, ctx, sets[sets.length - 1]);
    sets.push(ex.bodyweight ? { ...p, kg: null } : p);
  }
  return {
    index,
    name: ex.name,
    lift: ex.lift ?? null,
    tier: ex.tier ?? null,
    stateKey: key,
    bodyweight: ex.bodyweight === true,
    progresses: progresses(ex),
    joined: ex.joined === true,
    notes: ex.notes ?? null,
    sets,
    ...(ex.rule ? { rule: ex.rule } : {}),
  };
}

/** The session at the state's position, or null when the program is finished. */
export function planSession(t: ProgramTemplate, state: EngineState, ctx: PlanContext): PlannedSession | null {
  if (state.finished) return null;
  const d = dayAt(t, state.week, state.day);
  if (!d) return null;
  return {
    week: state.week,
    day: state.day,
    position: positionOf(t, state.week, state.day),
    dayName: d.name,
    weekLabel: t.weeks[state.week].label ?? null,
    test: d.test === true,
    exercises: d.exercises.map((ex, i) => planExercise(ex, i, state, ctx)),
  };
}

/** "5", "8-12", "5+". */
export function repsLabel(s: Pick<PlannedSet, "reps" | "repsMax" | "amrap">): string {
  return `${s.reps}${s.repsMax !== null && s.repsMax !== s.reps ? `-${s.repsMax}` : ""}${s.amrap ? "+" : ""}`;
}

function groupPieces(pieces: string[]): string {
  const groups: { n: number; piece: string }[] = [];
  for (const piece of pieces) {
    const last = groups[groups.length - 1];
    if (last && last.piece === piece) last.n++;
    else groups.push({ n: 1, piece });
  }
  return groups.map((g) => `${g.n} x ${g.piece}`).join(", then ");
}

/** "4 x 9 at 102.5 kg", "2 x 5 at 40 kg, then 1 x 5+ at 40 kg", "1 x 3 at RPE 8, about 140 kg". */
export function summarisePlanned(sets: PlannedSet[], unit: WeightUnit): string {
  return groupPieces(
    sets.map((s) => {
      const load =
        s.rpe !== null ? ` at RPE ${s.rpe}${s.kg !== null ? `, about ${formatWeight(s.kg, unit)}` : ""}` : s.kg !== null ? ` at ${formatWeight(s.kg, unit)}` : "";
      return `${repsLabel(s)}${load}`;
    }),
  );
}

function repsText(r: Reps): string {
  return typeof r === "number" ? String(r) : `${r.min}-${r.max}`;
}

function pctText(p: number): string {
  return `${Math.round(p * 1000) / 10}%`;
}

/** An add-on weight: "10 kg"; for a member in pounds, "about 20 lb", to the nearest 5 lb jump. */
function addOnText(kg: number, unit: WeightUnit | undefined): string {
  if (unit !== "lb") return `${kg} kg`;
  return `about ${kgToUnit(roundToStep(kg, STEP_5LB_KG), "lb")} lb`;
}

/**
 * "4 x 9 at 70%", "2 x 3 at 80% + 10 kg", "3 x 8-12". With `unit` "lb" an
 * add-on reads in pounds ("+ about 20 lb"); without a unit it stays in kg.
 */
export function summariseRx(sets: SetRx[], unit?: WeightUnit): string {
  return groupPieces(
    sets.map((s) => {
      switch (s.kind) {
        case "pct":
        case "amrap":
          return `${s.reps}${s.kind === "amrap" ? "+" : ""} at ${pctText(s.pct)}${s.addKg ? ` + ${addOnText(s.addKg, unit)}` : ""}`;
        case "rpe":
          return `${s.reps} at RPE ${s.rpe}`;
        case "fixed":
          return `${repsText(s.reps)}${s.amrap ? "+" : ""}`;
        case "same_as_last":
          return `${repsText(s.reps)} at the same weight`;
        default: {
          const never: never = s;
          return never;
        }
      }
    }),
  );
}

/** A GZCLP rep scheme as lifters write it: "5 x 3+", "3 x 10". */
export function schemeLabel(sets: SetRx[]): string {
  const first = sets[0];
  const last = sets[sets.length - 1];
  const plus = !!last && (last.kind === "amrap" || (last.kind === "fixed" && last.amrap === true));
  return `${sets.length} x ${first ? repsText(first.reps) : "0"}${plus ? "+" : ""}`;
}

/** One planned set in the logger's Plan column: "102.5 x 9", "70 x 5+", "RPE 8, 140", "8-12 reps". */
export function planSetLabel(p: PlannedSet, unit: WeightUnit): string {
  const w = p.kg !== null ? String(kgToUnit(p.kg, unit)) : null;
  if (p.rpe !== null) return w ? `RPE ${p.rpe}, ${w}` : `RPE ${p.rpe}`;
  return w ? `${w} x ${repsLabel(p)}` : `${repsLabel(p)} reps`;
}
