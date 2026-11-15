// app/src/lib/programs/progressSeries.ts
/**
 * A program's progress as chart series: what a lift's training max or working
 * weight has been (from the change-log snapshots), and what it is planned to
 * be to the end of this round if every rep is hit (from the engine). Also the
 * + set rows the Progress screen lists. Pure: no db, no server imports.
 */
import { progress } from "./engines";
import { planSession, progresses, stateKey, weekInRound, weekNumber } from "./planner";
import { perfect } from "./simulate";
import { emptyState, type EngineState, type LiftKey, type PlannedExercise, type PlannedSession, type ProgramTemplate, type SessionResult, type SetRx, type WeightUnit } from "./types";

export type ChartKind = "tm" | "weight" | "top";

/** What the chart plots: the training max (tm_cycle except GZCLP), the working weight (linear, GZCLP, double_progression, fixed_volume, own_rules), or the planned top set each week (fixed_block). */
export function chartKind(t: ProgramTemplate): ChartKind {
  const e = t.engine;
  if (e.key === "fixed_block") return "top";
  if (e.key === "tm_cycle" && e.rule !== "gzclp") return "tm";
  return "weight";
}

export const CHART_LABEL: Record<ChartKind, string> = { tm: "Training max", weight: "Working weight", top: "Top set" };

/** The heaviest planned set of a lift in the state's week, across all that week's days; test days are skipped. */
function topSetKg(t: ProgramTemplate, state: EngineState, lift: LiftKey, stepKg: number): number | null {
  const week = t.weeks[state.week];
  if (!week || state.finished) return null;
  let best: number | null = null;
  for (let d = 0; d < week.days.length; d++) {
    const plan = planSession(t, { ...state, day: d }, { stepKg });
    if (!plan || plan.test) continue;
    for (const ex of plan.exercises) {
      if (ex.lift !== lift) continue;
      for (const set of ex.sets) if (set.kg !== null && (best === null || set.kg > best)) best = set.kg;
    }
  }
  return best;
}

/** The plotted value for one lift in one state, in kg, or null. */
export function liftValue(t: ProgramTemplate, state: EngineState, lift: LiftKey, stepKg: number): number | null {
  switch (chartKind(t)) {
    case "tm":
      return state.tms[lift] ?? null;
    case "weight": {
      for (const w of t.weeks)
        for (const d of w.days)
          for (const ex of d.exercises)
            if (ex.lift === lift && progresses(ex)) return state.weights[stateKey(ex)] ?? null;
      return null;
    }
    case "top":
      return topSetKg(t, state, lift, stepKg);
  }
}

/** The lifts a chart can be drawn for: the template's lifts that have a value in `state`. Empty when none. */
export function chartLifts(t: ProgramTemplate, state: EngineState, stepKg: number): LiftKey[] {
  return t.lifts.filter((l) => liftValue(t, state, l, stepKg) !== null);
}

export interface SeriesPoint {
  week: number;
  kg: number;
}

/** A change-log snapshot as stored in program_enrolment_events.after_json. */
export interface Snapshot {
  week: number;
  day: number;
  cycle: number;
  maxes: EngineState["maxes"];
  tms: EngineState["tms"];
  weights: EngineState["weights"];
}

function toPoints(byWeek: Map<number, number>): SeriesPoint[] {
  return [...byWeek.entries()].sort((a, b) => a[0] - b[0]).map(([week, kg]) => ({ week, kg }));
}

/** The value after each recorded change since the latest start or restart, one point per program week (the last value in that week wins). */
export function soFarSeries(t: ProgramTemplate, snapshots: Snapshot[], lift: LiftKey, stepKg: number): SeriesPoint[] {
  const byWeek = new Map<number, number>();
  for (const snap of snapshots) {
    const state: EngineState = { ...emptyState(), ...snap };
    const kg = liftValue(t, state, lift, stepKg);
    if (kg !== null) byWeek.set(weekNumber(t, state), kg);
  }
  return toPoints(byWeek);
}

const MAX_SESSIONS = 400;

