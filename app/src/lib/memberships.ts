import "server-only";

import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  classSessions,
  clientMemberships,
  clients,
  membershipPlans,
  sessionBookings,
  type MembershipPlan,
} from "@/lib/db/schema";

// ── helpers ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");
function toIso(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function addInterval(iso: string, interval: "week" | "month" | "year", count: number) {
  const d = new Date(`${iso}T00:00:00`);
  if (interval === "week") d.setDate(d.getDate() + 7 * count);
  else if (interval === "month") d.setMonth(d.getMonth() + count);
  else d.setFullYear(d.getFullYear() + count);
  return toIso(d);
}

export interface MembershipInput {
  name: string;
  category?: string | null;
  description?: string | null;
  priceCents: number;
  billingInterval: "week" | "month" | "year";
  billingCount: number;
  unlimitedSessions: boolean;
  sessionsQuantity: number;
  visibility: "all" | "private";
  joiningFeeCents: number;
  openAccess: boolean;
  priorityBooking: boolean;
  forSale: boolean;
}

export interface MembershipWithStats extends MembershipPlan {
  activePayments: number;
}

// ── catalog ───────────────────────────────────────────────────────────────────

export function listMemberships(): MembershipWithStats[] {
  const rows = db
    .select()
    .from(membershipPlans)
    .where(eq(membershipPlans.isActive, true))
    .orderBy(desc(membershipPlans.createdAt))
    .all();

  const counts = db
    .select({
      membershipId: clientMemberships.membershipId,
      n: sql<number>`count(*)`,
    })
    .from(clientMemberships)
    .where(eq(clientMemberships.status, "active"))
    .groupBy(clientMemberships.membershipId)
    .all();
  const countMap = new Map(counts.map((c) => [c.membershipId, Number(c.n)]));

  return rows.map((m) => ({ ...m, activePayments: countMap.get(m.id) ?? 0 }));
}

export function getMembership(id: number): MembershipPlan | undefined {
  return db.select().from(membershipPlans).where(eq(membershipPlans.id, id)).get();
}

export function createMembership(input: MembershipInput): MembershipPlan {
  const [row] = db.insert(membershipPlans).values({ ...input }).returning().all();
  return row;
}

export function updateMembership(id: number, input: MembershipInput) {
  db.update(membershipPlans)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(membershipPlans.id, id))
    .run();
}

/** Soft-delete: keep the row (purchase records reference it) but hide from catalog. */
export function deleteMembership(id: number) {
  db.update(membershipPlans)
    .set({ isActive: false, forSale: false, updatedAt: new Date() })
    .where(eq(membershipPlans.id, id))
    .run();
}

// ── purchased memberships ─────────────────────────────────────────────────────

export interface PurchasedRow {
  id: number;
  clientId: number;
  clientName: string;
  membershipId: number | null;
  membershipName: string;
  priceCents: number;
  status: string;
  startDate: string;
  nextBillingDate: string | null;
}

export function listPurchased(opts: { status?: string; q?: string }): PurchasedRow[] {
  const conds = [] as ReturnType<typeof eq>[];
  if (opts.status && opts.status !== "all") {
    conds.push(eq(clientMemberships.status, opts.status as "active"));
  }
  const rows = db
    .select({
      id: clientMemberships.id,
      clientId: clientMemberships.clientId,
      firstName: clients.firstName,
      lastName: clients.lastName,
      membershipId: clientMemberships.membershipId,
      membershipName: clientMemberships.membershipName,
      priceCents: clientMemberships.priceCents,
      status: clientMemberships.status,
      startDate: clientMemberships.startDate,
      nextBillingDate: clientMemberships.nextBillingDate,
    })
    .from(clientMemberships)
    .innerJoin(clients, eq(clients.id, clientMemberships.clientId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(clientMemberships.startDate))
    .all();

  let out: PurchasedRow[] = rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    clientName: `${r.firstName} ${r.lastName ?? ""}`.trim(),
    membershipId: r.membershipId,
    membershipName: r.membershipName,
    priceCents: r.priceCents,
    status: r.status,
    startDate: r.startDate,
    nextBillingDate: r.nextBillingDate,
  }));

  const q = opts.q?.trim().toLowerCase();
  if (q) {
    out = out.filter(
      (r) => r.clientName.toLowerCase().includes(q) || r.membershipName.toLowerCase().includes(q),
    );
  }
  return out;
}

