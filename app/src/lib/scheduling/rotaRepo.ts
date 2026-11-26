import "server-only";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/lib/db";
import { appointments, staff, staffShifts, therapies } from "@/lib/db/schema";
import { addDaysIso } from "@/lib/booking/slotModel";
import { getSettings, readKey, setKey } from "@/lib/settings";

import {
  buildRotaWeek,
  coverForDate,
  isIsoDate,
  mondayOf,
  validateShift,
  type RotaWeekData,
  type ShiftRow,
  type TreatmentStaffing,
} from "./rotaModel";
import { staffingOf, type DayCover, type Staffing } from "./staffDemand";

/**
 * Loading and saving side of the staff rota. The rule itself is pure
 * (./staffDemand), and so is the page's data (./rotaModel).
 *
 * The setting `staff_rota_on` decides whether bookings follow the rota at
 * all. Off by default, so every business that never opens the rota books
 * exactly as before. The first shift ever saved switches it on; once someone
 * switches it off it stays off until switched on again.
 */

export const ROTA_ON_KEY = "staff_rota_on";

export function rotaOn(): boolean {
  return readKey<boolean>(ROTA_ON_KEY, false) === true;
}

export function setRotaOn(on: boolean): void {
  setKey(ROTA_ON_KEY, on);
}

function switchOnWithFirstShift(): void {
  if (readKey<boolean | null>(ROTA_ON_KEY, null) === null) setKey(ROTA_ON_KEY, true);
}

export function rotaPeople(): { id: number; name: string }[] {
  return db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(eq(staff.isActive, true))
    .orderBy(asc(staff.name), asc(staff.id))
    .all();
}

export function addPerson(name: string): { ok: true; id: number } | { ok: false; error: string } {
  const clean = name.trim().slice(0, 120);
  if (!clean) return { ok: false, error: "Give the person a name." };
  const [row] = db.insert(staff).values({ name: clean }).returning({ id: staff.id }).all();
  return { ok: true, id: row!.id };
}

export function shiftsBetween(fromIso: string, toIso: string): ShiftRow[] {
  return db
    .select({ id: staffShifts.id, staffId: staffShifts.staffId, date: staffShifts.date, start: staffShifts.start, end: staffShifts.end })
    .from(staffShifts)
    .innerJoin(staff, eq(staff.id, staffShifts.staffId))
    .where(and(gte(staffShifts.date, fromIso), lte(staffShifts.date, toIso), eq(staff.isActive, true)))
    .orderBy(asc(staffShifts.date), asc(staffShifts.start), asc(staffShifts.id))
    .all();
}

export type RotaResult = { ok: true; id?: number } | { ok: false; error: string };

function personIsActive(staffId: number): boolean {
  const row = db.select({ id: staff.id, isActive: staff.isActive }).from(staff).where(eq(staff.id, staffId)).get();
  return !!row && row.isActive;
}

function sameDay(staffId: number, date: string): ShiftRow[] {
  return db
    .select({ id: staffShifts.id, staffId: staffShifts.staffId, date: staffShifts.date, start: staffShifts.start, end: staffShifts.end })
    .from(staffShifts)
    .where(and(eq(staffShifts.staffId, staffId), eq(staffShifts.date, date)))
    .all();
}

export function addShift(input: { staffId: number; date: string; start: string; end: string }): RotaResult {
  if (!isIsoDate(input.date)) return { ok: false, error: "Give the date as YYYY-MM-DD." };
  if (!personIsActive(input.staffId)) return { ok: false, error: "That person is not on the rota." };
  const error = validateShift(input, getSettings().openingHours, sameDay(input.staffId, input.date));
  if (error) return { ok: false, error };
  const [row] = db.insert(staffShifts).values(input).returning({ id: staffShifts.id }).all();
  switchOnWithFirstShift();
  return { ok: true, id: row!.id };
}

export function updateShift(id: number, patch: { start: string; end: string }): RotaResult {
  const current = db.select().from(staffShifts).where(eq(staffShifts.id, id)).get();
  if (!current) return { ok: false, error: "That shift no longer exists." };
  const draft = { id, staffId: current.staffId, date: current.date, start: patch.start, end: patch.end };
  const error = validateShift(draft, getSettings().openingHours, sameDay(current.staffId, current.date));
  if (error) return { ok: false, error };
  db.update(staffShifts).set({ start: patch.start, end: patch.end, updatedAt: new Date() }).where(eq(staffShifts.id, id)).run();
  return { ok: true, id };
}

export function deleteShift(id: number): void {
  db.delete(staffShifts).where(eq(staffShifts.id, id)).run();
}

