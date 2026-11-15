// app/src/lib/programs/progressData.ts
import "server-only";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { programEnrolmentEvents, workoutSessionExercises, workoutSessions, workoutSetLogs } from "@/lib/db/schema";
import type { EnrolmentView } from "./enrolments";
import { weekInRound } from "./planner";
import {
  CHART_LABEL,
  chartKind,
  hasPlusSets,
  liftSeries,
  plusSetRows,
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
  /** The round's first overall week: the chart's x-axis start (1 in round 1). */
  firstWeek: number;
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

/** Sessions read per batch: two queries each, and the walk stops once enough rows exist. */
const BATCH = 12;

/**
 * Finished sessions of this round, newest first, in batches of whole sessions; each exercise's plan and logged sets (oldest session last).
 * Exercises and sets are read for a batch with one `inArray` query each and grouped in memory, as workoutLog's assemble does.
 */
function* loggedBatches(view: EnrolmentView, events: LoggedEvent[]): Generator<LoggedExercise[]> {
  const roundStart = events[0]?.at ?? 0;
  const sessions = db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.enrolmentId, view.id), isNotNull(workoutSessions.finishedAt)))
    .orderBy(desc(workoutSessions.finishedAt), desc(workoutSessions.id))
    .all()
    .filter((s) => (s.finishedAt ?? 0) >= roundStart);
  for (let i = 0; i < sessions.length; i += BATCH) {
    const batch = sessions.slice(i, i + BATCH);
    const exRows = db
      .select()
      .from(workoutSessionExercises)
      .where(and(inArray(workoutSessionExercises.sessionId, batch.map((s) => s.id)), isNotNull(workoutSessionExercises.rxJson)))
      .orderBy(asc(workoutSessionExercises.position), asc(workoutSessionExercises.id))
      .all();
    const setRows = exRows.length
      ? db
          .select()
          .from(workoutSetLogs)
          .where(inArray(workoutSetLogs.sessionExerciseId, exRows.map((e) => e.id)))
          .orderBy(asc(workoutSetLogs.setNumber))
          .all()
      : [];
    const setsBy = new Map<number, LoggedExercise["sets"]>();
    for (const l of setRows) {
      const list = setsBy.get(l.sessionExerciseId) ?? [];
      list.push({ kg: l.weightKg ?? (l.done ? l.targetWeightKg : null), reps: l.reps, done: l.done });
      setsBy.set(l.sessionExerciseId, list);
    }
    const out: LoggedExercise[] = [];
    for (const s of batch) {
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
      // The week as the program names it ("Week 2 of 12, round 2"), not the running count.
      const week = weekInRound(view.template, atState).week;
      for (const ex of exRows) {
        if (ex.sessionId !== s.id) continue;
        let plan: PlannedExercise;
        try {
          plan = JSON.parse(ex.rxJson!) as PlannedExercise;
        } catch {
          continue;
        }
        if (!plan || !Array.isArray(plan.sets)) continue;
        out.push({ session: s.id, at, week, plan, sets: setsBy.get(ex.id) ?? [] });
      }
    }
    yield out;
  }
}

/** The + set (or top set) rows, newest first, at most MAX_ROWS: older sessions are not read once enough rows exist. */
function progressRows(view: EnrolmentView, events: LoggedEvent[], plus: boolean): PlusSetRow[] {
  const fmt = (kg: number) => formatWeight(kg, view.unit);
  const rows: PlusSetRow[] = [];
  for (const batch of loggedBatches(view, events)) {
    // plusSetRows reads a session's exercises in order; the batch holds them oldest exercise first within a session.
    rows.push(...plusSetRows(batch, plus, fmt, view.template.lifts.length > 0));
    if (rows.length >= MAX_ROWS) break;
  }
  return rows.sort((a, b) => b.at - a.at).slice(0, MAX_ROWS);
}

export function programProgress(view: EnrolmentView): ProgramProgressData {
  const t = view.template;
  const plus = hasPlusSets(t);
  const events = roundEvents(view.id);
  const snapshots = events.map((e) => e.after);
  const charts: LiftChart[] = liftSeries(t, snapshots, view.state, view.stepKg, view.unit).map(({ lift, soFar, planned }) => ({
    lift,
    label: LIFT_LABEL[lift],
    soFar,
    planned,
    nowKg: soFar.at(-1)?.kg ?? null,
    endKg: planned.at(-1)?.kg ?? null,
  }));
  const rows = progressRows(view, events, plus);
  const round = weekInRound(t, view.state).round;
  return {
    kind: chartKind(t),
    plus,
    kindLabel: CHART_LABEL[chartKind(t)],
    plannedNote: plus ? "Dashed: if each + set hits its reps" : "Dashed: if you get every rep",
    totalWeeks: round * t.lengthWeeks,
    firstWeek: (round - 1) * t.lengthWeeks + 1,
    charts,
    rowsTitle: plus ? "Your + sets" : "Top sets",
    rows,
    unit: view.unit,
  };
}
