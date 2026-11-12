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
/** A write transaction: every change and its change-log event go in one. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
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

function saveState(tx: Tx, id: number, state: EngineState): void {
  tx.update(programEnrolments).set(stateColumns(state)).where(eq(programEnrolments.id, id)).run();
}

/** True while the enrolment is still where `view` saw it, so a change worked out from it can be written. */
function unchanged(tx: Tx, view: EnrolmentView, statuses: EnrolmentStatus[] = ["active"]): boolean {
  const r = tx
    .select({ status: programEnrolments.status, week: programEnrolments.week, day: programEnrolments.day })
    .from(programEnrolments)
    .where(eq(programEnrolments.id, view.id))
    .get();
  return !!r && statuses.includes(r.status) && r.week === view.state.week && r.day === view.state.day;
}

/** A finished session has already moved its program on. */
function progressed(tx: Tx, sessionId: number): boolean {
  return !!tx
    .select({ id: programEnrolmentEvents.id })
    .from(programEnrolmentEvents)
    .where(and(eq(programEnrolmentEvents.sessionId, sessionId), eq(programEnrolmentEvents.kind, "progress")))
    .get();
}

/** A ticked set with no weight typed in was lifted at the weight the program planned. */
function liftedKg(s: { weightKg: number | null; done: boolean; targetKg?: number | null }): number | null {
  return s.weightKg ?? (s.done ? (s.targetKg ?? null) : null);
}

function snapshot(s: EngineState) {
  return { week: s.week, day: s.day, cycle: s.cycle, maxes: s.maxes, tms: s.tms, weights: s.weights };
}

function logEvent(tx: Tx, enrolmentId: number, actor: Actor, kind: string, reason: string, before: EngineState | null, after: EngineState | null, sessionId: number | null = null): void {
  tx.insert(programEnrolmentEvents)
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
  const notDiy = { ok: false as const, error: "Programs are for DIY members. Switch this member to DIY first." };
  const member = db.select({ mode: clients.trainingMode }).from(clients).where(eq(clients.id, clientId)).get();
  if (member?.mode !== "diy") return notDiy;
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
      logEvent(tx, row.id, { kind: "member" }, "start", `Started ${t.name}.${tmLine(t, state, input.unit)}`, null, state);
      return row.id;
    });
  } catch (err) {
    // The partial unique index allows one live enrolment per member.
    if (String(err).includes("UNIQUE")) return busy;
    throw err;
  }
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

/** "Workout A, week 3". Weeks count on across cycles, the same as programWeek. */
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
 * moves it, and only once: a session that is not finished, or that already
 * moved the program, changes nothing and returns null. The engine runs before
 * anything is written; if it throws, nothing is saved and a retry starts from
 * the same place.
 */
export function finishEnrolmentSession(clientId: number, sessionId: number): { reasons: string[]; finished: boolean } | null {
  const session = getSession(clientId, sessionId);
  if (!session?.enrolmentId || !session.finishedAt) return null;
  const view = liveEnrolment(clientId);
  if (!view || view.id !== session.enrolmentId) return null;
  const isFinished = (tx: Tx) =>
    !!tx
      .select({ at: workoutSessions.finishedAt })
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, session.id), eq(workoutSessions.clientId, clientId)))
      .get()?.at;
  if (db.transaction((tx) => progressed(tx, session.id))) return null;
  if (view.status !== "active") return { reasons: ["Your program is paused, so it did not move on."], finished: false };
  if (view.state.finished || positionOf(view.template, view.state.week, view.state.day) !== session.dayPosition) {
    const reason = "This wasn't your current session, so your program did not move on.";
    const noted = db.transaction((tx) => {
      if (!isFinished(tx) || progressed(tx, session.id)) return false;
      logEvent(tx, view.id, { kind: "member" }, "note", reason, null, null, session.id);
      return true;
    });
    return noted ? { reasons: [reason], finished: view.state.finished } : null;
  }
  const result: SessionResult = {
    exercises: session.exercises
      .filter((e) => e.plan)
      .map((e) => ({ planned: e.plan!, sets: e.sets.map((s) => ({ kg: liftedKg(s), reps: s.reps, done: s.done })) })),
  };
  const out = progress({ template: view.template, state: view.state, result, stepKg: view.stepKg, unit: view.unit });
  const reason = out.reasons.join("\n") || "Session done. Nothing changes until the next one.";
  const moved = db.transaction((tx) => {
    if (!isFinished(tx) || progressed(tx, session.id) || !unchanged(tx, view)) return false;
    saveState(tx, view.id, out.state);
    logEvent(tx, view.id, { kind: "engine" }, "progress", reason, view.state, out.state, session.id);
    return true;
  });
  return moved ? { reasons: out.reasons, finished: out.state.finished } : null;
}

/** Move past the next session without doing it. Recorded. */
export function skipEnrolmentSession(clientId: number): Result {
  const view = liveEnrolment(clientId);
  if (!view || view.status !== "active" || view.state.finished) return { ok: false, error: "There's no session to skip." };
  const d = dayAt(view.template, view.state.week, view.state.day);
  const out = skipSession(view.template, view.state, view.unit);
  const what = `Skipped ${d ? `${d.name}, week ${weekNumber(view.template, view.state)}` : "a session"}.`;
  const done = db.transaction((tx) => {
    if (!unchanged(tx, view)) return false;
    saveState(tx, view.id, out.state);
    logEvent(tx, view.id, { kind: "member" }, "skip", [what, ...out.reasons].join("\n"), view.state, out.state);
    return true;
  });
  return done ? { ok: true } : { ok: false, error: "There's no session to skip." };
}

