import "server-only";

import { and, asc, eq, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { listPackages, attendanceStats, sessionsByTherapy } from "@/lib/queries";
import { leadTimeBucket, LEAD_BUCKETS, dublinLocalToMs } from "./frontdesk";

const A = schema.appointments;

/** Bookings in an ISO date range that are not cancelled, with how many are confirmed. */
export function bookingsBetween(fromIso: string, toIso: string): { total: number; confirmed: number } {
  const row = db
    .select({
      total: sql<number>`count(*)`,
      confirmed: sql<number>`coalesce(sum(case when ${A.status} = 'confirmed' then 1 else 0 end), 0)`,
    })
    .from(A)
    .where(and(gte(A.date, fromIso), lte(A.date, toIso), ne(A.status, "cancelled")))
    .get();
  return { total: Number(row?.total ?? 0), confirmed: Number(row?.confirmed ?? 0) };
}

/** Completed, no-show and cancelled counts for appointments dated in the range. */
export async function outcomeCounts(
  fromIso: string,
  toIso: string,
): Promise<{ completed: number; noShow: number; cancelled: number; total: number }> {
  const s = await attendanceStats(fromIso, toIso);
  return { completed: s.completed, noShow: s.noShow, cancelled: s.cancelled, total: s.total };
}

export function clientsWithBirthdays(): { id: number; name: string; dob: string | null }[] {
  return db
    .select({ id: schema.clients.id, first: schema.clients.firstName, last: schema.clients.lastName, dob: schema.clients.dateOfBirth })
    .from(schema.clients)
    .where(sql`${schema.clients.dateOfBirth} is not null`)
    .all()
    .map((c) => ({ id: c.id, name: `${c.first} ${c.last}`.trim(), dob: c.dob }));
}

/** Non-cancelled appointments dated in the range (the base for utilisation and busiest times). */
export function activeAppointmentsIn(fromIso: string, toIso: string) {
  return db
    .select({ date: A.date, startTime: A.startTime, endTime: A.endTime })
    .from(A)
    .where(and(gte(A.date, fromIso), lte(A.date, toIso), ne(A.status, "cancelled")))
    .all();
}

export async function serviceSplit(fromIso: string, toIso: string): Promise<{ label: string; value: number; color: string }[]> {
  const rows = await sessionsByTherapy(fromIso, toIso);
  return rows
    .map((r) => ({ label: r.name, value: Number(r.sessions), color: r.colour }))
    .sort((a, b) => b.value - a.value);
}

/** Clients with a completed appointment in the range, split by whether it was their first ever. */
export function newReturningCounts(fromIso: string, toIso: string): { newClients: number; returning: number } {
  const rows = db
    .select({
      first: sql<string>`min(${A.date})`,
      inRange: sql<number>`max(case when ${A.date} >= ${fromIso} and ${A.date} <= ${toIso} then 1 else 0 end)`,
    })
    .from(A)
    .where(eq(A.status, "completed"))
    .groupBy(A.clientId)
    .having(sql`max(case when ${A.date} >= ${fromIso} and ${A.date} <= ${toIso} then 1 else 0 end) = 1`)
    .all();
  const newClients = rows.filter((r) => r.first >= fromIso).length;
  return { newClients, returning: rows.length - newClients };
}

/** Cancelled (not no-show) appointments cancelled in [fromMs, toMs), bucketed by notice given. */
export function cancelLeadTimeCounts(fromMs: number, toMs: number): { label: string; value: number }[] {
  const rows = db
    .select({ date: A.date, startTime: A.startTime, cancelledAt: A.cancelledAt })
    .from(A)
    .where(
      and(
        eq(A.status, "cancelled"),
        eq(A.cancelledAtApprox, false),
        gte(A.cancelledAt, new Date(fromMs)),
        lt(A.cancelledAt, new Date(toMs)),
      ),
    )
    .all();
  const counts = new Map<string, number>(LEAD_BUCKETS.map((b) => [b, 0]));
  for (const r of rows) {
    if (!r.cancelledAt) continue;
    const lead = dublinLocalToMs(r.date, r.startTime) - r.cancelledAt.getTime();
    const b = leadTimeBucket(lead);
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  return LEAD_BUCKETS.map((label) => ({ label, value: counts.get(label) ?? 0 }));
}

export type ExpiringCredit = { id: number; client: string; clientId: number; packageName: string; left: number; expiryDate: string };

/** Active packages expiring within 30 days that still have sessions left, soonest first. */
export async function expiringCredits(limit: number): Promise<ExpiringCredit[]> {
  const pk = (await listPackages("expiring")).filter((p) => p.totalSessions - p.sessionsUsed > 0);
  if (pk.length === 0) return [];
  const names = new Map(
    db
      .select({ id: schema.clients.id, first: schema.clients.firstName, last: schema.clients.lastName })
      .from(schema.clients)
      .where(inArray(schema.clients.id, [...new Set(pk.map((p) => p.clientId))]))
      .orderBy(asc(schema.clients.id))
      .all()
      .map((c) => [c.id, `${c.first} ${c.last}`.trim()] as const),
  );
  return pk
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      clientId: p.clientId,
      client: names.get(p.clientId) ?? "Unknown client",
      packageName: p.packageName,
      left: p.totalSessions - p.sessionsUsed,
      expiryDate: p.expiryDate,
    }));
}
