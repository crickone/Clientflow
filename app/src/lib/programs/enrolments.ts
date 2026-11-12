// app/src/lib/programs/enrolments.ts
import "server-only";
import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { clients, programEnrolmentEvents, programEnrolments, workoutSessionExercises, workoutSessions, workoutSetLogs } from "@/lib/db/schema";
import { listExercises } from "@/lib/exerciseLibrary";
import { dateKey, mondayOf, parseWeekdays, planWeek, type PlanDay } from "@/lib/trainingProgress";
import { exerciseHistory, getSession, listSessions, startPlannedSession, type StartResult } from "@/lib/workoutLog";
import { exerciseKey } from "@/lib/workoutLogModel";
import { initState, progress, skipSession } from "./engines";
import { matchLibraryId, namesFor } from "./exercises";
import { programByKey } from "./library";
import { dayAt, planSession, positionOf, stateKey, weekNumber } from "./planner";
import { LIFT_EXERCISE, LIFT_LABEL, emptyState, type EngineState, type LiftKey, type PlannedSession, type ProgramTemplate, type SessionResult, type WeightUnit } from "./types";
import { MAX_SET_REPS, formatWeight, maxFromSet, trainingMax } from "./units";

/**
 * A member running a library program, for the CURRENT tenant (ambient `db`).
 * Member functions take the member's clientId and only ever touch that
 * member's enrolment. Coach functions also take the enrolment id and check it
 * belongs to the client. Every change is written to program_enrolment_events
 * with who made it and why.
 */

export type Actor = { kind: "engine" } | { kind: "member" } | { kind: "staff"; userId: number; name: string };
export type StaffActor = Extract<Actor, { kind: "staff" }>;
export type EnrolmentStatus = "active" | "paused" | "ended";

export interface EnrolmentView {
  id: number;
  clientId: number;
  status: EnrolmentStatus;
  programKey: string | null;
  copyId: number | null;
  /** The snapshot taken at the start: later edits to a gym copy never change it. */
  template: ProgramTemplate;
  state: EngineState;
  startDate: string;
  weekdays: number[];
  unit: WeightUnit;
  stepKg: number;
  createdAt: number;
  endedAt: number | null;
}

export interface EnrolmentEvent {
  id: number;
  at: number;
  actor: string;
  actorName: string | null;
  kind: string;
  reason: string;
  sessionId: number | null;
}

type Row = typeof programEnrolments.$inferSelect;
type Result = { ok: true } | { ok: false; error: string };

const MAX_KG = 600;
const round2 = (n: number) => Math.round(n * 100) / 100;
const clone = (s: EngineState): EngineState => JSON.parse(JSON.stringify(s)) as EngineState;

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function unitsFor(clientId: number): { unit: WeightUnit; stepKg: number } {
  const c = db.select({ unit: clients.weightUnit, step: clients.plateStepKg }).from(clients).where(eq(clients.id, clientId)).get();
  return { unit: c?.unit === "lb" ? "lb" : "kg", stepKg: c && c.step > 0 ? c.step : 2.5 };
}

function toView(row: Row): EnrolmentView | null {
  const template = parseJson<ProgramTemplate | null>(row.templateJson, null);
  if (!template) return null;
  const rest = parseJson<Partial<EngineState>>(row.stateJson, {});
  const state: EngineState = {
    ...emptyState(),
    ...rest,
    week: row.week,
    day: row.day,
    maxes: parseJson(row.maxesJson, {}),
    tms: parseJson(row.tmsJson, {}),
  };
  return {
    id: row.id,
    clientId: row.clientId,
    status: row.status,
    programKey: row.programKey,
    copyId: row.copyId,
    template,
    state,
    startDate: row.startDate,
    weekdays: parseWeekdays(row.weekdays),
    ...unitsFor(row.clientId),
    createdAt: row.createdAt,
    endedAt: row.endedAt,
  };
}

function stateColumns(state: EngineState) {
  const { week, day, maxes, tms, ...rest } = state;
  return { week, day, maxesJson: JSON.stringify(maxes), tmsJson: JSON.stringify(tms), stateJson: JSON.stringify(rest), updatedAt: Date.now() };
}

