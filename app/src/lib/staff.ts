import "server-only";

import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { classSessions, sessionBookings, staff, type Staff } from "@/lib/db/schema";

function hm2min(hm: string) {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

export interface StaffInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  payType: "per_session" | "per_hour" | "fixed";
  payRateCents: number;
  isApproved: boolean;
  isActive: boolean;
  notes?: string | null;
}

// ── roster CRUD ───────────────────────────────────────────────────────────────

export function listStaff(): Staff[] {
  return db.select().from(staff).orderBy(asc(staff.name)).all();
}

export function createStaff(input: StaffInput): Staff {
  const [row] = db.insert(staff).values({ ...input }).returning().all();
  return row;
}

export function updateStaff(id: number, input: Partial<StaffInput>) {
  db.update(staff)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(staff.id, id))
    .run();
}

export function deleteStaff(id: number) {
  db.delete(staff).where(eq(staff.id, id)).run();
}

// ── per-instructor aggregation (sessions matched by instructor name) ──────────

interface InstructorAgg {
  sessions: number;
  hours: number;
  capacity: number;
  bookings: number;
  cancellations: number;
}

function aggregateByInstructor(from: string, to: string): Map<string, InstructorAgg> {
  const sessions = db
    .select({
      id: classSessions.id,
      instructor: classSessions.instructor,
      capacity: classSessions.capacity,
      startTime: classSessions.startTime,
      endTime: classSessions.endTime,
    })
    .from(classSessions)
    .where(and(gte(classSessions.date, from), lte(classSessions.date, to), ne(classSessions.status, "cancelled")))
    .all();

  const bookingRows = db
    .select({
      sessionId: sessionBookings.sessionId,
      status: sessionBookings.status,
      n: sql<number>`count(*)`,
    })
    .from(sessionBookings)
    .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
    .where(and(gte(classSessions.date, from), lte(classSessions.date, to)))
    .groupBy(sessionBookings.sessionId, sessionBookings.status)
    .all();

  const perSession = new Map<number, { bookings: number; cancellations: number }>();
  for (const r of bookingRows) {
    const ps = perSession.get(r.sessionId) ?? { bookings: 0, cancellations: 0 };
    if (r.status === "cancelled") ps.cancellations += Number(r.n);
    else ps.bookings += Number(r.n);
    perSession.set(r.sessionId, ps);
  }

  const map = new Map<string, InstructorAgg>();
  for (const s of sessions) {
    const key = (s.instructor ?? "").trim().toLowerCase();
    if (!key) continue;
    const a = map.get(key) ?? { sessions: 0, hours: 0, capacity: 0, bookings: 0, cancellations: 0 };
    a.sessions += 1;
    a.capacity += s.capacity;
    a.hours += (hm2min(s.endTime) - hm2min(s.startTime)) / 60;
    const ps = perSession.get(s.id);
    if (ps) {
      a.bookings += ps.bookings;
      a.cancellations += ps.cancellations;
    }
    map.set(key, a);
  }
  return map;
}

// ── payroll ───────────────────────────────────────────────────────────────────

export interface PayrollRow {
  staffId: number;
  name: string;
  payType: "per_session" | "per_hour" | "fixed";
  payRateCents: number;
  sessions: number;
  hours: number;
  grossCents: number;
}

export function payrollMetrics(from: string, to: string): PayrollRow[] {
  const agg = aggregateByInstructor(from, to);
  return listStaff().map((s) => {
    const a = agg.get(s.name.trim().toLowerCase());
    const sessions = a?.sessions ?? 0;
    const hours = a?.hours ?? 0;
    let grossCents = 0;
    if (s.payType === "per_session") grossCents = sessions * s.payRateCents;
    else if (s.payType === "per_hour") grossCents = Math.round(hours * s.payRateCents);
    else grossCents = s.payRateCents; // fixed for the period
    return {
      staffId: s.id,
      name: s.name,
      payType: s.payType,
      payRateCents: s.payRateCents,
      sessions,
      hours: Math.round(hours * 10) / 10,
      grossCents,
    };
  });
}

// ── performance ───────────────────────────────────────────────────────────────

export interface PerformanceRow {
  staffId: number;
  name: string;
  sessions: number;
  bookings: number;
  bookingPct: number;
  cancellations: number;
  cancellationPct: number;
}

export function performanceMetrics(from: string, to: string): PerformanceRow[] {
  const agg = aggregateByInstructor(from, to);
  return listStaff().map((s) => {
    const a = agg.get(s.name.trim().toLowerCase()) ?? {
      sessions: 0,
      hours: 0,
      capacity: 0,
      bookings: 0,
      cancellations: 0,
    };
    const bookingPct = a.capacity > 0 ? Math.round((a.bookings / a.capacity) * 100) : 0;
    const denom = a.bookings + a.cancellations;
    const cancellationPct = denom > 0 ? Math.round((a.cancellations / denom) * 100) : 0;
    return {
      staffId: s.id,
      name: s.name,
      sessions: a.sessions,
      bookings: a.bookings,
      bookingPct,
      cancellations: a.cancellations,
      cancellationPct,
    };
  });
}
