import "server-only";

import { and, desc, eq, gte, lte, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { classSessions, clients, sessionBookings } from "@/lib/db/schema";
import { addDaysIso } from "@/lib/timetable";

// ── date helpers ──────────────────────────────────────────────────────────────

function daysInclusive(from: string, to: string) {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}
function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let d = from;
  for (let i = 0; i < 400 && d <= to; i++) {
    out.push(d);
    d = addDaysIso(d, 1);
  }
  return out;
}

// ── bookings list ─────────────────────────────────────────────────────────────

export interface BookingRow {
  bookingId: number;
  clientId: number;
  clientName: string;
  bookedOn: number; // epoch ms
  sessionId: number;
  sessionName: string;
  sessionDate: string;
  startTime: string;
  status: string;
}

export function listBookings(opts: {
  from: string;
  to: string;
  status?: string;
  q?: string;
  limit?: number;
}): BookingRow[] {
  const conds = [gte(classSessions.date, opts.from), lte(classSessions.date, opts.to)];
  if (opts.status && opts.status !== "all") {
    conds.push(eq(sessionBookings.status, opts.status as "booked"));
  }
  const rows = db
    .select({
      bookingId: sessionBookings.id,
      clientId: sessionBookings.clientId,
      firstName: clients.firstName,
      lastName: clients.lastName,
      bookedOn: sessionBookings.createdAt,
      sessionId: classSessions.id,
      sessionName: classSessions.name,
      sessionDate: classSessions.date,
      startTime: classSessions.startTime,
      status: sessionBookings.status,
    })
    .from(sessionBookings)
    .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
    .innerJoin(clients, eq(clients.id, sessionBookings.clientId))
    .where(and(...conds))
    .orderBy(desc(classSessions.date), desc(classSessions.startTime))
    .all();

  let out: BookingRow[] = rows.map((r) => ({
    bookingId: r.bookingId,
    clientId: r.clientId,
    clientName: `${r.firstName} ${r.lastName ?? ""}`.trim(),
    bookedOn: r.bookedOn instanceof Date ? r.bookedOn.getTime() : Number(r.bookedOn),
    sessionId: r.sessionId,
    sessionName: r.sessionName,
    sessionDate: r.sessionDate,
    startTime: r.startTime,
    status: r.status,
  }));

  const q = opts.q?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (r) => r.clientName.toLowerCase().includes(q) || r.sessionName.toLowerCase().includes(q),
    );
  }
  if (opts.limit) out = out.slice(0, opts.limit);
  return out;
}

// ── attendance stats (with previous-period comparison) ────────────────────────

export interface DailyPoint {
  date: string;
  count: number;
}
export interface AttendanceStats {
  bookings: number;
  attended: number;
  noShow: number;
  prevBookings: number;
  changePct: number | null;
  daily: DailyPoint[];
}

export function attendanceStats(from: string, to: string): AttendanceStats {
  const inRange = (a: string, b: string) =>
    and(gte(classSessions.date, a), lte(classSessions.date, b));
  const nonCancel = ne(sessionBookings.status, "cancelled");

  const count = (where: ReturnType<typeof and>) =>
    db
      .select({ n: sql<number>`count(*)` })
      .from(sessionBookings)
      .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
      .where(where)
      .get()?.n ?? 0;

  const bookings = count(and(inRange(from, to), nonCancel));
  const attended = count(and(inRange(from, to), eq(sessionBookings.status, "attended")));
  const noShow = count(and(inRange(from, to), eq(sessionBookings.status, "no_show")));

  const days = daysInclusive(from, to);
  const prevTo = addDaysIso(from, -1);
  const prevFrom = addDaysIso(from, -days);
  const prevBookings = count(and(inRange(prevFrom, prevTo), nonCancel));
  const changePct =
    prevBookings === 0 ? (bookings > 0 ? null : 0) : ((bookings - prevBookings) / prevBookings) * 100;

  const dailyRows = db
    .select({ date: classSessions.date, n: sql<number>`count(*)` })
    .from(sessionBookings)
    .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
    .where(and(inRange(from, to), nonCancel))
    .groupBy(classSessions.date)
    .all();
  const map = new Map(dailyRows.map((r) => [r.date, Number(r.n)]));
  const daily = eachDate(from, to).map((d) => ({ date: d, count: map.get(d) ?? 0 }));

  return { bookings, attended, noShow, prevBookings, changePct, daily };
}

// ── client activity ───────────────────────────────────────────────────────────

export interface ClientActivityRow {
  clientId: number;
  name: string;
  sessionsInRange: number;
  totalSessions: number;
  lastSessionDate: string | null;
  lastSessionName: string | null;
  status: "active" | "inactive" | "never";
}

export function clientActivity(opts: {
  from: string;
  today: string;
  q?: string;
  status?: string;
}): ClientActivityRow[] {
  const all = db
    .select({ id: clients.id, first: clients.firstName, last: clients.lastName })
    .from(clients)
    .all();

  const rows = db
    .select({
      clientId: sessionBookings.clientId,
      date: classSessions.date,
      name: classSessions.name,
    })
    .from(sessionBookings)
    .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
    .where(ne(sessionBookings.status, "cancelled"))
    .all();

  const agg = new Map<
    number,
    { inRange: number; total: number; lastDate: string | null; lastName: string | null }
  >();
  for (const r of rows) {
    const a = agg.get(r.clientId) ?? { inRange: 0, total: 0, lastDate: null, lastName: null };
    a.total++;
    if (r.date >= opts.from && r.date <= opts.today) a.inRange++;
    if (r.date <= opts.today && (a.lastDate === null || r.date > a.lastDate)) {
      a.lastDate = r.date;
      a.lastName = r.name;
    }
    agg.set(r.clientId, a);
  }

  let out: ClientActivityRow[] = all.map((c) => {
    const a = agg.get(c.id);
    const total = a?.total ?? 0;
    const inRange = a?.inRange ?? 0;
    const status: ClientActivityRow["status"] =
      total === 0 ? "never" : inRange > 0 ? "active" : "inactive";
    return {
      clientId: c.id,
      name: `${c.first} ${c.last ?? ""}`.trim(),
      sessionsInRange: inRange,
      totalSessions: total,
      lastSessionDate: a?.lastDate ?? null,
      lastSessionName: a?.lastName ?? null,
      status,
    };
  });

  const q = opts.q?.trim().toLowerCase();
  if (q) out = out.filter((r) => r.name.toLowerCase().includes(q));
  if (opts.status && opts.status !== "all") out = out.filter((r) => r.status === opts.status);
  out.sort(
    (x, y) =>
      (y.lastSessionDate ?? "").localeCompare(x.lastSessionDate ?? "") ||
      x.name.localeCompare(y.name),
  );
  return out;
}
