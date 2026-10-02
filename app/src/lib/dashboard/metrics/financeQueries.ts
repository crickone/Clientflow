import "server-only";

import { and, asc, eq, gte, inArray, isNotNull, lt, lte, ne, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { packageUtilization } from "@/lib/queries";
import { parseTherapyIds, splitAcrossTherapies, topSpenders as topSpendersOf, type PaymentRow } from "./finance";

const P = schema.payments;
const V = schema.giftVouchers;
const A = schema.appointments;
const M = schema.clientMemberships;

/** Payments created in [fromMs, toMs), only the columns the widgets need. */
export function paymentsIn(fromMs: number, toMs: number): PaymentRow[] {
  return db
    .select({ clientId: P.clientId, amount: P.amountEur, method: P.paymentMethod, at: P.createdAt })
    .from(P)
    .where(and(gte(P.createdAt, new Date(fromMs)), lt(P.createdAt, new Date(toMs))))
    .all()
    .map((r) => ({ clientId: r.clientId, amount: r.amount, method: r.method, atMs: r.at.getTime() }));
}

/** Top spenders by revenue methods only (voucher and package redemptions excluded), with names. */
export async function topSpenders(rows: PaymentRow[], limit: number): Promise<{ clientId: number; name: string; total: number }[]> {
  const top = topSpendersOf(rows, limit);
  if (top.length === 0) return [];
  const names = new Map(
    db
      .select({ id: schema.clients.id, first: schema.clients.firstName, last: schema.clients.lastName })
      .from(schema.clients)
      .where(inArray(schema.clients.id, top.map((t) => t.clientId)))
      .all()
      .map((c) => [c.id, `${c.first} ${c.last}`.trim()] as const),
  );
  return top.map((t) => ({ ...t, name: names.get(t.clientId) ?? `Client #${t.clientId}` }));
}

export type VoucherStats = {
  outstanding: number;
  soldCount: number;
  soldValue: number;
  redeemedCount: number;
  redeemedValue: number;
};

/** Gift voucher position: open balance now, plus sold and redeemed in [fromMs, toMs). */
export function voucherStats(fromMs: number, toMs: number, todayIso: string): VoucherStats {
  const open = db
    .select({ total: sql<number>`coalesce(sum(${V.balanceEur}), 0)` })
    .from(V)
    .where(and(eq(V.isRedeemed, false), gte(V.expiryDate, todayIso)))
    .get();
  const sold = db
    .select({ n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${V.valueEur}), 0)` })
    .from(V)
    .where(and(gte(V.createdAt, new Date(fromMs)), lt(V.createdAt, new Date(toMs))))
    .get();
  const redeemed = db
    .select({ n: sql<number>`count(*)`, total: sql<number>`coalesce(sum(${V.valueEur}), 0)` })
    .from(V)
    .where(and(isNotNull(V.redeemedAt), gte(V.redeemedAt, new Date(fromMs)), lt(V.redeemedAt, new Date(toMs))))
    .get();
  return {
    outstanding: Number(open?.total ?? 0),
    soldCount: Number(sold?.n ?? 0),
    soldValue: Number(sold?.total ?? 0),
    redeemedCount: Number(redeemed?.n ?? 0),
    redeemedValue: Number(redeemed?.total ?? 0),
  };
}

/** Completed appointment value dated in the range, split evenly across their therapies, top `limit`. */
export async function revenueByService(fromIso: string, toIso: string, limit: number): Promise<{ label: string; value: number }[]> {
  const appts = db
    .select({ price: A.totalPriceEur, ids: A.therapyIds })
    .from(A)
    .where(and(eq(A.status, "completed"), gte(A.date, fromIso), lte(A.date, toIso)))
    .all();
  const names = new Map(
    db.select({ id: schema.therapies.id, name: schema.therapies.name }).from(schema.therapies).all().map((t) => [t.id, t.name] as const),
  );
  const by = new Map<string, number>();
  for (const a of appts) {
    for (const part of splitAcrossTherapies(a.price ?? 0, parseTherapyIds(a.ids))) {
      const label = part.id === null ? "Unassigned" : (names.get(part.id) ?? "Removed service");
      by.set(label, (by.get(label) ?? 0) + part.amount);
    }
  }
  return [...by]
    .map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }))
    .filter((r) => r.value > 0)
    .sort((x, y) => y.value - x.value)
    .slice(0, limit);
}

/** Active package credit position (percent is 0 to 100). */
export async function packageUse(): Promise<{ activeCount: number; avgPct: number; sold: number; used: number; stalled: number }> {
  const u = await packageUtilization();
  return {
    activeCount: u.activeCount,
    avgPct: Math.round(u.avgUtilizationPct * 1000) / 10,
    sold: u.totalSessionsSold,
    used: u.totalSessionsUsed,
    stalled: u.stalled.length,
  };
}

/** Memberships that ended in [fromMs, toMs) and memberships that were active at fromMs. */
export function churnCounts(fromMs: number, toMs: number): { ended: number; activeAtStart: number } {
  const ended = db
    .select({ n: sql<number>`count(*)` })
    .from(M)
    .where(and(isNotNull(M.endedAt), gte(M.endedAt, new Date(fromMs)), lt(M.endedAt, new Date(toMs))))
    .get();
  const active = db
    .select({ n: sql<number>`count(*)` })
    .from(M)
    .where(and(lt(M.createdAt, new Date(fromMs)), sql`(${M.endedAt} is null or ${M.endedAt} >= ${fromMs})`))
    .get();
  return { ended: Number(ended?.n ?? 0), activeAtStart: Number(active?.n ?? 0) };
}

/** Creation and end instants (ms) of memberships in [fromMs, toMs). */
export function membershipEvents(fromMs: number, toMs: number): { created: number[]; ended: number[] } {
  const created = db
    .select({ at: M.createdAt })
    .from(M)
    .where(and(gte(M.createdAt, new Date(fromMs)), lt(M.createdAt, new Date(toMs))))
    .all()
    .map((r) => r.at.getTime());
  const ended = db
    .select({ at: M.endedAt })
    .from(M)
    .where(and(isNotNull(M.endedAt), gte(M.endedAt, new Date(fromMs)), lt(M.endedAt, new Date(toMs))))
    .all()
    .flatMap((r) => (r.at ? [r.at.getTime()] : []));
  return { created, ended };
}

export type Renewal = { id: number; clientId: number; client: string; plan: string; amountCents: number; date: string };

/** Active memberships billing between two ISO dates (inclusive), soonest first. */
export async function renewalsBetween(fromIso: string, toIso: string, limit: number): Promise<Renewal[]> {
  const rows = db
    .select({
      id: M.id,
      clientId: M.clientId,
      plan: M.membershipName,
      amountCents: M.priceCents,
      date: M.nextBillingDate,
      first: schema.clients.firstName,
      last: schema.clients.lastName,
    })
    .from(M)
    .innerJoin(schema.clients, eq(schema.clients.id, M.clientId))
    .where(and(eq(M.status, "active"), ne(M.nextBillingDate, ""), gte(M.nextBillingDate, fromIso), lte(M.nextBillingDate, toIso)))
    .orderBy(asc(M.nextBillingDate), asc(M.id))
    .limit(limit)
    .all();
  return rows.map((r) => ({
    id: r.id,
    clientId: r.clientId,
    client: `${r.first} ${r.last}`.trim(),
    plan: r.plan,
    amountCents: r.amountCents,
    date: r.date ?? "",
  }));
}
