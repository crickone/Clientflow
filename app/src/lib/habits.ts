import "server-only";

import { and, eq, gte, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { forms, habitTicks } from "@/lib/db/schema";
import { getForm } from "@/lib/forms";
import { dateKey } from "@/lib/trainingProgress";
import { completionByDay, completionRate, lastDays, perHabit, streak, type Habit, type Tick } from "@/lib/habitsModel";

/**
 * Daily habits in the client app, for the CURRENT tenant (ambient `db`). The
 * habits are the "Habit Tracking" lines of the Default Daily Habits form
 * (switched on); members tick each one off per day.
 */

export function habitForm(): { id: number; title: string; habits: Habit[] } | null {
  const row = db
    .select({ id: forms.id })
    .from(forms)
    .where(and(eq(forms.type, "habits"), eq(forms.isDefault, true), eq(forms.status, true)))
    .get();
  if (!row) return null;
  const f = getForm(row.id);
  if (!f) return null;
  const habits = f.questions.filter((q) => q.section === "habit" && q.id != null && q.label.trim()).map((q) => ({ id: q.id!, label: q.label.trim() }));
  return habits.length ? { id: row.id, title: f.title || "Daily habits", habits } : null;
}

function ticksBetween(clientId: number, from: string, to: string): Tick[] {
  return db
    .select({ habitId: habitTicks.questionId, day: habitTicks.day })
    .from(habitTicks)
    .where(and(eq(habitTicks.clientId, clientId), gte(habitTicks.day, from), lte(habitTicks.day, to)))
    .all();
}

export interface MemberHabits {
  title: string;
  habits: Habit[];
  today: string;
  tickedToday: Set<number>;
  streak: number;
  /** Last 28 days, oldest first. */
  days: { day: string; done: number; total: number }[];
}

export function memberHabits(clientId: number): MemberHabits | null {
  const f = habitForm();
  if (!f) return null;
  const today = dateKey(Date.now());
  const days = lastDays(today, 28);
  const ticks = ticksBetween(clientId, days[0], today);
  return {
    title: f.title,
    habits: f.habits,
    today,
    tickedToday: new Set(ticks.filter((t) => t.day === today).map((t) => t.habitId)),
    streak: streak(f.habits, ticks, today),
    days: completionByDay(f.habits, ticks, days),
  };
}

/** Tick or untick one habit for today (or an earlier day up to a week back). */
export function setTick(clientId: number, questionId: number, day: string, done: boolean): boolean {
  const f = habitForm();
  if (!f || !f.habits.some((h) => h.id === questionId)) return false;
  const today = dateKey(Date.now());
  if (day > today || day < lastDays(today, 7)[0]) return false;
  if (done) {
    db.insert(habitTicks).values({ clientId, questionId, day, tickedAt: Date.now() }).onConflictDoNothing().run();
  } else {
    db.delete(habitTicks).where(and(eq(habitTicks.clientId, clientId), eq(habitTicks.questionId, questionId), eq(habitTicks.day, day))).run();
  }
  return true;
}

/** The coach's view: the last 28 days, overall rate, streak, and each habit's count. */
export function clientHabitView(clientId: number) {
  const f = habitForm();
  const today = dateKey(Date.now());
  const days = lastDays(today, 28);
  const ticks = ticksBetween(clientId, days[0], today);
  if (!f) return ticks.length ? { title: "Daily habits", habits: [] as Habit[], days: [] as { day: string; done: number; total: number }[], rate: 0, streak: 0, perHabit: [] as ReturnType<typeof perHabit>, everTicked: true } : null;
  return {
    title: f.title,
    habits: f.habits,
    days: completionByDay(f.habits, ticks, days),
    rate: completionRate(f.habits, ticks, days),
    streak: streak(f.habits, ticks, today),
    perHabit: perHabit(f.habits, ticks, days),
    everTicked: ticks.length > 0,
  };
}
