/**
 * Daily habits a member ticks off in the app: what counts as a day done,
 * streaks, and the last few weeks at a glance. Pure.
 */

import { addDays } from "@/lib/trainingProgress";

export interface Habit {
  id: number;
  label: string;
}

export interface Tick {
  habitId: number;
  day: string;
}

/** Per day: how many of the habits were ticked. Only days in `days`, in that order. */
export function completionByDay(habits: Habit[], ticks: Tick[], days: string[]): { day: string; done: number; total: number }[] {
  const ids = new Set(habits.map((h) => h.id));
  const byDay = new Map<string, Set<number>>();
  for (const t of ticks) {
    if (!ids.has(t.habitId)) continue;
    if (!byDay.has(t.day)) byDay.set(t.day, new Set());
    byDay.get(t.day)!.add(t.habitId);
  }
  return days.map((day) => ({ day, done: byDay.get(day)?.size ?? 0, total: habits.length }));
}

/**
 * Days in a row with every habit ticked, counting back from today, or from
 * yesterday when today isn't finished yet (so a streak isn't lost at
 * breakfast). Zero habits means no streak.
 */
export function streak(habits: Habit[], ticks: Tick[], today: string): number {
  if (habits.length === 0) return 0;
  const need = habits.length;
  const done = new Map<string, number>();
  const ids = new Set(habits.map((h) => h.id));
  const seen = new Set<string>();
  for (const t of ticks) {
    if (!ids.has(t.habitId)) continue;
    const k = `${t.day}:${t.habitId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    done.set(t.day, (done.get(t.day) ?? 0) + 1);
  }
  let day = (done.get(today) ?? 0) >= need ? today : addDays(today, -1);
  let n = 0;
  while ((done.get(day) ?? 0) >= need) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

/** The last `n` days ending today, oldest first. */
export function lastDays(today: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)));
}

/** Percentage of habit-days ticked over a period, for the coach's view. */
export function completionRate(habits: Habit[], ticks: Tick[], days: string[]): number {
  const rows = completionByDay(habits, ticks, days);
  const total = rows.reduce((s, r) => s + r.total, 0);
  if (total === 0) return 0;
  return Math.round((rows.reduce((s, r) => s + r.done, 0) / total) * 100);
}

/** Per habit, how many of the days it was ticked, best first. */
export function perHabit(habits: Habit[], ticks: Tick[], days: string[]): { habit: Habit; days: number; of: number }[] {
  const set = new Set(days);
  const counts = new Map<number, Set<string>>();
  for (const t of ticks) {
    if (!set.has(t.day)) continue;
    if (!counts.has(t.habitId)) counts.set(t.habitId, new Set());
    counts.get(t.habitId)!.add(t.day);
  }
  return habits.map((habit) => ({ habit, days: counts.get(habit.id)?.size ?? 0, of: days.length })).sort((a, b) => b.days - a.days);
}
