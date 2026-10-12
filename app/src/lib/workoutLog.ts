import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { workoutSessionExercises, workoutSessions, workoutSetLogs, type WorkoutSession } from "@/lib/db/schema";
import type { ProgramInput } from "@/lib/workoutModel";
import { bestSet, exerciseKey, setsDone, volumeKg, type LoggedSet, type SessionExercise, type SessionView } from "@/lib/workoutLogModel";

/**
 * Workout logging for the CURRENT tenant (ambient `db`). Every function that
 * reads or writes a session takes the member's clientId and checks it against
 * the session row, so a member can only ever see or change their own log.
 */

const MAX_SETS = 20;

export type StartResult = { ok: true; sessionId: number } | { ok: false; error: string; inProgressId?: number };

/**
 * Start (or resume) a log of one day of an assigned programme. The caller has
 * already confirmed the programme is assigned to this member. A workout left
 * open elsewhere with nothing ticked is dropped; one with work in it blocks,
 * so a member never has two half-done logs.
 */
export function startSession(clientId: number, program: ProgramInput, dayPosition: number): StartResult {
  const day = program.days[dayPosition];
  if (!program.id || program.type !== "detailed" || !day) return { ok: false, error: "That day isn't in your programme." };
  const exercises = day.exercises.filter((e) => e.name.trim());
  if (exercises.length === 0) return { ok: false, error: "This day has no exercises yet." };

  const open = db.select().from(workoutSessions).where(and(eq(workoutSessions.clientId, clientId), isNull(workoutSessions.finishedAt))).all();
  for (const s of open) {
    if (s.programId === program.id && s.dayPosition === dayPosition) return { ok: true, sessionId: s.id };
    const view = getSession(clientId, s.id);
    if (view && setsDone(view.exercises).done === 0) {
      db.delete(workoutSessions).where(eq(workoutSessions.id, s.id)).run();
    } else {
      return { ok: false, error: `Finish or discard your ${s.dayName} workout first.`, inProgressId: s.id };
    }
  }

  return db.transaction((tx) => {
    const now = Date.now();
    const [row] = tx
      .insert(workoutSessions)
      .values({ clientId, programId: program.id!, dayPosition, programTitle: program.title, dayName: day.name || `Day ${dayPosition + 1}`, startedAt: now, updatedAt: now })
      .returning({ id: workoutSessions.id })
      .all();
    exercises.forEach((ex, i) => {
      const [exRow] = tx
        .insert(workoutSessionExercises)
        .values({
          sessionId: row.id,
          position: i,
          section: ex.section,
          exerciseKey: exerciseKey(ex.exerciseId, ex.name),
          name: ex.name.trim(),
          targetSets: Math.max(1, Math.min(MAX_SETS, ex.sets || 1)),
          targetReps: ex.reps,
          restSeconds: ex.restSeconds,
          notes: ex.notes,
        })
        .returning({ id: workoutSessionExercises.id })
        .all();
      const n = Math.max(1, Math.min(MAX_SETS, ex.sets || 1));
      for (let k = 1; k <= n; k++) tx.insert(workoutSetLogs).values({ sessionExerciseId: exRow.id, setNumber: k, done: false }).run();
    });
    return { ok: true as const, sessionId: row.id };
  });
}

function assemble(rows: WorkoutSession[]): SessionView[] {
  if (rows.length === 0) return [];
  const exRows = db
    .select()
    .from(workoutSessionExercises)
    .where(inArray(workoutSessionExercises.sessionId, rows.map((r) => r.id)))
    .orderBy(asc(workoutSessionExercises.position))
    .all();
  const setRows = exRows.length
    ? db
        .select()
        .from(workoutSetLogs)
        .where(inArray(workoutSetLogs.sessionExerciseId, exRows.map((e) => e.id)))
        .orderBy(asc(workoutSetLogs.setNumber))
        .all()
    : [];
  const setsBy = new Map<number, LoggedSet[]>();
  for (const s of setRows) {
    const list = setsBy.get(s.sessionExerciseId) ?? [];
    list.push({ weightKg: s.weightKg, reps: s.reps, done: s.done });
    setsBy.set(s.sessionExerciseId, list);
  }
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    programId: r.programId,
    dayPosition: r.dayPosition,
    programTitle: r.programTitle,
    dayName: r.dayName,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    exercises: exRows
      .filter((e) => e.sessionId === r.id)
      .map(
        (e): SessionExercise => ({
          id: e.id,
          section: e.section,
          exerciseKey: e.exerciseKey,
          name: e.name,
          targetSets: e.targetSets,
          targetReps: e.targetReps,
          restSeconds: e.restSeconds,
          notes: e.notes,
          sets: setsBy.get(e.id) ?? [],
        }),
      ),
  }));
}

