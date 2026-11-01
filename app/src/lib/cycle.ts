import "server-only";

import { and, desc, eq, gte } from "drizzle-orm";

import { db } from "@/lib/db";
import { cycleDays, cyclePeriods, cycleSettings } from "@/lib/db/schema";
import { dateKey } from "@/lib/trainingProgress";
import {
  addDays,
  averagesByPhase,
  calendar,
  cycleStatus,
  isDayKey,
  periodOn,
  sortPeriods,
  type CalendarMonth,
  type CycleStatus,
  type DayField,
  type DayLog,
  type Period,
  type Phase,
} from "@/lib/cycleModel";

/**
 * Cycle tracking for the CURRENT tenant (ambient `db`). Health data under
 * GDPR: nothing is read or written without a consent row, the coach sees it
 * only while the member shares it, and deleting wipes every row.
 */

export interface CycleSettings {
  consentAt: number;
  shareWithCoach: boolean;
  mode: "cycle" | "none";
}

export function cycleSettingsFor(clientId: number): CycleSettings | null {
  const r = db.select().from(cycleSettings).where(eq(cycleSettings.clientId, clientId)).get();
  return r ? { consentAt: r.consentAt, shareWithCoach: r.shareWithCoach, mode: r.mode } : null;
}

/** The member turns tracking on. Idempotent: a second consent keeps the first date. */
export function giveCycleConsent(clientId: number): void {
  const now = Date.now();
  db.insert(cycleSettings).values({ clientId, consentAt: now, shareWithCoach: false, mode: "cycle", updatedAt: now }).onConflictDoNothing().run();
}

export function updateCycleSettings(clientId: number, patch: Partial<Pick<CycleSettings, "shareWithCoach" | "mode">>): boolean {
  if (!cycleSettingsFor(clientId)) return false;
  db.update(cycleSettings).set({ ...patch, updatedAt: Date.now() }).where(eq(cycleSettings.clientId, clientId)).run();
  return true;
}

/** Everything, gone: settings, periods and check-ins. */
export function deleteCycleData(clientId: number): void {
  db.transaction((tx) => {
    tx.delete(cycleDays).where(eq(cycleDays.clientId, clientId)).run();
    tx.delete(cyclePeriods).where(eq(cyclePeriods.clientId, clientId)).run();
    tx.delete(cycleSettings).where(eq(cycleSettings.clientId, clientId)).run();
  });
}

function periodsFor(clientId: number): Period[] {
  return db
    .select({ id: cyclePeriods.id, startDay: cyclePeriods.startDay, endDay: cyclePeriods.endDay })
    .from(cyclePeriods)
    .where(eq(cyclePeriods.clientId, clientId))
    .all();
}

function logsSince(clientId: number, from: string): DayLog[] {
  return db
    .select({ day: cycleDays.day, energy: cycleDays.energy, mood: cycleDays.mood, sleep: cycleDays.sleep, pain: cycleDays.pain, cravings: cycleDays.cravings, note: cycleDays.note })
    .from(cycleDays)
    .where(and(eq(cycleDays.clientId, clientId), gte(cycleDays.day, from)))
    .orderBy(desc(cycleDays.day))
    .all();
}

/** Days a member may log on: today and the last 60 days, nothing in the future. */
function allowedDay(day: unknown, today: string): day is string {
  return isDayKey(day) && day <= today && day >= addDays(today, -60);
}

/** The period started on `day`. If one is already open it is closed the day before. */
export function startPeriod(clientId: number, day: unknown): { ok: true } | { ok: false; error: string } {
  if (!cycleSettingsFor(clientId)) return { ok: false, error: "Cycle tracking is off." };
  const today = dateKey(Date.now());
  if (!allowedDay(day, today)) return { ok: false, error: "Pick a day in the last two months." };
  const periods = sortPeriods(periodsFor(clientId));
  if (periodOn(periods, day)) return { ok: false, error: "That day is already in a period." };
  const open = periods.find((p) => !p.endDay && p.startDay < day);
  db.transaction((tx) => {
    if (open) tx.update(cyclePeriods).set({ endDay: addDays(day, -1) }).where(eq(cyclePeriods.id, open.id)).run();
    tx.insert(cyclePeriods).values({ clientId, startDay: day, endDay: null, createdAt: Date.now() }).onConflictDoNothing().run();
  });
  return { ok: true };
}

