import "server-only";

import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import type { PackageCredit, PaymentLine, ServiceLine } from "./breakdown";
import { METHOD_LABELS, parseTherapyIds, splitAcrossTherapies } from "./finance";

/**
 * The rows behind the money tiles. Each loader uses the same filters as the
 * tile it opens from (financeQueries.ts and queries.ts prepaidOutstanding),
 * so the rows add up to the tile.
 */

const P = schema.payments;
const A = schema.appointments;
const K = schema.packages;
const V = schema.giftVouchers;

function clientNames(ids: number[]): Map<number, string> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  return new Map(
    db
      .select({ id: schema.clients.id, first: schema.clients.firstName, last: schema.clients.lastName })
      .from(schema.clients)
      .where(inArray(schema.clients.id, unique))
      .all()
      .map((c) => [c.id, `${c.first} ${c.last}`.trim()] as const),
  );
}

function therapyNames(): Map<number, string> {
  return new Map(db.select({ id: schema.therapies.id, name: schema.therapies.name }).from(schema.therapies).all().map((t) => [t.id, t.name] as const));
}

const nameOf = (names: Map<number, string>, id: number) => names.get(id) || `Client #${id}`;

function servicesLabel(ids: number[], therapies: Map<number, string>): string {
  if (ids.length === 0) return "No service set";
  return ids.map((id) => therapies.get(id) ?? "Removed service").join(", ");
}

/** Every payment created in [fromMs, toMs), newest first, with who paid and what for. */
export function paymentLines(fromMs: number, toMs: number): PaymentLine[] {
  const rows = db
    .select({
      id: P.id,
      clientId: P.clientId,
      amount: P.amountEur,
      method: P.paymentMethod,
      notes: P.notes,
      at: P.createdAt,
      appointmentId: P.appointmentId,
      packageId: P.packageId,
      voucherId: P.voucherId,
    })
    .from(P)
    .where(and(gte(P.createdAt, new Date(fromMs)), lt(P.createdAt, new Date(toMs))))
    .orderBy(desc(P.createdAt), desc(P.id))
    .all();
  if (rows.length === 0) return [];

  const names = clientNames(rows.map((r) => r.clientId));
  const therapies = therapyNames();
  const apptIds = rows.flatMap((r) => (r.appointmentId ? [r.appointmentId] : []));
  const pkgIds = rows.flatMap((r) => (r.packageId ? [r.packageId] : []));
  const voucherIds = rows.flatMap((r) => (r.voucherId ? [r.voucherId] : []));
  const appts = new Map(
    apptIds.length
      ? db.select({ id: A.id, date: A.date, ids: A.therapyIds }).from(A).where(inArray(A.id, apptIds)).all().map((a) => [a.id, a] as const)
      : [],
  );
  const pkgs = new Map(
    pkgIds.length ? db.select({ id: K.id, name: K.packageName }).from(K).where(inArray(K.id, pkgIds)).all().map((p) => [p.id, p.name] as const) : [],
  );
  const vouchers = new Map(
    voucherIds.length ? db.select({ id: V.id, code: V.code }).from(V).where(inArray(V.id, voucherIds)).all().map((v) => [v.id, v.code] as const) : [],
  );

  return rows.map((r) => {
    let forWhat = "";
    const appt = r.appointmentId ? appts.get(r.appointmentId) : undefined;
    if (appt) forWhat = `${servicesLabel(parseTherapyIds(appt.ids), therapies)} on ${formatDate(`${appt.date}T12:00:00Z`)}`;
    else if (r.packageId) forWhat = pkgs.get(r.packageId) ?? "A package";
    else if (r.voucherId) forWhat = `Gift voucher ${vouchers.get(r.voucherId) ?? ""}`.trim();
    if (!forWhat) forWhat = r.notes?.trim() || "Not linked to a booking";
    return {
      id: r.id,
      atMs: r.at.getTime(),
      clientId: r.clientId,
      clientName: nameOf(names, r.clientId),
      method: r.method,
      amount: r.amount,
      forWhat,
    };
  });
}