function saveState(id: number, state: EngineState): void {
  db.update(programEnrolments).set(stateColumns(state)).where(eq(programEnrolments.id, id)).run();
}

function snapshot(s: EngineState) {
  return { week: s.week, day: s.day, cycle: s.cycle, maxes: s.maxes, tms: s.tms, weights: s.weights };
}

function logEvent(enrolmentId: number, actor: Actor, kind: string, reason: string, before: EngineState | null, after: EngineState | null, sessionId: number | null = null): void {
  db.insert(programEnrolmentEvents)
    .values({
      enrolmentId,
      at: Date.now(),
      actor: actor.kind === "staff" ? `staff:${actor.userId}` : actor.kind,
      actorName: actor.kind === "staff" ? actor.name : null,
      kind,
      reason,
      beforeJson: before ? JSON.stringify(snapshot(before)) : null,
      afterJson: after ? JSON.stringify(snapshot(after)) : null,
      sessionId,
    })
    .run();
}

function tmLine(t: ProgramTemplate, s: EngineState, unit: WeightUnit): string {
  const parts = t.lifts.filter((l) => s.tms[l] !== undefined).map((l) => `${LIFT_LABEL[l]} ${formatWeight(s.tms[l]!, unit)}`);
  return parts.length ? ` Training maxes: ${parts.join(", ")}.` : "";
}

function libraryIndex(): { id: number; name: string }[] {
  return listExercises().map((e) => ({ id: e.id, name: e.name }));
}

function maxesProblem(t: ProgramTemplate, maxesKg: Partial<Record<LiftKey, number>>): string | null {
  for (const lift of t.lifts) {
    const m = maxesKg[lift];
    if (!m || !Number.isFinite(m) || m <= 0 || m > MAX_KG) return `Add your ${LIFT_LABEL[lift].toLowerCase()} max.`;
  }
  return null;
}

/** The member's active or paused program, if any. */
export function liveEnrolment(clientId: number): EnrolmentView | null {
  const row = db
    .select()
    .from(programEnrolments)
    .where(and(eq(programEnrolments.clientId, clientId), inArray(programEnrolments.status, ["active", "paused"])))
    .orderBy(desc(programEnrolments.id))
    .get();
  return row ? toView(row) : null;
}

export function getEnrolmentFor(clientId: number, enrolmentId: number): EnrolmentView | null {
  const row = db.select().from(programEnrolments).where(and(eq(programEnrolments.id, enrolmentId), eq(programEnrolments.clientId, clientId))).get();
  return row ? toView(row) : null;
}

/** Every program the member has run, newest first. */
export function listEnrolments(clientId: number): EnrolmentView[] {
  return db
    .select()
    .from(programEnrolments)
    .where(eq(programEnrolments.clientId, clientId))
    .orderBy(desc(programEnrolments.id))
    .all()
    .map(toView)
    .filter((v): v is EnrolmentView => v !== null);
}

/** The change log, newest first. */
export function enrolmentEvents(enrolmentId: number, limit = 50): EnrolmentEvent[] {
  return db
    .select()
    .from(programEnrolmentEvents)
    .where(eq(programEnrolmentEvents.enrolmentId, enrolmentId))
    .orderBy(desc(programEnrolmentEvents.id))
    .limit(limit)
    .all()
    .map((e) => ({ id: e.id, at: e.at, actor: e.actor, actorName: e.actorName, kind: e.kind, reason: e.reason, sessionId: e.sessionId }));
}

export interface EnrolInput {
  key: string;
  maxesKg: Partial<Record<LiftKey, number>>;
  unit: WeightUnit;
  stepKg: number;
  startDate: string;
  weekdays: number[];
}

