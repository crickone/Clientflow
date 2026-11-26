/**
 * PURE rota model: no DB, no `server-only`, so the page, the repo, a test and
 * the browser-check harness all build the same week the same way.
 */

import { addDaysIso } from "@/lib/booking/slotModel";
import { shortDate, weekdayIndex, weekdayShort } from "@/lib/booking/format";

import { hmToMin } from "./freeSlots";
import {
  firstStaffShortfall,
  staffShortfallReason,
  type DayCover,
  type Staffing,
  type StaffedSpan,
} from "./staffDemand";

export interface OpeningHourLike {
  dow: number;
  closed: boolean;
  open?: string;
  close?: string;
}

export interface ShiftRow {
  id: number;
  staffId: number;
  date: string;
  start: string;
  end: string;
}

export interface ShiftDraft {
  id?: number;
  staffId: number;
  date: string;
  start: string;
  end: string;
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHm = (s: string) => HM.test(s);
export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function hoursFor(dateIso: string, openingHours: OpeningHourLike[]): OpeningHourLike | undefined {
  return openingHours.find((o) => o.dow === weekdayIndex(dateIso));
}

/** Null when the shift can be saved, else the reason in words. */
export function validateShift(shift: ShiftDraft, openingHours: OpeningHourLike[], sameDay: ShiftDraft[]): string | null {
  if (!isHm(shift.start) || !isHm(shift.end)) return "Give the times as HH:mm.";
  const oh = hoursFor(shift.date, openingHours);
  if (!oh || oh.closed) return "Closed that day, so no shifts.";
  const s = hmToMin(shift.start);
  const e = hmToMin(shift.end);
  if (e <= s) return "The shift has to end after it starts.";
  const open = oh.open ?? "00:00";
  const close = oh.close ?? "23:59";
  if (s < hmToMin(open) || e > hmToMin(close)) return `Shifts have to sit inside opening hours (${open}–${close}).`;
  const clash = sameDay.some(
    (o) =>
      o.staffId === shift.staffId &&
      o.date === shift.date &&
      (shift.id == null || o.id !== shift.id) &&
      hmToMin(o.start) < e &&
      s < hmToMin(o.end),
  );
  if (clash) return "This overlaps another shift for the same person.";
  return null;
}

/** The Monday of the week holding this date. */
export function mondayOf(dateIso: string): string {
  const dow = weekdayIndex(dateIso);
  return addDaysIso(dateIso, dow === 0 ? -6 : 1 - dow);
}

export function weekDates(mondayIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(mondayIso, i));
}

export interface CoverRun {
  startMin: number;
  endMin: number;
  count: number;
}

/** How many are on through the opening window, as runs of equal count. */
export function coverRuns(shifts: { start: string; end: string }[], openMin: number, closeMin: number): CoverRun[] {
  if (closeMin <= openMin) return [];
  const edges = new Set<number>([openMin, closeMin]);
  for (const s of shifts) {
    for (const t of [hmToMin(s.start), hmToMin(s.end)]) if (openMin < t && t < closeMin) edges.add(t);
  }
  const sorted = [...edges].sort((a, b) => a - b);
  const runs: CoverRun[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t = sorted[i];
    const count = shifts.filter((s) => hmToMin(s.start) <= t && t < hmToMin(s.end)).length;
    const last = runs[runs.length - 1];
    if (last && last.count === count) last.endMin = sorted[i + 1];
    else runs.push({ startMin: t, endMin: sorted[i + 1], count });
  }
  return runs;
}

/** "9", "9:30", "13" */
function clockShort(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? String(h) : `${h}:${String(m).padStart(2, "0")}`;
}

/** ["1 on 9–13", "2 on 13–17", "None 17–19"], or ["Nobody on"] for a day with no one. */
export function coverText(runs: CoverRun[]): string[] {
  if (runs.length === 0) return [];
  if (runs.every((r) => r.count === 0)) return ["Nobody on"];
  return runs.map((r) => `${r.count === 0 ? "None" : `${r.count} on`} ${clockShort(r.startMin)}–${clockShort(r.endMin)}`);
}

/** "09:00" -> "9:00" */
export function shortTime(hm: string): string {
  return hm.startsWith("0") ? hm.slice(1) : hm;
}

export function shiftLabel(start: string, end: string): string {
  return `${shortTime(start)}–${shortTime(end)}`;
}

export function hoursLabel(shifts: { start: string; end: string }[]): string {
  const mins = shifts.reduce((sum, s) => sum + hmToMin(s.end) - hmToMin(s.start), 0);
  if (mins <= 0) return "No shifts this week";
  const hours = Math.round((mins / 60) * 10) / 10;
  return `${hours} h this week`;
}

/** "Mon 30 Nov – Sun 6 Dec" */
export function weekRangeLabel(mondayIso: string): string {
  return `${shortDate(mondayIso)} – ${shortDate(addDaysIso(mondayIso, 6))}`;
}