export const methodLabel = (m: string) => METHOD_LABELS[m] ?? m;

/** Completed appointments dated in [fromIso, toIso] with their value, newest first. */
export function serviceLines(fromIso: string, toIso: string): ServiceLine[] {
  const rows = db
    .select({ id: A.id, date: A.date, start: A.startTime, clientId: A.clientId, price: A.totalPriceEur, ids: A.therapyIds })
    .from(A)
    .where(and(eq(A.status, "completed"), gte(A.date, fromIso), lte(A.date, toIso)))
    .orderBy(desc(A.date), desc(A.startTime))
    .all();
  const names = clientNames(rows.map((r) => r.clientId));
  const therapies = therapyNames();
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    clientId: r.clientId,
    clientName: nameOf(names, r.clientId),
    services: servicesLabel(parseTherapyIds(r.ids), therapies),
    value: r.price ?? 0,
  }));
}

/** Completed value per service in [fromIso, toIso], split the way the Revenue by service tile splits it. */
export function serviceTotals(fromIso: string, toIso: string): { label: string; value: number; count: number }[] {
  const rows = db
    .select({ price: A.totalPriceEur, ids: A.therapyIds })
    .from(A)
    .where(and(eq(A.status, "completed"), gte(A.date, fromIso), lte(A.date, toIso)))
    .all();
  const therapies = therapyNames();
  const by = new Map<string, { value: number; count: number }>();
  for (const a of rows) {
    for (const part of splitAcrossTherapies(a.price ?? 0, parseTherapyIds(a.ids))) {
      const label = part.id === null ? "No service set" : (therapies.get(part.id) ?? "Removed service");
      const cur = by.get(label) ?? { value: 0, count: 0 };
      cur.value += part.amount;
      cur.count++;
      by.set(label, cur);
    }
  }
  return [...by]
    .map(([label, v]) => ({ label, value: Math.round(v.value * 100) / 100, count: v.count }))
    .filter((r) => r.value > 0)
    .sort((x, y) => y.value - x.value);
}

function packageRows(where: ReturnType<typeof and>): PackageCredit[] {
  const rows = db
    .select({
      id: K.id,
      clientId: K.clientId,
      packageName: K.packageName,
      totalSessions: K.totalSessions,
      sessionsUsed: K.sessionsUsed,
      pricePaid: K.pricePaidEur,
      purchaseDate: K.purchaseDate,
      expiryDate: K.expiryDate,
    })
    .from(K)
    .where(where)
    .orderBy(asc(K.expiryDate), asc(K.id))
    .all();
  const names = clientNames(rows.map((r) => r.clientId));
  return rows.map((r) => ({ ...r, clientName: nameOf(names, r.clientId) }));
}

/** Packages with credit still owed: the package half of Deferred revenue. */
export function packagesWithCredit(todayIso: string): PackageCredit[] {
  return packageRows(and(eq(K.isActive, true), gte(K.expiryDate, todayIso), sql`${K.sessionsUsed} < ${K.totalSessions}`));
}

/** Every active package: the Package use tile. */
export function activePackages(): PackageCredit[] {
  return packageRows(and(eq(K.isActive, true)));
}

export type OpenVoucher = {
  id: number;
  code: string;
  purchaserName: string;
  recipientName: string | null;
  value: number;
  balance: number;
  purchaseDate: string;
  expiryDate: string;
  source: "staff" | "online";
};

/** Vouchers with money left on them: the voucher half of Deferred revenue. */
export function openVouchers(todayIso: string): OpenVoucher[] {
  return db
    .select({
      id: V.id,
      code: V.code,
      purchaserName: V.purchaserName,
      recipientName: V.recipientName,
      value: V.valueEur,
      balance: V.balanceEur,
      purchaseDate: V.purchaseDate,
      expiryDate: V.expiryDate,
      source: V.source,
    })
    .from(V)
    .where(and(eq(V.isRedeemed, false), gte(V.expiryDate, todayIso), sql`${V.balanceEur} > 0`))
    .orderBy(asc(V.expiryDate), asc(V.id))
    .all();
}