export function assignMembership(input: {
  membershipId: number;
  clientId: number;
  startDate: string;
}): { ok: true } | { ok: false; error: string } {
  const m = getMembership(input.membershipId);
  if (!m) return { ok: false, error: "Membership not found." };

  // Prevent a duplicate active subscription to the same membership.
  const existing = db
    .select({ id: clientMemberships.id })
    .from(clientMemberships)
    .where(
      and(
        eq(clientMemberships.clientId, input.clientId),
        eq(clientMemberships.membershipId, input.membershipId),
        eq(clientMemberships.status, "active"),
      ),
    )
    .get();
  if (existing) return { ok: false, error: "This client already has that membership active." };

  db.insert(clientMemberships)
    .values({
      membershipId: m.id,
      clientId: input.clientId,
      membershipName: m.name,
      priceCents: m.priceCents,
      status: "active",
      startDate: input.startDate,
      nextBillingDate: addInterval(input.startDate, m.billingInterval, m.billingCount),
    })
    .run();
  return { ok: true };
}

export function setClientMembershipStatus(
  id: number,
  status: "active" | "expired" | "cancelled",
) {
  db.update(clientMemberships).set({ status }).where(eq(clientMemberships.id, id)).run();
}

// ── purchased membership detail ───────────────────────────────────────────────

export interface PurchasedDetail {
  id: number;
  clientId: number;
  clientName: string;
  clientEmail: string | null;
  membershipName: string;
  priceCents: number;
  status: string;
  startDate: string;
  nextBillingDate: string | null;
  billingInterval: "week" | "month" | "year";
  billingCount: number;
  unlimitedSessions: boolean;
  sessionsQuantity: number;
  periodStart: string;
  periodEnd: string;
  sessionsUsed: number;
  bookings: { sessionName: string; date: string; startTime: string; status: string }[];
}

export function getPurchasedMembership(id: number): PurchasedDetail | null {
  const cm = db.select().from(clientMemberships).where(eq(clientMemberships.id, id)).get();
  if (!cm) return null;

  const client = db
    .select({ first: clients.firstName, last: clients.lastName, email: clients.email })
    .from(clients)
    .where(eq(clients.id, cm.clientId))
    .get();
  const plan = cm.membershipId ? getMembership(cm.membershipId) : undefined;

  const billingInterval = plan?.billingInterval ?? "week";
  const billingCount = plan?.billingCount ?? 4;
  const sessionsQuantity = plan?.sessionsQuantity ?? 1;
  const unlimitedSessions = plan?.unlimitedSessions ?? false;

  // Current billing window: [periodEnd - one interval, periodEnd).
  const periodEnd = cm.nextBillingDate ?? addInterval(cm.startDate, billingInterval, billingCount);
  const rawStart = addInterval(periodEnd, billingInterval, -billingCount);
  const periodStart = rawStart < cm.startDate ? cm.startDate : rawStart;

  // Approximate credit usage: the client's non-cancelled bookings in this window.
  const bookings = db
    .select({
      sessionName: classSessions.name,
      date: classSessions.date,
      startTime: classSessions.startTime,
      status: sessionBookings.status,
    })
    .from(sessionBookings)
    .innerJoin(classSessions, eq(classSessions.id, sessionBookings.sessionId))
    .where(
      and(
        eq(sessionBookings.clientId, cm.clientId),
        ne(sessionBookings.status, "cancelled"),
        gte(classSessions.date, periodStart),
        lt(classSessions.date, periodEnd),
      ),
    )
    .orderBy(desc(classSessions.date), desc(classSessions.startTime))
    .all();

  return {
    id: cm.id,
    clientId: cm.clientId,
    clientName: `${client?.first ?? ""} ${client?.last ?? ""}`.trim(),
    clientEmail: client?.email ?? null,
    membershipName: cm.membershipName,
    priceCents: cm.priceCents,
    status: cm.status,
    startDate: cm.startDate,
    nextBillingDate: cm.nextBillingDate,
    billingInterval,
    billingCount,
    unlimitedSessions,
    sessionsQuantity,
    periodStart,
    periodEnd,
    sessionsUsed: bookings.length,
    bookings,
  };
}

/** Bookable clients + those without a given membership (for the assign picker). */
export function listAssignableClients() {
  return db
    .select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
    .from(clients)
    .orderBy(clients.firstName)
    .all();
}

/** Active membership names per client (for "Active product" columns elsewhere). */
export function activeMembershipByClient(): Map<number, string> {
  const rows = db
    .select({ clientId: clientMemberships.clientId, name: clientMemberships.membershipName })
    .from(clientMemberships)
    .where(ne(clientMemberships.status, "cancelled"))
    .all();
  const map = new Map<number, string>();
  for (const r of rows) if (!map.has(r.clientId)) map.set(r.clientId, r.name);
  return map;
}