/** From the current state to the end of this round of the program, every planned rep hit: one point per program week. */
export function plannedSeries(t: ProgramTemplate, state: EngineState, lift: LiftKey, stepKg: number, unit: WeightUnit): SeriesPoint[] {
  let s: EngineState = structuredClone(state);
  const end = weekInRound(t, s).round * t.lengthWeeks;
  const byWeek = new Map<number, number>();
  // The first point is the value as it stands now, so the planned line starts where the so-far line ends.
  // Later sessions in the same week never overwrite it; later weeks keep the last value in the week.
  const startWeek = weekNumber(t, s);
  const startKg = liftValue(t, s, lift, stepKg);
  if (startKg !== null && startWeek <= end) byWeek.set(startWeek, startKg);
  const pinned = byWeek.has(startWeek);
  const record = () => {
    const week = weekNumber(t, s);
    if (week > end || (pinned && week === startWeek)) return;
    const kg = liftValue(t, s, lift, stepKg);
    if (kg !== null) byWeek.set(week, kg);
  };
  for (let n = 0; n < MAX_SESSIONS; n++) {
    const plan = planSession(t, s, { stepKg });
    if (!plan || weekNumber(t, s) > end) break;
    const out = progress({ template: t, state: s, result: perfectResult(plan), stepKg, unit });
    s = out.state;
    record();
  }
  return toPoints(byWeek);
}

/** Every set done as planned: the top of a rep range, + sets two over. */
function perfectResult(session: PlannedSession): SessionResult {
  return {
    exercises: session.exercises.map((exercise) => ({
      planned: exercise,
      sets: exercise.sets.map((set, setIndex) => perfect({ n: 0, session, exercise, set, setIndex })),
    })),
  };
}

function setHasPlus(s: SetRx): boolean {
  if (s.kind === "amrap") return true;
  if (s.kind === "fixed") return s.amrap === true;
  if (s.kind === "pct") return s.drives === true;
  return false;
}

export function hasPlusSets(t: ProgramTemplate): boolean {
  return t.weeks.some((w) => w.days.some((d) => d.exercises.some((ex) => [...ex.sets, ...(ex.stages ?? []).flat()].some(setHasPlus))));
}

export interface LoggedExercise {
  at: number;
  week: number;
  plan: PlannedExercise;
  sets: { kg: number | null; reps: number | null; done: boolean }[];
}

export interface PlusSetRow {
  at: number;
  week: number;
  lift: string;
  planned: string;
  got: string;
}

/** The + sets (AMRAP or drives) logged, newest first; for programs without + sets, the heaviest done set of each logged exercise that has a lift. */
export function plusSetRows(rows: LoggedExercise[], plus: boolean, fmt: (kg: number) => string): PlusSetRow[] {
  const out: PlusSetRow[] = [];
  for (const row of rows) {
    if (plus) {
      row.plan.sets.forEach((p, i) => {
        const d = row.sets[i];
        if (!(p.amrap || p.drives) || !d || !d.done || d.reps === null) return;
        const planned = p.pct !== null ? `${Math.round(p.pct * 1000) / 10}% x ${p.reps}+` : `${p.reps}+`;
        const load = d.kg === null ? "Bodyweight" : fmt(d.kg);
        out.push({ at: row.at, week: row.week, lift: row.plan.name, planned, got: `${load} x ${d.reps}` });
      });
    } else if (row.plan.lift) {
      let best: { kg: number; reps: number } | null = null;
      row.sets.forEach((d) => {
        if (!d.done || d.kg === null || d.reps === null) return;
        if (best === null || d.kg > best.kg) best = { kg: d.kg, reps: d.reps };
      });
      const b = best as { kg: number; reps: number } | null;
      if (b) out.push({ at: row.at, week: row.week, lift: row.plan.name, planned: planLabel(row.plan), got: `${fmt(b.kg)} x ${b.reps}` });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

/** "5 sets" style summary of the plan for a top-set row. */
function planLabel(p: PlannedExercise): string {
  const first = p.sets[0];
  if (!first) return "";
  return `${p.sets.length} x ${first.reps}${first.repsMax !== null && first.repsMax !== first.reps ? `-${first.repsMax}` : ""}`;
}