/** The period that is on ended on `day`. */
export function endPeriod(clientId: number, day: unknown): { ok: true } | { ok: false; error: string } {
  if (!cycleSettingsFor(clientId)) return { ok: false, error: "Cycle tracking is off." };
  const today = dateKey(Date.now());
  if (!allowedDay(day, today)) return { ok: false, error: "Pick a day in the last two months." };
  const periods = sortPeriods(periodsFor(clientId));
  const on = periodOn(periods, day) ?? periods.filter((p) => !p.endDay && p.startDay <= day).pop() ?? null;
  if (!on) return { ok: false, error: "There's no period on to end." };
  if (day < on.startDay) return { ok: false, error: "The end can't be before the start." };
  db.update(cyclePeriods).set({ endDay: day }).where(and(eq(cyclePeriods.id, on.id), eq(cyclePeriods.clientId, clientId))).run();
  return { ok: true };
}

export function removePeriod(clientId: number, id: number): void {
  db.delete(cyclePeriods).where(and(eq(cyclePeriods.id, id), eq(cyclePeriods.clientId, clientId))).run();
}

/** One answer on one day's check-in. `value` null clears it. */
export function setCycleDay(clientId: number, day: unknown, field: DayField, value: number | null): { ok: true } | { ok: false; error: string } {
  if (!cycleSettingsFor(clientId)) return { ok: false, error: "Cycle tracking is off." };
  const today = dateKey(Date.now());
  if (!allowedDay(day, today)) return { ok: false, error: "Pick a day in the last two months." };
  if (value !== null && ![1, 2, 3].includes(value)) return { ok: false, error: "Pick one of the three." };
  const now = Date.now();
  db.insert(cycleDays)
    .values({ clientId, day, [field]: value, updatedAt: now })
    .onConflictDoUpdate({ target: [cycleDays.clientId, cycleDays.day], set: { [field]: value, updatedAt: now } })
    .run();
  return { ok: true };
}

export function setCycleNote(clientId: number, day: unknown, note: string): { ok: true } | { ok: false; error: string } {
  if (!cycleSettingsFor(clientId)) return { ok: false, error: "Cycle tracking is off." };
  const today = dateKey(Date.now());
  if (!allowedDay(day, today)) return { ok: false, error: "Pick a day in the last two months." };
  const now = Date.now();
  const clean = note.trim().slice(0, 500) || null;
  db.insert(cycleDays)
    .values({ clientId, day, note: clean, updatedAt: now })
    .onConflictDoUpdate({ target: [cycleDays.clientId, cycleDays.day], set: { note: clean, updatedAt: now } })
    .run();
  return { ok: true };
}

export interface MemberCycle {
  settings: CycleSettings;
  today: string;
  status: CycleStatus;
  todayLog: DayLog;
  periods: Period[];
  months: CalendarMonth[];
  /** Check-ins logged in the last 90 days. */
  loggedDays: number;
}

const EMPTY_LOG = (day: string): DayLog => ({ day, energy: null, mood: null, sleep: null, pain: null, cravings: null, note: null });

/** The member's own screen. Null until they turn tracking on. */
export function memberCycle(clientId: number): MemberCycle | null {
  const settings = cycleSettingsFor(clientId);
  if (!settings) return null;
  const today = dateKey(Date.now());
  const periods = sortPeriods(periodsFor(clientId));
  const logs = logsSince(clientId, addDays(today, -90));
  const status = cycleStatus(settings.mode === "cycle" ? periods : [], today);
  return {
    settings,
    today,
    status,
    todayLog: logs.find((l) => l.day === today) ?? EMPTY_LOG(today),
    periods: [...periods].reverse(),
    months: calendar(settings.mode === "cycle" ? periods : [], logs, status, today, 1),
    loggedDays: logs.length,
  };
}

export interface CoachCycle {
  today: string;
  status: CycleStatus;
  mode: "cycle" | "none";
  /** Last 28 days of check-ins, newest first. */
  recent: DayLog[];
  byPhase: ReturnType<typeof averagesByPhase>;
  periods: Period[];
  sharedSince: number;
}

/** The coach's view. Null unless the member turned tracking on AND chose to share it. */
export function coachCycleView(clientId: number): CoachCycle | null {
  const settings = cycleSettingsFor(clientId);
  if (!settings || !settings.shareWithCoach) return null;
  const today = dateKey(Date.now());
  const periods = settings.mode === "cycle" ? sortPeriods(periodsFor(clientId)) : [];
  const logs = logsSince(clientId, addDays(today, -180));
  return {
    today,
    status: cycleStatus(periods, today),
    mode: settings.mode,
    recent: logs.filter((l) => l.day >= addDays(today, -28)),
    byPhase: averagesByPhase(periods, logs, today),
    periods: [...periods].reverse().slice(0, 8),
    sharedSince: settings.consentAt,
  };
}

export type { CycleStatus, DayLog, Period, Phase };
