import "server-only";

import { and, asc, eq, gte, lte, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  classSchedules,
  classSessions,
  sessionBookings,
  clients,
  type ClassSession,
} from "@/lib/db/schema";

// ── date/time helpers (local, string-based YYYY-MM-DD / HH:mm) ────────────────

const pad = (n: number) => String(n).padStart(2, "0");

export function toIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function todayIso(): string {
  return toIso(new Date());
}
function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00`);
}
export function addDaysIso(iso: string, n: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}
export function dowOf(iso: string): number {
  return parseIso(iso).getDay(); // 0=Sun … 6=Sat
}
/** The Monday on/before the given date (matches the Appointments calendar). */
export function weekStartMonday(iso: string): string {
  const d = parseIso(iso);
  const diff = (d.getDay() + 6) % 7; // days since Monday (Sun=6 … Sat=5)
  d.setDate(d.getDate() - diff);
  return toIso(d);
}
export function weekDates(weekStartIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysIso(weekStartIso, i));
}
export function addMinutesToTime(hm: string, minutes: number): string {
  const [h, m] = hm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const wrapped = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

// ── types ─────────────────────────────────────────────────────────────────────

export interface Attendee {
  bookingId: number;
  clientId: number;
  name: string;
  status: "booked" | "attended" | "no_show" | "cancelled";
}
export interface SessionWithRoster extends ClassSession {
  attendees: Attendee[];
  filled: number;
}

// ── recurrence materialization ────────────────────────────────────────────────

/**
 * Ensure a concrete class_sessions row exists for every occurrence of every
 * active schedule within the week. Idempotent (guarded by the unique index on
 * schedule_id+date+start_time). Cancelled/edited occurrences already exist, so
 * they're never regenerated.
 */
export function materializeWeek(weekStartIso: string): void {
  const dates = weekDates(weekStartIso);
  const schedules = db
    .select()
    .from(classSchedules)
    .where(eq(classSchedules.isActive, true))
    .all();
  if (schedules.length === 0) return;

  db.transaction((tx) => {
    for (const s of schedules) {
      const days = s.daysOfWeek
        .split(",")
        .map((n) => parseInt(n.trim(), 10))
        .filter((n) => Number.isInteger(n));
      const endTime = addMinutesToTime(s.startTime, s.durationMin);
      for (const date of dates) {
        if (!days.includes(dowOf(date))) continue;
        if (date < s.startDate) continue;
        if (s.endDate && date > s.endDate) continue;
        tx
          .insert(classSessions)
          .values({
            scheduleId: s.id,
            date,
            startTime: s.startTime,
            endTime,
            name: s.name,
            description: s.description,
            category: s.category,
            color: s.color,
            capacity: s.capacity,
            location: s.location,
            instructor: s.instructor,
            visibility: s.visibility,
            status: "scheduled",
          })
          .onConflictDoNothing()
          .run();
      }
    }
  });
}

// ── week query (materialize + attach rosters) ─────────────────────────────────

export function getWeekSessions(weekStartIso: string): SessionWithRoster[] {
  materializeWeek(weekStartIso);
  const dates = weekDates(weekStartIso);

  const sessions = db
    .select()
    .from(classSessions)
    .where(and(gte(classSessions.date, dates[0]), lte(classSessions.date, dates[6])))
    .orderBy(asc(classSessions.date), asc(classSessions.startTime))
    .all();

  const rosterRows = db
    .select({
      bookingId: sessionBookings.id,
      sessionId: sessionBookings.sessionId,
      clientId: sessionBookings.clientId,
      status: sessionBookings.status,
      firstName: clients.firstName,
      lastName: clients.lastName,
    })
    .from(sessionBookings)
    .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
    .innerJoin(clients, eq(clients.id, sessionBookings.clientId))
    .where(
      and(
        gte(classSessions.date, dates[0]),
        lte(classSessions.date, dates[6]),
        ne(sessionBookings.status, "cancelled"),
      ),
    )
    .all();

  const bySession = new Map<number, Attendee[]>();
  for (const r of rosterRows) {
    const list = bySession.get(r.sessionId) ?? [];
    list.push({
      bookingId: r.bookingId,
      clientId: r.clientId,
      name: `${r.firstName} ${r.lastName ?? ""}`.trim(),
      status: r.status,
    });
    bySession.set(r.sessionId, list);
  }

  return sessions.map((s) => {
    const attendees = bySession.get(s.id) ?? [];
    return { ...s, attendees, filled: attendees.length };
  });
}

// ── schedules & sessions CRUD ─────────────────────────────────────────────────

export interface SessionFields {
  name: string;
  description?: string | null;
  category?: string | null;
  color: string;
  capacity: number;
  location?: string | null;
  instructor?: string | null;
  visibility: "public" | "clients" | "private";
}

/** Create a recurring class + materialize its occurrences for the given week. */
export function createRecurringClass(input: {
  fields: SessionFields;
  daysOfWeek: number[];
  startTime: string;
  durationMin: number;
  startDate: string;
  endDate?: string | null;
  materializeFrom?: string; // week to eagerly materialize (usually the visible week)
}) {
  const [row] = db
    .insert(classSchedules)
    .values({
      ...input.fields,
      daysOfWeek: input.daysOfWeek.slice().sort().join(","),
      startTime: input.startTime,
      durationMin: input.durationMin,
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      isActive: true,
    })
    .returning()
    .all();
  if (input.materializeFrom) materializeWeek(input.materializeFrom);
  else materializeWeek(weekStartMonday(input.startDate));
  return row;
}

/** Create a single (non-recurring) session. */
export function createOneOffSession(input: {
  fields: SessionFields;
  date: string;
  startTime: string;
  durationMin: number;
}) {
  const [row] = db
    .insert(classSessions)
    .values({
      ...input.fields,
      scheduleId: null,
      date: input.date,
      startTime: input.startTime,
      endTime: addMinutesToTime(input.startTime, input.durationMin),
      status: "scheduled",
    })
    .returning()
    .all();
  return row;
}

export function setSessionStatus(id: number, status: "scheduled" | "cancelled") {
  db.update(classSessions)
    .set({ status, updatedAt: new Date() })
    .where(eq(classSessions.id, id))
    .run();
}

/** Edit a single occurrence's fields (does not touch the recurring schedule). */
export function updateSession(
  id: number,
  input: { fields: SessionFields; date: string; startTime: string; durationMin: number },
) {
  db.update(classSessions)
    .set({
      ...input.fields,
      date: input.date,
      startTime: input.startTime,
      endTime: addMinutesToTime(input.startTime, input.durationMin),
      updatedAt: new Date(),
    })
    .where(eq(classSessions.id, id))
    .run();
}

export function deleteSession(id: number) {
  db.delete(classSessions).where(eq(classSessions.id, id)).run();
}

// ── bookings ──────────────────────────────────────────────────────────────────

export function bookClient(
  sessionId: number,
  clientId: number,
): { ok: true } | { ok: false; error: string } {
  const session = db
    .select()
    .from(classSessions)
    .where(eq(classSessions.id, sessionId))
    .get();
  if (!session) return { ok: false, error: "Session not found." };

  const active = db
    .select({ id: sessionBookings.id })
    .from(sessionBookings)
    .where(
      and(
        eq(sessionBookings.sessionId, sessionId),
        ne(sessionBookings.status, "cancelled"),
      ),
    )
    .all();
  const alreadyBooked = db
    .select({ id: sessionBookings.id })
    .from(sessionBookings)
    .where(
      and(
        eq(sessionBookings.sessionId, sessionId),
        eq(sessionBookings.clientId, clientId),
        ne(sessionBookings.status, "cancelled"),
      ),
    )
    .get();
  if (!alreadyBooked && active.length >= session.capacity) {
    return { ok: false, error: "This session is full." };
  }

  // Re-activate a prior cancelled booking, or insert a fresh one.
  db.insert(sessionBookings)
    .values({ sessionId, clientId, status: "booked" })
    .onConflictDoUpdate({
      target: [sessionBookings.sessionId, sessionBookings.clientId],
      set: { status: "booked" },
    })
    .run();
  return { ok: true };
}

/** Attendance / check-in: flip a booking between booked / attended / no_show. */
export function setBookingStatus(
  bookingId: number,
  status: "booked" | "attended" | "no_show" | "cancelled",
) {
  db.update(sessionBookings)
    .set({ status })
    .where(eq(sessionBookings.id, bookingId))
    .run();
}

export function removeBooking(sessionId: number, clientId: number) {
  db.delete(sessionBookings)
    .where(
      and(
        eq(sessionBookings.sessionId, sessionId),
        eq(sessionBookings.clientId, clientId),
      ),
    )
    .run();
}

/** Bookable clients (for the attendee picker). */
export function listBookableClients() {
  return db
    .select({
      id: clients.id,
      firstName: clients.firstName,
      lastName: clients.lastName,
    })
    .from(clients)
    .orderBy(asc(clients.firstName))
    .all();
}