/** One session, only if it belongs to this member. */
export function getSession(clientId: number, sessionId: number): SessionView | null {
  const row = db.select().from(workoutSessions).where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.clientId, clientId))).get();
  return row ? assemble([row])[0] : null;
}

export function openSession(clientId: number): SessionView | null {
  const row = db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.clientId, clientId), isNull(workoutSessions.finishedAt)))
    .orderBy(desc(workoutSessions.startedAt))
    .get();
  return row ? assemble([row])[0] : null;
}

/** Finished sessions, newest first. */
export function listSessions(clientId: number, limit = 50): SessionView[] {
  const rows = db
    .select()
    .from(workoutSessions)
    .where(and(eq(workoutSessions.clientId, clientId), isNotNull(workoutSessions.finishedAt)))
    .orderBy(desc(workoutSessions.finishedAt))
    .limit(limit)
    .all();
  return assemble(rows);
}

export interface SaveExercise {
  id: number;
  sets: LoggedSet[];
}

/**
 * Replace the sets of the given exercises. Exercise ids that aren't in this
 * member's session are ignored, so a forged id writes nothing.
 */
export function saveSessionSets(clientId: number, sessionId: number, exercises: SaveExercise[]): boolean {
  const session = db.select().from(workoutSessions).where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.clientId, clientId))).get();
  if (!session) return false;
  const owned = new Set(
    db.select({ id: workoutSessionExercises.id }).from(workoutSessionExercises).where(eq(workoutSessionExercises.sessionId, sessionId)).all().map((r) => r.id),
  );
  db.transaction((tx) => {
    for (const ex of exercises) {
      if (!owned.has(ex.id)) continue;
      tx.delete(workoutSetLogs).where(eq(workoutSetLogs.sessionExerciseId, ex.id)).run();
      ex.sets.slice(0, MAX_SETS).forEach((s, i) => {
        tx.insert(workoutSetLogs).values({ sessionExerciseId: ex.id, setNumber: i + 1, weightKg: s.weightKg, reps: s.reps, done: s.done }).run();
      });
    }
    tx.update(workoutSessions).set({ updatedAt: Date.now() }).where(eq(workoutSessions.id, sessionId)).run();
  });
  return true;
}

export function finishSession(clientId: number, sessionId: number): boolean {
  const r = db
    .update(workoutSessions)
    .set({ finishedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.clientId, clientId), isNull(workoutSessions.finishedAt)))
    .run();
  return r.changes > 0;
}

export function deleteSession(clientId: number, sessionId: number): boolean {
  return db.delete(workoutSessions).where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.clientId, clientId))).run().changes > 0;
}

/**
 * For each exercise key: the sets from the most recent OTHER finished session
 * that had it, and the best estimated max across all of those sessions.
 */
