import "server-only";

import { and, eq, gte, lte, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  classSessions,
  clientMemberships,
  emailMessages,
  leads,
  membershipPlans,
  payments,
  sessionBookings,
} from "@/lib/db/schema";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

function weekBounds(): { start: string; end: string } {
  const now = new Date();
  const dow = (now.getUTCDay() + 6) % 7; // Mon = 0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
  const sunday = new Date(monday.getTime() + 6 * DAY);
  return { start: iso(monday), end: iso(sunday) };
}

export type TodayClass = {
  id: number;
  name: string;
  time: string;
  capacity: number;
  booked: number;
  instructor: string | null;
};

export type GymDashboard = {
  activeMembers: number;
  mrrCents: number;
  classesThisWeek: number;
  attendanceRatePct: number | null;
  newLeadsThisMonth: number;
  revenueThisMonthEur: number;
  todayClasses: TodayClass[];
};

export function getGymDashboard(): GymDashboard {
  const today = iso(new Date());
  const week = weekBounds();

  // Active memberships → member count + MRR (normalised to a monthly figure).
  const active = db
    .select({
      clientId: clientMemberships.clientId,
      priceCents: clientMemberships.priceCents,
      interval: membershipPlans.billingInterval,
      count: membershipPlans.billingCount,
    })
    .from(clientMemberships)
    .leftJoin(membershipPlans, eq(membershipPlans.id, clientMemberships.membershipId))
    .where(eq(clientMemberships.status, "active"))
    .all();

  const memberIds = new Set<number>();
  let mrrCents = 0;
  for (const m of active) {
    memberIds.add(m.clientId);
    const intervalMonths = m.interval === "week" ? 12 / 52 : m.interval === "year" ? 12 : 1;
    const cycleMonths = (m.count ?? 1) * intervalMonths;
    mrrCents += cycleMonths > 0 ? m.priceCents / cycleMonths : m.priceCents;
  }

  const classesThisWeek = db
    .select({ id: classSessions.id })
    .from(classSessions)
    .where(and(gte(classSessions.date, week.start), lte(classSessions.date, week.end), eq(classSessions.status, "scheduled")))
    .all().length;

  // Attendance rate over the last 30 days (of past, non-cancelled bookings).
  const since = iso(new Date(Date.now() - 30 * DAY));
  const pastBookings = db
    .select({ status: sessionBookings.status })
    .from(sessionBookings)
    .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
    .where(and(gte(classSessions.date, since), lte(classSessions.date, today), ne(sessionBookings.status, "cancelled")))
    .all();
  const attended = pastBookings.filter((b) => b.status === "attended").length;
  const attendanceRatePct = pastBookings.length > 0 ? Math.round((attended / pastBookings.length) * 100) : null;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const newLeadsThisMonth = db
    .select({ id: leads.id })
    .from(leads)
    .where(gte(leads.createdAt, monthStart))
    .all().length;

  const monthPays = db.select({ amount: payments.amountEur }).from(payments).where(gte(payments.createdAt, monthStart)).all();
  const revenueThisMonthEur = monthPays.reduce((s, p) => s + p.amount, 0);

  // Today's classes with booked counts.
  const rows = db
    .select()
    .from(classSessions)
    .where(and(eq(classSessions.date, today), eq(classSessions.status, "scheduled")))
    .orderBy(classSessions.startTime)
    .all();
  const todayClasses: TodayClass[] = rows.map((s) => ({
    id: s.id,
    name: s.name,
    time: s.startTime,
    capacity: s.capacity,
    instructor: s.instructor,
    booked: db
      .select({ id: sessionBookings.id })
      .from(sessionBookings)
      .where(and(eq(sessionBookings.sessionId, s.id), ne(sessionBookings.status, "cancelled")))
      .all().length,
  }));

  return {
    activeMembers: memberIds.size,
    mrrCents: Math.round(mrrCents),
    classesThisWeek,
    attendanceRatePct,
    newLeadsThisMonth,
    revenueThisMonthEur: Number(revenueThisMonthEur.toFixed(2)),
    todayClasses,
  };
}

export type AttentionItem = {
  key: string;
  label: string;
  count: number;
  href: string;
  tone: "alert" | "info";
};

/** Cross-venue "what needs me" strip — only non-zero items are returned. */
export function getNeedsAttention(): AttentionItem[] {
  const items: AttentionItem[] = [];

  const unreadEmails = db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(and(eq(emailMessages.direction, "in"), eq(emailMessages.isRead, false)))
    .all().length;
  if (unreadEmails > 0) {
    items.push({ key: "email", label: unreadEmails === 1 ? "unread email" : "unread emails", count: unreadEmails, href: "/communication", tone: "alert" });
  }

  const newLeads = db.select({ id: leads.id }).from(leads).where(eq(leads.status, "new")).all().length;
  if (newLeads > 0) {
    items.push({ key: "leads", label: newLeads === 1 ? "new lead to follow up" : "new leads to follow up", count: newLeads, href: "/leads", tone: "alert" });
  }

  return items;
}
