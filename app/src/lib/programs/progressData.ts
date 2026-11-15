// app/src/lib/programs/progressData.ts
import "server-only";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { programEnrolmentEvents, workoutSessionExercises, workoutSessions, workoutSetLogs } from "@/lib/db/schema";
import type { EnrolmentView } from "./enrolments";
import { weekInRound, weekNumber } from "./planner";
import {
  CHART_LABEL,
  chartKind,
  chartLifts,
  hasPlusSets,
  plannedSeries,
  plusSetRows,
  soFarSeries,
  type ChartKind,
  type LoggedExercise,
  type PlusSetRow,
  type SeriesPoint,
  type Snapshot,
} from "./progressSeries";
import { LIFT_LABEL, type LiftKey, type PlannedExercise, type WeightUnit } from "./types";
import { formatWeight } from "./units";

/**
 * One enrolment's progress, ready to draw: per-lift chart series from the
 * change log and the engine, and the + set rows from the logged sessions.
 * Reads the CURRENT tenant's db (ambient `db`).
 */

export interface LiftChart {
  lift: LiftKey;
  label: string;
  soFar: SeriesPoint[];
  planned: SeriesPoint[];
  nowKg: number | null;
  endKg: number | null;
}

export interface ProgramProgressData {
  /** What the charts plot: a training max, a working weight or a top set. */
  kind: ChartKind;
  /** The program has + sets (AMRAP or drives): the dashed note and the row list read from it. */
  plus: boolean;
  /** "Training max" | "Working weight" | "Top set". */
  kindLabel: string;
  /** What the dashed line means. */
  plannedNote: string;
  /** The round's last overall week: the chart's x-axis end. */
  totalWeeks: number;
  /** Empty when the program has no lifts. */
  charts: LiftChart[];
  /** "Your + sets" | "Top sets". */
  rowsTitle: string;
  /** Newest first, at most 12. */
  rows: PlusSetRow[];
  unit: WeightUnit;
}

const SNAPSHOT_KINDS = ["start", "restart", "progress", "skip", "edit", "max", "week"];
const MAX_ROWS = 12;

interface LoggedEvent {
  at: number;
  kind: string;
  sessionId: number | null;
  before: Snapshot | null;
  after: Snapshot;
}

function parse(json: string | null): Snapshot | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as Snapshot;
    return typeof s.week === "number" && typeof s.cycle === "number" ? s : null;
  } catch {
    return null;
  }
}

/** The change-log snapshots since the latest start or restart, oldest first. */
function roundEvents(enrolmentId: number): LoggedEvent[] {
  const rows = db
    .select()
    .from(programEnrolmentEvents)
    .where(and(eq(programEnrolmentEvents.enrolmentId, enrolmentId), inArray(programEnrolmentEvents.kind, SNAPSHOT_KINDS), isNotNull(programEnrolmentEvents.afterJson)))
    .orderBy(asc(programEnrolmentEvents.id))
    .all();
  const events: LoggedEvent[] = [];
  for (const r of rows) {
    const after = parse(r.afterJson);
    if (!after) continue;
    if (r.kind === "start" || r.kind === "restart") events.length = 0;
    events.push({ at: r.at, kind: r.kind, sessionId: r.sessionId, before: parse(r.beforeJson), after });
  }
  return events;
}

/** Finished sessions of this round, each exercise's plan and logged sets, oldest first. */
function loggedExercises(view: EnrolmentView, events: LoggedEvent[]): LoggedExercise[] {
  const roundStart = events[0]?.at ?? 0;
  const sessions = db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.enrolmentId, view.id), isNotNull(workoutSessions.finishedAt)))
    .orderBy(asc(workoutSessions.finishedAt), asc(workoutSessions.id))
    .all()
    .filter((s) => (s.finishedAt ?? 0) >= roundStart);
  const out: LoggedExercise[] = [];
  for (const s of sessions) {
    const at = s.finishedAt!;
    // The week the session was done in: the progress event written for this very
    // session holds the state before it moved (week + cycle). A session that did
    // not move the program has none, so fall back to the latest snapshot at or
    // before the session finished, then to the current state.
    const own = events.find((e) => e.kind === "progress" && e.sessionId === s.id && e.before);
    let atState: { week: number; cycle: number } = view.state;
    if (own?.before) atState = own.before;
    else {
      const prior = [...events].reverse().find((e) => e.at <= at);
      if (prior) atState = prior.after;
    }
    const week = weekNumber(view.template, atState);
    const exercises = db
      .select()
      .from(workoutSessionExercises)
      .where(and(eq(workoutSessionExercises.sessionId, s.id), isNotNull(workoutSessionExercises.rxJson)))
      .orderBy(asc(workoutSessionExercises.position), asc(workoutSessionExercises.id))
      .all();
    for (const ex of exercises) {
      let plan: PlannedExercise;
      try {
        plan = JSON.parse(ex.rxJson!) as PlannedExercise;
      } catch {
        continue;
      }
      const sets = db
        .select()
        .from(workoutSetLogs)
        .where(eq(workoutSetLogs.sessionExerciseId, ex.id))
        .orderBy(asc(workoutSetLogs.setNumber))
        .all()
        .map((l) => ({ kg: l.weightKg ?? (l.done ? l.targetWeightKg : null), reps: l.reps, done: l.done }));
      out.push({ at, week, plan, sets });
    }
  }
  return out;
}

export function programProgress(view: EnrolmentView): ProgramProgressData {
  const t = view.template;
  const plus = hasPlusSets(t);
  const events = roundEvents(view.id);
  const snapshots = events.map((e) => e.after);
  const charts: LiftChart[] = chartLifts(t, view.state, view.stepKg).map((lift) => {
    const soFar = soFarSeries(t, snapshots, lift, view.stepKg);
    const planned = plannedSeries(t, view.state, lift, view.stepKg, view.unit);
    return { lift, label: LIFT_LABEL[lift], soFar, planned, nowKg: soFar.at(-1)?.kg ?? null, endKg: planned.at(-1)?.kg ?? null };
  });
  const rows = plusSetRows(loggedExercises(view, events), plus, (kg) => formatWeight(kg, view.unit)).slice(0, MAX_ROWS);
  return {
    kind: chartKind(t),
    plus,
    kindLabel: CHART_LABEL[chartKind(t)],
    plannedNote: plus ? "Dashed: if each + set hits its reps" : "Dashed: if you get every rep",
    totalWeeks: weekInRound(t, view.state).round * t.lengthWeeks,
    charts,
    rowsTitle: plus ? "Your + sets" : "Top sets",
    rows,
    unit: view.unit,
  };
}