/** "Mon 30" */
export function dayLabel(dateIso: string): string {
  return `${weekdayShort(dateIso)} ${Number(dateIso.slice(8, 10))}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/**
 * Who is on for one date.
 * Rota off: the rule never applies. Rota on, week with no shifts: one person
 * during opening hours. Otherwise the day's shifts (none means nobody).
 */
export function coverForDate(
  dateIso: string,
  ctx: { rotaOn: boolean; weekShifts: ShiftRow[]; openingHours: OpeningHourLike[] },
): DayCover {
  if (!ctx.rotaOn) return { mode: "off" };
  const monday = mondayOf(dateIso);
  const inWeek = ctx.weekShifts.filter((s) => mondayOf(s.date) === monday);
  if (inWeek.length === 0) {
    const oh = hoursFor(dateIso, ctx.openingHours);
    if (!oh || oh.closed) return { mode: "assumeOne", openMin: 0, closeMin: 0 };
    return { mode: "assumeOne", openMin: hmToMin(oh.open ?? "00:00"), closeMin: hmToMin(oh.close ?? "23:59") };
  }
  return {
    mode: "shifts",
    shifts: inWeek.filter((s) => s.date === dateIso).map((s) => ({ startMin: hmToMin(s.start), endMin: hmToMin(s.end) })),
  };
}

export interface LookAtAppt {
  id: number;
  date: string;
  startTime: string;
  endTime: string;
  staffing: Staffing;
  label: string;
}

export interface LookAtItem {
  appointmentId: number;
  date: string;
  startTime: string;
  /** "Tue 1 Dec, 14:00 · HBOT" */
  title: string;
  reason: string;
}

/**
 * Bookings that break the staff rule. Booked-first wins: appointments are
 * taken in id order, and one that does not fit beside those already kept is
 * listed (and not kept), so a clash between two is listed once, on the later
 * booking, naming the earlier one.
 */
export function lookAtFrom(appts: LookAtAppt[], coverOf: (dateIso: string) => DayCover): LookAtItem[] {
  const kept = new Map<string, StaffedSpan[]>();
  const out: LookAtItem[] = [];
  for (const a of [...appts].sort((x, y) => x.id - y.id)) {
    const cover = coverOf(a.date);
    const span: StaffedSpan = { startMin: hmToMin(a.startTime), endMin: hmToMin(a.endTime), staffing: a.staffing, label: a.label };
    const day = kept.get(a.date) ?? [];
    const short = firstStaffShortfall({ ...span, booked: day, cover });
    if (short) {
      out.push({
        appointmentId: a.id,
        date: a.date,
        startTime: a.startTime,
        title: `${shortDate(a.date)}, ${a.startTime} · ${a.label || "Booking"}`,
        reason: staffShortfallReason(short),
      });
    } else {
      day.push(span);
      kept.set(a.date, day);
    }
  }
  return out.sort((x, y) => (x.date + x.startTime).localeCompare(y.date + y.startTime) || x.appointmentId - y.appointmentId);
}

export interface RotaDay {
  date: string;
  /** "Mon 30" */
  label: string;
  closed: boolean;
  open: string | null;
  close: string | null;
  runs: CoverRun[];
  text: string[];
}

export interface RotaPerson {
  id: number;
  name: string;
  initials: string;
  /** "32 h this week" */
  hours: string;
  shifts: ShiftRow[];
  /** 0 or 1: alternating shift colour per row. */
  tone: number;
}

export interface TreatmentStaffing {
  id: number;
  name: string;
  staffing: Staffing;
}

export interface RotaWeekData {
  monday: string;
  prevMonday: string;
  nextMonday: string;
  rangeLabel: string;
  rotaOn: boolean;
  /** Rota on and this week has no shifts: bookings assume one person on. */
  unfilled: boolean;
  days: RotaDay[];
  people: RotaPerson[];
  lookAt: LookAtItem[];
  treatments: TreatmentStaffing[];
  lastWeekShiftCount: number;
  thisWeekShiftCount: number;
}

export function buildRotaWeek(input: {
  monday: string;
  rotaOn: boolean;
  openingHours: OpeningHourLike[];
  people: { id: number; name: string }[];
  weekShifts: ShiftRow[];
  lastWeekShiftCount: number;
  appts: LookAtAppt[];
  treatments: TreatmentStaffing[];
}): RotaWeekData {
  const { monday, rotaOn, openingHours, people, weekShifts } = input;
  const days: RotaDay[] = weekDates(monday).map((date) => {
    const oh = hoursFor(date, openingHours);
    const closed = !oh || oh.closed;
    const open = closed ? null : (oh!.open ?? "00:00");
    const close = closed ? null : (oh!.close ?? "23:59");
    const runs = closed ? [] : coverRuns(weekShifts.filter((s) => s.date === date), hmToMin(open!), hmToMin(close!));
    return { date, label: dayLabel(date), closed, open, close, runs, text: coverText(runs) };
  });
  const coverOf = (d: string) => coverForDate(d, { rotaOn, weekShifts, openingHours });
  return {
    monday,
    prevMonday: addDaysIso(monday, -7),
    nextMonday: addDaysIso(monday, 7),
    rangeLabel: weekRangeLabel(monday),
    rotaOn,
    unfilled: rotaOn && weekShifts.length === 0,
    days,
    people: people.map((p, i) => {
      const shifts = weekShifts.filter((s) => s.staffId === p.id).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      return { id: p.id, name: p.name, initials: initials(p.name), hours: hoursLabel(shifts), shifts, tone: i % 2 };
    }),
    lookAt: lookAtFrom(input.appts, coverOf),
    treatments: input.treatments,
    lastWeekShiftCount: input.lastWeekShiftCount,
    thisWeekShiftCount: weekShifts.length,
  };
}