/** Start a program. One at a time: a live one must be ended first. */
export function enrol(clientId: number, input: EnrolInput): { ok: true; id: number } | { ok: false; error: string } {
  const busy = { ok: false as const, error: "End your current program before you start another." };
  if (liveEnrolment(clientId)) return busy;
  const entry = programByKey(input.key);
  if (!entry) return { ok: false, error: "That program isn't available." };
  const t = entry.template;
  const problem = maxesProblem(t, input.maxesKg);
  if (problem) return { ok: false, error: problem };
  const state = initState(t, input.maxesKg, input.stepKg);
  const now = Date.now();
  let id: number;
  try {
    id = db.transaction((tx) => {
      tx.update(clients).set({ weightUnit: input.unit, plateStepKg: input.stepKg }).where(eq(clients.id, clientId)).run();
      const [row] = tx
        .insert(programEnrolments)
        .values({
          clientId,
          programKey: entry.copyId ? null : t.key,
          copyId: entry.copyId,
          templateJson: JSON.stringify(t),
          ...stateColumns(state),
          status: "active",
          startDate: input.startDate,
          weekdays: parseWeekdays(input.weekdays.join(",")).join(","),
          createdAt: now,
        })
        .returning({ id: programEnrolments.id })
        .all();
      return row.id;
    });
  } catch (err) {
    // The partial unique index allows one live enrolment per member.
    if (String(err).includes("UNIQUE")) return busy;
    throw err;
  }
  logEvent(id, { kind: "member" }, "start", `Started ${t.name}.${tmLine(t, state, input.unit)}`, null, state);
  return { ok: true, id };
}

/** The next session with every weight worked out, or null when finished or ended. */
export function planFor(view: EnrolmentView): PlannedSession | null {
  if (view.status === "ended" || view.state.finished) return null;
  const d = dayAt(view.template, view.state.week, view.state.day);
  if (!d) return null;
  // RPE sets on an exercise with no max of its own take their weight from the member's logs.
  const lib = libraryIndex();
  const keys = d.exercises.map((ex) => exerciseKey(matchLibraryId(ex.name, lib), ex.name));
  const { best } = exerciseHistory(view.clientId, keys);
  const e1rm: Record<string, number> = {};
  d.exercises.forEach((ex, i) => {
    const b = best[keys[i]];
    if (b && !ex.lift) e1rm[stateKey(ex)] = b;
  });
  return planSession(view.template, view.state, { stepKg: view.stepKg, e1rm });
}

/** "Workout A, week 3". */
export function sessionTitle(view: EnrolmentView, plan: PlannedSession): string {
  return `${plan.dayName}, week ${weekNumber(view.template, view.state)}`;
}

/** Start (or resume) the member's next program session in the logger. */
export function startEnrolmentSession(clientId: number): StartResult {
  const view = liveEnrolment(clientId);
  if (!view) return { ok: false, error: "You don't have a program running." };
  if (view.status === "paused") return { ok: false, error: "Your program is paused while you're coach guided." };
  const plan = planFor(view);
  if (!plan) return { ok: false, error: "Your program is finished. Enter your new max to run it again." };
  const lib = libraryIndex();
  return startPlannedSession(clientId, {
    enrolmentId: view.id,
    position: plan.position,
    programTitle: view.template.name,
    dayName: sessionTitle(view, plan),
    exercises: plan.exercises.map((ex) => ({ exerciseId: matchLibraryId(ex.name, lib), name: ex.name, plan: ex })),
  });
}

/**
 * After a program session is finished: run the engine on what the member
 * actually lifted and move the program on. Only the member's current session
 * moves it, so re-saving an old one changes nothing.
 */
export function finishEnrolmentSession(clientId: number, sessionId: number): { reasons: string[]; finished: boolean } | null {
  const session = getSession(clientId, sessionId);
  if (!session?.enrolmentId) return null;
  const view = liveEnrolment(clientId);
  if (!view || view.id !== session.enrolmentId) return null;
  if (view.status !== "active") return { reasons: ["Your program is paused, so it did not move on."], finished: false };
  if (view.state.finished || positionOf(view.template, view.state.week, view.state.day) !== session.dayPosition) {
    const reason = "This wasn't your current session, so your program did not move on.";
    logEvent(view.id, { kind: "member" }, "note", reason, null, null, session.id);
    return { reasons: [reason], finished: view.state.finished };
  }
  const result: SessionResult = {
    exercises: session.exercises
      .filter((e) => e.plan)
      .map((e) => ({ planned: e.plan!, sets: e.sets.map((s) => ({ kg: s.weightKg, reps: s.reps, done: s.done })) })),
  };
  const out = progress({ template: view.template, state: view.state, result, stepKg: view.stepKg, unit: view.unit });
  saveState(view.id, out.state);
  logEvent(view.id, { kind: "engine" }, "progress", out.reasons.join("\n") || "Session done. Nothing changes until the next one.", view.state, out.state, session.id);
  return { reasons: out.reasons, finished: out.state.finished };
}