/** Days between two ISO dates (b - a). */
function daysBetween(a: string, b: string): number {
  const ms = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

/** Replace the target week's shifts with the source week's. Returns how many were copied. */
export function copyWeek(fromMonday: string, toMonday: string): number {
  if (!isIsoDate(fromMonday) || !isIsoDate(toMonday)) return 0;
  const offset = daysBetween(fromMonday, toMonday);
  const source = shiftsBetween(fromMonday, addDaysIso(fromMonday, 6));
  const hours = getSettings().openingHours;
  // Build the valid drafts first: when none fit, the target week is left alone.
  const drafts: { staffId: number; date: string; start: string; end: string }[] = [];
  for (const s of source) {
    const draft = { staffId: s.staffId, date: addDaysIso(s.date, offset), start: s.start, end: s.end };
    if (validateShift(draft, hours, drafts.filter((p) => p.staffId === draft.staffId && p.date === draft.date))) continue;
    drafts.push(draft);
  }
  if (drafts.length === 0) return 0;
  db.transaction((tx) => {
    tx.delete(staffShifts)
      .where(and(gte(staffShifts.date, toMonday), lte(staffShifts.date, addDaysIso(toMonday, 6))))
      .run();
    for (const draft of drafts) tx.insert(staffShifts).values(draft).run();
  });
  const copied = drafts.length;
  if (copied > 0) switchOnWithFirstShift();
  return copied;
}

/** Who is on, per date, with the setting and each week's shifts read once. */
export function staffCoverResolver(): (dateIso: string) => DayCover {
  const on = rotaOn();
  if (!on) return () => ({ mode: "off" });
  const openingHours = getSettings().openingHours;
  const weeks = new Map<string, ShiftRow[]>();
  return (dateIso) => {
    const monday = mondayOf(dateIso);
    let weekShifts = weeks.get(monday);
    if (!weekShifts) {
      weekShifts = shiftsBetween(monday, addDaysIso(monday, 6));
      weeks.set(monday, weekShifts);
    }
    return coverForDate(dateIso, { rotaOn: true, weekShifts, openingHours });
  };
}

export function staffCoverFor(dateIso: string): DayCover {
  return staffCoverResolver()(dateIso);
}

/** Rota on, and the week holding this date has no shifts: bookings assume one person on. */
export function weekUnfilled(dateIso: string): boolean {
  if (!rotaOn()) return false;
  const monday = mondayOf(dateIso);
  return shiftsBetween(monday, addDaysIso(monday, 6)).length === 0;
}

function therapyStaffingRows(ids: number[]): { id: number; name: string; staffing: Staffing }[] {
  if (ids.length === 0) return [];
  return db
    .select({ id: therapies.id, name: therapies.name, staffing: therapies.staffing })
    .from(therapies)
    .where(inArray(therapies.id, ids))
    .all();
}

export function staffingForTherapies(ids: number[]): Staffing {
  const rows = new Map(therapyStaffingRows(ids).map((r) => [r.id, r.staffing]));
  return staffingOf(ids.map((id) => rows.get(id) ?? "whole"));
}

/** Staffing and a label per appointment, keyed by its therapy_ids JSON (combinations repeat, so each is resolved once). */
export function staffingResolver(): (therapyIdsJson: string | null) => { staffing: Staffing; label: string } {
  const cache = new Map<string, { staffing: Staffing; label: string }>();
  return (json) => {
    const key = json || "[]";
    const hit = cache.get(key);
    if (hit) return hit;
    let ids: number[] = [];
    try {
      const parsed = JSON.parse(key);
      if (Array.isArray(parsed)) ids = parsed.map(Number).filter((n) => Number.isFinite(n));
    } catch {
      ids = [];
    }
    const rows = new Map(therapyStaffingRows(ids).map((r) => [r.id, r]));
    const value = {
      staffing: staffingOf(ids.map((id) => rows.get(id)?.staffing ?? "whole")),
      label: ids.map((id) => rows.get(id)?.name).filter((n): n is string => !!n).join(" and "),
    };
    cache.set(key, value);
    return value;
  };
}

export function listTreatmentStaffing(): TreatmentStaffing[] {
  return db
    .select({ id: therapies.id, name: therapies.name, staffing: therapies.staffing })
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .orderBy(asc(therapies.name), asc(therapies.id))
    .all();
}

export function setTherapyStaffing(id: number, staffing: Staffing): void {
  db.update(therapies).set({ staffing }).where(eq(therapies.id, id)).run();
}

export function loadRotaWeek(monday: string): RotaWeekData {
  const sunday = addDaysIso(monday, 6);
  const of = staffingResolver();
  const appts = db
    .select({ id: appointments.id, date: appointments.date, startTime: appointments.startTime, endTime: appointments.endTime, therapyIds: appointments.therapyIds })
    .from(appointments)
    .where(and(gte(appointments.date, monday), lte(appointments.date, sunday), inArray(appointments.status, ["scheduled", "confirmed"])))
    .all()
    .map((a) => ({ id: a.id, date: a.date, startTime: a.startTime, endTime: a.endTime, ...of(a.therapyIds) }));
  return buildRotaWeek({
    monday,
    rotaOn: rotaOn(),
    openingHours: getSettings().openingHours,
    people: rotaPeople(),
    weekShifts: shiftsBetween(monday, sunday),
    lastWeekShiftCount: shiftsBetween(addDaysIso(monday, -7), addDaysIso(monday, -1)).length,
    appts,
    treatments: listTreatmentStaffing(),
  });
}