/** End the live program. Its sessions and change log are kept. */
export function endEnrolment(clientId: number, actor: Actor): boolean {
  const view = liveEnrolment(clientId);
  if (!view) return false;
  const now = Date.now();
  return db.transaction((tx) => {
    const r = tx
      .update(programEnrolments)
      .set({ status: "ended", endedAt: now, updatedAt: now })
      .where(and(eq(programEnrolments.id, view.id), inArray(programEnrolments.status, ["active", "paused"])))
      .run();
    if (r.changes === 0) return false;
    logEvent(tx, view.id, actor, "end", "Program ended. Its history is kept.", view.state, null);
    return true;
  });
}

/**
 * Coach guided or DIY. Nothing is deleted: switching to coach pauses an
 * active program, switching back to DIY resumes a paused one.
 */
export function setTrainingMode(clientId: number, mode: "coach" | "diy", actor: Actor): boolean {
  return db.transaction((tx) => {
    const r = tx.update(clients).set({ trainingMode: mode }).where(eq(clients.id, clientId)).run();
    if (r.changes === 0) return false;
    const live = tx
      .select({ id: programEnrolments.id, status: programEnrolments.status })
      .from(programEnrolments)
      .where(and(eq(programEnrolments.clientId, clientId), inArray(programEnrolments.status, ["active", "paused"])))
      .orderBy(desc(programEnrolments.id))
      .get();
    if (live && mode === "coach" && live.status === "active") {
      tx.update(programEnrolments).set({ status: "paused", updatedAt: Date.now() }).where(eq(programEnrolments.id, live.id)).run();
      logEvent(tx, live.id, actor, "pause", "Paused: switched to coach guided.", null, null);
    }
    if (live && mode === "diy" && live.status === "paused") {
      tx.update(programEnrolments).set({ status: "active", updatedAt: Date.now() }).where(eq(programEnrolments.id, live.id)).run();
      logEvent(tx, live.id, actor, "resume", "Resumed: switched back to DIY.", null, null);
    }
    return true;
  });
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
  db.transaction((tx) => {
    saveState(tx, view.id, fresh);
    logEvent(tx, view.id, { kind: "member" }, "restart", `Started ${view.template.name} again.${tmLine(view.template, fresh, view.unit)}`, view.state, fresh);
  });
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
  const fmt = (n: number) => formatWeight(n, view.unit);
  const reset = Object.keys(fresh.weights).length ? " Its working weights start again from there." : "";
  db.transaction((tx) => {
    saveState(tx, view.id, next);
    logEvent(tx, view.id, actor, "max", `${actor.name} set the ${LIFT_LABEL[lift].toLowerCase()} max to ${fmt(next.maxes[lift]!)}, training max ${fmt(next.tms[lift]!)}.${reset}`, view.state, next);
  });
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
  db.transaction((tx) => {
    saveState(tx, view.id, next);
    logEvent(tx, view.id, actor, "week", `${actor.name} moved the program to week ${weekIndex + 1}.`, view.state, next);
  });
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
    const kg = liftedKg({ weightKg: s.weightKg, done: s.done, targetKg: s.targetWeightKg });
    if (!s.done || !kg || !s.reps || s.reps > MAX_SET_REPS) continue;
    const e1rm = maxFromSet(kg, s.reps);
    if (e1rm !== null && (!best || e1rm > best.e1rm)) best = { kg, reps: s.reps, e1rm, at: at.get(s.sessionExerciseId) ?? now };
  }
  return best;
}

/** This week on the member's training days: done, missed, today and planned program sessions. */
export function programWeek(view: EnrolmentView, now = Date.now()): PlanDay[] {
  const t = view.template;
  const perCycle = t.weeks.reduce((n, w) => n + w.days.length, 0);
  // Week numbers count on across cycles (as sessionTitle does), so name this
  // cycle's sessions and enough of the next ones to fill a week.
  const cycle = view.state.cycle + (view.state.finished ? 1 : 0);
  const cycles = perCycle > 0 ? Math.ceil(7 / perCycle) + 1 : 0;
  const names: string[] = [];
  for (let c = 0; c < cycles; c++) {
    t.weeks.forEach((w, wi) => w.days.forEach((d) => names.push(`${d.name}, week ${weekNumber(t, { week: wi, cycle: cycle + c })}`)));
  }
  const monday = mondayOf(dateKey(now));
  const logged = listSessions(view.clientId, 30)
    .filter((s) => s.enrolmentId === view.id && mondayOf(dateKey(s.finishedAt!)) === monday)
    .map((s) => ({ at: s.finishedAt!, title: s.dayName }));
  const pos = view.state.finished ? 0 : positionOf(t, view.state.week, view.state.day);
  return planWeek({ now, weekdays: view.weekdays, dayNames: names, nextDayPosition: pos, logged }).map((d) =>
    d.dayPosition === null ? d : { ...d, dayPosition: d.dayPosition % perCycle },
  );
}