/** Move past the next session without doing it. Recorded. */
export function skipEnrolmentSession(clientId: number): Result {
  const view = liveEnrolment(clientId);
  if (!view || view.status !== "active" || view.state.finished) return { ok: false, error: "There's no session to skip." };
  const d = dayAt(view.template, view.state.week, view.state.day);
  const out = skipSession(view.template, view.state, view.unit);
  saveState(view.id, out.state);
  const what = `Skipped ${d ? `${d.name}, week ${weekNumber(view.template, view.state)}` : "a session"}.`;
  logEvent(view.id, { kind: "member" }, "skip", [what, ...out.reasons].join("\n"), view.state, out.state);
  return { ok: true };
}

/** End the live program. Its sessions and change log are kept. */
export function endEnrolment(clientId: number, actor: Actor): boolean {
  const view = liveEnrolment(clientId);
  if (!view) return false;
  const now = Date.now();
  db.update(programEnrolments).set({ status: "ended", endedAt: now, updatedAt: now }).where(eq(programEnrolments.id, view.id)).run();
  logEvent(view.id, actor, "end", "Program ended. Its history is kept.", view.state, null);
  return true;
}

/**
 * Coach guided or DIY. Nothing is deleted: switching to coach pauses an
 * active program, switching back to DIY resumes a paused one.
 */
export function setTrainingMode(clientId: number, mode: "coach" | "diy", actor: Actor): boolean {
  const r = db.update(clients).set({ trainingMode: mode }).where(eq(clients.id, clientId)).run();
  if (r.changes === 0) return false;
  const view = liveEnrolment(clientId);
  if (view && mode === "coach" && view.status === "active") {
    db.update(programEnrolments).set({ status: "paused", updatedAt: Date.now() }).where(eq(programEnrolments.id, view.id)).run();
    logEvent(view.id, actor, "pause", "Paused: switched to coach guided.", null, null);
  }
  if (view && mode === "diy" && view.status === "paused") {
    db.update(programEnrolments).set({ status: "active", updatedAt: Date.now() }).where(eq(programEnrolments.id, view.id)).run();
    logEvent(view.id, actor, "resume", "Resumed: switched back to DIY.", null, null);
  }
  return true;
}

/** The member's training weekdays for their program (1 = Monday). */
export function setEnrolmentDays(clientId: number, weekdays: number[]): boolean {
  const view = liveEnrolment(clientId);
  if (!view) return false;
  db.update(programEnrolments)
    .set({ weekdays: parseWeekdays(weekdays.join(",")).join(","), updatedAt: Date.now() })
    .where(eq(programEnrolments.id, view.id))
    .run();
  return true;
}

/** A finished block starts again from the member's new maxes. */
export function restartFromTest(clientId: number, maxesKg: Partial<Record<LiftKey, number>>): Result {
  const view = liveEnrolment(clientId);
  if (!view || view.status !== "active" || !view.state.finished) return { ok: false, error: "Your program isn't at its end yet." };
  const problem = maxesProblem(view.template, maxesKg);
  if (problem) return { ok: false, error: problem };
  const fresh = initState(view.template, maxesKg, view.stepKg);
  fresh.cycle = view.state.cycle + 1;
  saveState(view.id, fresh);
  logEvent(view.id, { kind: "member" }, "restart", `Started ${view.template.name} again.${tmLine(view.template, fresh, view.unit)}`, view.state, fresh);
  return { ok: true };
}

