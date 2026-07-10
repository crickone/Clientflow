import "server-only";

import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  classSessions,
  clientMemberships,
  clientNutritionPlans,
  clientWorkoutPrograms,
  membershipPlans,
  nutritionPlans,
  sessionBookings,
  workoutPrograms,
} from "@/lib/db/schema";
import { addDaysIso, materializeWeek, todayIso, weekStartMonday } from "@/lib/timetable";

// ── membership ─────────────────────────────────────────────────────────────────

export interface ClientMembershipInfo {
  name: string;
  priceCents: number;
  status: string;
  startDate: string;
  nextBillingDate: string | null;
  category: string | null;
}

export function clientMembership(clientId: number): ClientMembershipInfo | null {
  const row = db
    .select()
    .from(clientMemberships)
    .where(and(eq(clientMemberships.clientId, clientId), eq(clientMemberships.status, "active")))
    .orderBy(desc(clientMemberships.id))
    .get();
  if (!row) return null;
  const plan = row.membershipId
    ? db.select().from(membershipPlans).where(eq(membershipPlans.id, row.membershipId)).get()
    : null;
  return {
    name: row.membershipName,
    priceCents: row.priceCents,
    status: row.status,
    startDate: row.startDate,
    nextBillingDate: row.nextBillingDate,
    category: plan?.category ?? null,
  };
}

// ── timetable (week) ───────────────────────────────────────────────────────────

export interface ClientClass {
  id: number;
  date: string;
  name: string;
  startTime: string;
  endTime: string;
  location: string | null;
  instructor: string | null;
  color: string;
  capacity: number;
  filled: number;
  booked: boolean;
  status: string;
}

function filledMap(sessionIds: number[]): Map<number, number> {
  const m = new Map<number, number>();
  if (!sessionIds.length) return m;
  const rows = db
    .select({ sessionId: sessionBookings.sessionId, id: sessionBookings.id })
    .from(sessionBookings)
    .where(and(inArray(sessionBookings.sessionId, sessionIds), ne(sessionBookings.status, "cancelled")))
    .all();
  for (const r of rows) m.set(r.sessionId, (m.get(r.sessionId) ?? 0) + 1);
  return m;
}

export function clientWeek(clientId: number, weekStartIso: string): { weekStart: string; classes: ClientClass[] } {
  const weekStart = weekStartMonday(weekStartIso);
  materializeWeek(weekStart);
  const end = addDaysIso(weekStart, 6);
  const sessions = db
    .select()
    .from(classSessions)
    .where(and(gte(classSessions.date, weekStart), lte(classSessions.date, end)))
    .orderBy(asc(classSessions.date), asc(classSessions.startTime))
    .all();
  const ids = sessions.map((s) => s.id);
  const filled = filledMap(ids);
  const myBookings = ids.length
    ? new Set(
        db
          .select({ sessionId: sessionBookings.sessionId })
          .from(sessionBookings)
          .where(and(eq(sessionBookings.clientId, clientId), inArray(sessionBookings.sessionId, ids), ne(sessionBookings.status, "cancelled")))
          .all()
          .map((r) => r.sessionId),
      )
    : new Set<number>();

  return {
    weekStart,
    classes: sessions.map((s) => ({
      id: s.id,
      date: s.date,
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      location: s.location,
      instructor: s.instructor,
      color: s.color,
      capacity: s.capacity,
      filled: filled.get(s.id) ?? 0,
      booked: myBookings.has(s.id),
      status: s.status,
    })),
  };
}

// ── bookings (my classes / attendance) ─────────────────────────────────────────

export interface ClientBooking {
  bookingId: number;
  sessionId: number;
  date: string;
  startTime: string;
  endTime: string;
  name: string;
  location: string | null;
  instructor: string | null;
  color: string;
  status: string; // booked | attended | no_show
}

