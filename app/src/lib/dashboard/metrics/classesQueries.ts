import "server-only";

import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { quietMembers, type QuietMember } from "./classes";

const S = schema.classSessions;
const B = schema.sessionBookings;

export type SessionFill = {
  id: number;
  date: string;
  startTime: string;
  name: string;
  category: string | null;
  instructor: string | null;
  capacity: number;
  booked: number;
  attended: number;
  noShow: number;
};

/** Scheduled class sessions dated in the range, with booking counts from one grouped query. */
export function sessionFills(fromIso: string, toIso: string): SessionFill[] {
  return db
    .select({
      id: S.id,
      date: S.date,
      startTime: S.startTime,
      name: S.name,
      category: S.category,
      instructor: S.instructor,
      capacity: S.capacity,
      booked: sql<number>`count(${B.id})`,
      attended: sql<number>`coalesce(sum(case when ${B.status} = 'attended' then 1 else 0 end), 0)`,
      noShow: sql<number>`coalesce(sum(case when ${B.status} = 'no_show' then 1 else 0 end), 0)`,
    })
    .from(S)
    .leftJoin(B, and(eq(B.sessionId, S.id), inArray(B.status, ["booked", "attended", "no_show"])))
    .where(and(eq(S.status, "scheduled"), gte(S.date, fromIso), lte(S.date, toIso)))
    .groupBy(S.id)
    .orderBy(S.date, S.startTime)
    .all()
    .map((r) => ({ ...r, booked: Number(r.booked), attended: Number(r.attended), noShow: Number(r.noShow) }));
}

/** Bookings made in [fromMs, toMs), any status but cancelled. */
export function bookingsMadeIn(fromMs: number, toMs: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(B)
    .where(and(gte(B.createdAt, new Date(fromMs)), lt(B.createdAt, new Date(toMs)), sql`${B.status} <> 'cancelled'`))
    .get();
  return Number(row?.n ?? 0);
}

/** Active members and their last attended class, as the quiet members (top `limit`). */
export function quietActiveMembers(nowMs: number, days: number, limit: number): QuietMember[] {
  const rows = db
    .select({
      id: schema.clients.id,
      first: schema.clients.firstName,
      last: schema.clients.lastName,
      lastDate: sql<string | null>`(select max(cs.date) from session_bookings sb join class_sessions cs on cs.id = sb.session_id where sb.client_id = clients.id and sb.status = 'attended')`,
    })
    .from(schema.clients)
    .where(sql`exists (select 1 from client_memberships cm where cm.client_id = clients.id and cm.status = 'active')`)
    .all();
  const members: QuietMember[] = rows.map((r) => ({
    id: r.id,
    name: `${r.first} ${r.last}`.trim(),
    lastMs: r.lastDate ? Date.parse(`${r.lastDate}T00:00:00Z`) : null,
  }));
  return quietMembers(members, nowMs, days, limit);
}