/** A coach corrects a member's max. Working weights that came from it start again from the new one. */
export function coachSetMax(clientId: number, enrolmentId: number, lift: LiftKey, kg: number, actor: StaffActor): Result {
  const view = getEnrolmentFor(clientId, enrolmentId);
  if (!view || view.status === "ended") return { ok: false, error: "That program has ended." };
  if (!view.template.lifts.includes(lift)) return { ok: false, error: "This program doesn't use that lift." };
  if (!Number.isFinite(kg) || kg <= 0 || kg > MAX_KG) return { ok: false, error: "Enter a max between 1 and 600 kg." };
  const next = clone(view.state);
  next.maxes[lift] = round2(kg);
  next.tms[lift] = trainingMax(kg, view.template.tmPct);
  const fresh = initState(view.template, { [lift]: kg }, view.stepKg);
  for (const [k, w] of Object.entries(fresh.weights)) next.weights[k] = w;
  for (const [k, w] of Object.entries(fresh.t2Base)) next.t2Base[k] = w;
  saveState(view.id, next);
  const fmt = (n: number) => formatWeight(n, view.unit);
  const reset = Object.keys(fresh.weights).length ? " Its working weights start again from there." : "";
  logEvent(view.id, actor, "max", `${actor.name} set the ${LIFT_LABEL[lift].toLowerCase()} max to ${fmt(next.maxes[lift]!)}, training max ${fmt(next.tms[lift]!)}.${reset}`, view.state, next);
  return { ok: true };
}

/** A coach moves a member to the start of another week of their program (0-based week). */
export function coachMoveToWeek(clientId: number, enrolmentId: number, weekIndex: number, actor: StaffActor): Result {
  const view = getEnrolmentFor(clientId, enrolmentId);
  if (!view || view.status === "ended") return { ok: false, error: "That program has ended." };
  if (!Number.isInteger(weekIndex) || weekIndex < 0 || weekIndex >= view.template.weeks.length) return { ok: false, error: "That week isn't in the program." };
  const next = clone(view.state);
  next.week = weekIndex;
  next.day = 0;
  next.finished = false;
  saveState(view.id, next);
  logEvent(view.id, actor, "week", `${actor.name} moved the program to week ${weekIndex + 1}.`, view.state, next);
  return { ok: true };
}

/** The member's best logged set of a lift in the last 90 days, 1 to 10 reps, by estimated max. */
export function bestLoggedSet(clientId: number, lift: LiftKey, now = Date.now()): { kg: number; reps: number; e1rm: number; at: number } | null {
  const name = LIFT_EXERCISE[lift];
  const keys = new Set(namesFor(name).map((n) => exerciseKey(null, n)));
  const libId = matchLibraryId(name, libraryIndex());
  if (libId) keys.add(exerciseKey(libId, name));
  const rows = db
    .select({ id: workoutSessionExercises.id, at: workoutSessions.finishedAt })
    .from(workoutSessionExercises)
    .innerJoin(workoutSessions, eq(workoutSessions.id, workoutSessionExercises.sessionId))
    .where(
      and(
        eq(workoutSessions.clientId, clientId),
        isNotNull(workoutSessions.finishedAt),
        gte(workoutSessions.finishedAt, now - 90 * 86400000),
        inArray(workoutSessionExercises.exerciseKey, [...keys]),
      ),
    )
    .all();
  if (rows.length === 0) return null;
  const at = new Map(rows.map((r) => [r.id, r.at as number]));
  const sets = db.select().from(workoutSetLogs).where(inArray(workoutSetLogs.sessionExerciseId, rows.map((r) => r.id))).all();
  let best: { kg: number; reps: number; e1rm: number; at: number } | null = null;
  for (const s of sets) {
    if (!s.done || !s.weightKg || !s.reps || s.reps > MAX_SET_REPS) continue;
    const e1rm = maxFromSet(s.weightKg, s.reps);
    if (e1rm !== null && (!best || e1rm > best.e1rm)) best = { kg: s.weightKg, reps: s.reps, e1rm, at: at.get(s.sessionExerciseId) ?? now };
  }
  return best;
}

/** This week on the member's training days: done, missed, today and planned program sessions. */
export function programWeek(view: EnrolmentView, now = Date.now()): PlanDay[] {
  const names: string[] = [];
  view.template.weeks.forEach((w, wi) => w.days.forEach((d) => names.push(`${d.name}, week ${wi + 1}`)));
  const monday = mondayOf(dateKey(now));
  const logged = listSessions(view.clientId, 30)
    .filter((s) => s.enrolmentId === view.id && mondayOf(dateKey(s.finishedAt!)) === monday)
    .map((s) => ({ at: s.finishedAt!, title: s.dayName }));
  const pos = view.state.finished ? 0 : positionOf(view.template, view.state.week, view.state.day);
  return planWeek({ now, weekdays: view.weekdays, dayNames: names, nextDayPosition: pos, logged });
}