function bookingsJoined(clientId: number, opts: { upcoming?: boolean; limit?: number } = {}): ClientBooking[] {
  const today = todayIso();
  const rows = db
    .select({
      bookingId: sessionBookings.id,
      status: sessionBookings.status,
      sessionId: classSessions.id,
      date: classSessions.date,
      startTime: classSessions.startTime,
      endTime: classSessions.endTime,
      name: classSessions.name,
      location: classSessions.location,
      instructor: classSessions.instructor,
      color: classSessions.color,
    })
    .from(sessionBookings)
    .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
    .where(and(eq(sessionBookings.clientId, clientId), ne(sessionBookings.status, "cancelled")))
    .all();
  const filtered = rows
    .filter((r) => (opts.upcoming ? r.date >= today : r.date < today))
    .sort((a, b) =>
      opts.upcoming
        ? a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)
        : b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime),
    );
  return (opts.limit ? filtered.slice(0, opts.limit) : filtered) as ClientBooking[];
}

export function clientUpcoming(clientId: number, limit?: number) {
  return bookingsJoined(clientId, { upcoming: true, limit });
}
export function clientHistory(clientId: number, limit?: number) {
  return bookingsJoined(clientId, { upcoming: false, limit });
}

// ── dashboard aggregate ────────────────────────────────────────────────────────

export interface ClientDashboard {
  membership: ClientMembershipInfo | null;
  nextClass: ClientBooking | null;
  upcomingCount: number;
  weekBooked: number;
  weekAttended: number;
  totalAttended: number;
}

export function clientDashboard(clientId: number): ClientDashboard {
  const today = todayIso();
  const weekStart = weekStartMonday(today);
  const weekEnd = addDaysIso(weekStart, 6);
  const upcoming = clientUpcoming(clientId);
  const all = db
    .select({ status: sessionBookings.status, date: classSessions.date })
    .from(sessionBookings)
    .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
    .where(and(eq(sessionBookings.clientId, clientId), ne(sessionBookings.status, "cancelled")))
    .all();
  const weekRows = all.filter((r) => r.date >= weekStart && r.date <= weekEnd);
  return {
    membership: clientMembership(clientId),
    nextClass: upcoming[0] ?? null,
    upcomingCount: upcoming.length,
    weekBooked: weekRows.length,
    weekAttended: weekRows.filter((r) => r.status === "attended").length,
    totalAttended: all.filter((r) => r.status === "attended").length,
  };
}

// ── nutrition / workouts (tenant plans; per-client assignment is a follow-up) ──

export interface NamedPlan {
  id: number;
  title: string;
  type: string;
}

export function activeNutritionPlans(limit = 20): NamedPlan[] {
  return db
    .select({ id: nutritionPlans.id, title: nutritionPlans.title, type: nutritionPlans.type })
    .from(nutritionPlans)
    .where(eq(nutritionPlans.status, "active"))
    .orderBy(desc(nutritionPlans.updatedAt))
    .limit(limit)
    .all();
}

export function activeWorkoutPrograms(limit = 20): NamedPlan[] {
  return db
    .select({ id: workoutPrograms.id, title: workoutPrograms.title, type: workoutPrograms.type })
    .from(workoutPrograms)
    .where(eq(workoutPrograms.status, "active"))
    .orderBy(desc(workoutPrograms.updatedAt))
    .limit(limit)
    .all();
}

/** Plans/programs assigned specifically to this client (coach-assigned). */
export function assignedNutritionPlans(clientId: number): NamedPlan[] {
  return db
    .select({ id: nutritionPlans.id, title: nutritionPlans.title, type: nutritionPlans.type })
    .from(clientNutritionPlans)
    .innerJoin(nutritionPlans, eq(nutritionPlans.id, clientNutritionPlans.planId))
    .where(eq(clientNutritionPlans.clientId, clientId))
    .orderBy(desc(clientNutritionPlans.assignedAt))
    .all();
}

export function assignedWorkoutPrograms(clientId: number): NamedPlan[] {
  return db
    .select({ id: workoutPrograms.id, title: workoutPrograms.title, type: workoutPrograms.type })
    .from(clientWorkoutPrograms)
    .innerJoin(workoutPrograms, eq(workoutPrograms.id, clientWorkoutPrograms.programId))
    .where(eq(clientWorkoutPrograms.clientId, clientId))
    .orderBy(desc(clientWorkoutPrograms.assignedAt))
    .all();
}
