/**
 * Pure: the start times and days the booking screen offers.
 *
 * This module only GENERATES candidates. Whether a candidate is free is
 * decided by `checkBookingSlot` (@/lib/schedule), the same check the booking
 * POST runs, so a time shown as free is a time the server accepts. See
 * app/api/appointments/free-slots/route.ts.
 */

import { hmToMin, minToHm } from "@/lib/scheduling/freeSlots";

import { weekdayShort } from "./format";

/**
 * Start times land on this grid (:00 :15 :30 :45). The old per-tenant
 * slot_length_minutes setting was removed on 2026-09-09 as dead (nothing read
 * it), so the grid is fixed here rather than resurrecting a hidden knob.
 */
export const BOOKING_STEP_MINUTES = 15;

/** How many days the strip shows. */
export const STRIP_DAYS = 14;

/**
 * Every start on the grid inside [open, close) whose session also ends by
 * close. An open time off the grid (08:10) starts at the next grid line (08:15).
 */
export function slotCandidates(open: string, close: string, durationMinutes: number, stepMinutes = BOOKING_STEP_MINUTES): string[] {
  if (!(durationMinutes > 0) || !(stepMinutes > 0)) return [];
  const openMin = hmToMin(open);
  const closeMin = hmToMin(close);
  const out: string[] = [];
  for (let start = Math.ceil(openMin / stepMinutes) * stepMinutes; start + durationMinutes <= closeMin; start += stepMinutes) {
    out.push(minToHm(start));
  }
  return out;
}

/** True when block-outs together cover the whole opening window, so the day is effectively closed. */
export function blocksCoverDay(open: string, close: string, blocks: { startTime: string; endTime: string }[]): boolean {
  const openMin = hmToMin(open);
  const closeMin = hmToMin(close);
  if (closeMin <= openMin) return true;
  const spans = blocks
    .map((b) => [Math.max(openMin, hmToMin(b.startTime)), Math.min(closeMin, hmToMin(b.endTime))] as const)
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  let reach = openMin;
  for (const [s, e] of spans) {
    if (s > reach) return false;
    reach = Math.max(reach, e);
    if (reach >= closeMin) return true;
  }
  return reach >= closeMin;
}

/** ISO date plus `n` days, in UTC so no local clock is involved. */
export function addDaysIso(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export interface StripDay {
  date: string;
  /** "Wed" */
  weekday: string;
  /** Day of the month, 1-31. */
  day: number;
  closed: boolean;
}

/** `count` days from `from`, each marked closed by the caller's rule (opening hours, block-outs). */
export function dayStrip(from: string, count: number, isClosed: (dateIso: string) => boolean): StripDay[] {
  const out: StripDay[] = [];
  for (let i = 0; i < count; i++) {
    const date = addDaysIso(from, i);
    out.push({ date, weekday: weekdayShort(date), day: Number(date.slice(8, 10)), closed: isClosed(date) });
  }
  return out;
}

/** The strip starts today, unless the booking's date falls outside it; then it starts on that date. */
export function stripStart(today: string, selected: string, count = STRIP_DAYS): string {
  const last = addDaysIso(today, count - 1);
  return selected < today || selected > last ? selected : today;
}

export type Period = "Morning" | "Afternoon" | "Evening";

/** Before 12:00 is morning, before 17:00 afternoon, then evening. */
export function periodOf(hm: string): Period {
  const min = hmToMin(hm);
  if (min < 12 * 60) return "Morning";
  if (min < 17 * 60) return "Afternoon";
  return "Evening";
}

/** Slots split into Morning / Afternoon / Evening runs, in order, empty runs left out. */
export function groupByPeriod<T extends { time: string }>(slots: T[]): { period: Period; slots: T[] }[] {
  const out: { period: Period; slots: T[] }[] = [];
  for (const s of slots) {
    const period = periodOf(s.time);
    const last = out[out.length - 1];
    if (last && last.period === period) last.slots.push(s);
    else out.push({ period, slots: [s] });
  }
  return out;
}

/** True when `hm` sits on the booking grid, so it will appear as a button. */
export function onGrid(hm: string, stepMinutes = BOOKING_STEP_MINUTES): boolean {
  return /^\d{2}:\d{2}$/.test(hm) && hmToMin(hm) % stepMinutes === 0;
}