export function exerciseHistory(
  clientId: number,
  keys: string[],
  excludeSessionId?: number,
): { previous: Record<string, LoggedSet[]>; best: Record<string, number> } {
  const previous: Record<string, LoggedSet[]> = {};
  const best: Record<string, number> = {};
  if (keys.length === 0) return { previous, best };
  const conds = [eq(workoutSessions.clientId, clientId), isNotNull(workoutSessions.finishedAt), inArray(workoutSessionExercises.exerciseKey, keys)];
  if (excludeSessionId) conds.push(ne(workoutSessions.id, excludeSessionId));
  const exRows = db
    .select({ id: workoutSessionExercises.id, key: workoutSessionExercises.exerciseKey, finishedAt: workoutSessions.finishedAt })
    .from(workoutSessionExercises)
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSessionExercises.sessionId))
    .where(and(...conds))
    .orderBy(desc(workoutSessions.finishedAt))
    .all();
  if (exRows.length === 0) return { previous, best };
  const sets = db.select().from(workoutSetLogs).where(inArray(workoutSetLogs.sessionExerciseId, exRows.map((r) => r.id))).orderBy(asc(workoutSetLogs.setNumber)).all();
  const setsBy = new Map<number, LoggedSet[]>();
  for (const s of sets) {
    const list = setsBy.get(s.sessionExerciseId) ?? [];
    list.push({ weightKg: s.weightKg, reps: s.reps, done: s.done });
    setsBy.set(s.sessionExerciseId, list);
  }
  for (const r of exRows) {
    const list = setsBy.get(r.id) ?? [];
    const done = list.filter((s) => s.done);
    if (!(r.key in previous) && done.length > 0) previous[r.key] = list;
    const b = bestSet(list);
    if (b && (best[r.key] === undefined || b.e1rm > best[r.key])) best[r.key] = b.e1rm;
  }
  return { previous, best };
}

export interface LiftRecord {
  exerciseKey: string;
  name: string;
  weightKg: number;
  reps: number;
  e1rm: number;
  at: number;
  sessions: number;
}

/** The member's best set on every lift they've logged with a weight, strongest first. */
export function liftRecords(clientId: number): LiftRecord[] {
  const sessions = listSessions(clientId, 500);
  const by = new Map<string, LiftRecord>();
  for (const s of sessions) {
    for (const ex of s.exercises) {
      const b = bestSet(ex.sets);
      if (!b) continue;
      const cur = by.get(ex.exerciseKey);
      if (!cur) by.set(ex.exerciseKey, { exerciseKey: ex.exerciseKey, name: ex.name, weightKg: b.weightKg, reps: b.reps, e1rm: b.e1rm, at: s.finishedAt!, sessions: 1 });
      else {
        cur.sessions++;
        if (b.e1rm > cur.e1rm) Object.assign(cur, { weightKg: b.weightKg, reps: b.reps, e1rm: b.e1rm, at: s.finishedAt! });
      }
    }
  }
  return [...by.values()].sort((a, b) => b.e1rm - a.e1rm);
}

/** One lift over time: the best set of each session it appeared in, oldest first. */
export function liftProgress(clientId: number, key: string): { name: string; points: { at: number; weightKg: number; reps: number; e1rm: number }[] } | null {
  const rows = db
    .select({ id: workoutSessionExercises.id, name: workoutSessionExercises.name, at: workoutSessions.finishedAt })
    .from(workoutSessionExercises)
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSessionExercises.sessionId))
    .where(and(eq(workoutSessions.clientId, clientId), isNotNull(workoutSessions.finishedAt), eq(workoutSessionExercises.exerciseKey, key)))
    .orderBy(asc(workoutSessions.finishedAt))
    .all();
  if (rows.length === 0) return null;
  const sets = db.select().from(workoutSetLogs).where(inArray(workoutSetLogs.sessionExerciseId, rows.map((r) => r.id))).all();
  const points: { at: number; weightKg: number; reps: number; e1rm: number }[] = [];
  for (const r of rows) {
    const b = bestSet(sets.filter((s) => s.sessionExerciseId === r.id).map((s) => ({ weightKg: s.weightKg, reps: s.reps, done: s.done })));
    if (b) points.push({ at: r.at!, ...b });
  }
  return { name: rows[rows.length - 1].name, points };
}

export function sessionSummary(s: SessionView): { volume: number; done: number; total: number; minutes: number | null } {
  const c = setsDone(s.exercises);
  return { volume: volumeKg(s.exercises), done: c.done, total: c.total, minutes: s.finishedAt ? Math.round((s.finishedAt - s.startedAt) / 60000) : null };
}
