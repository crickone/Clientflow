import "server-only";
import crypto from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  appointments,
  giftVouchers,
  therapies,
  voucherOrders,
  voucherRedemptions,
  type Voucher,
  type VoucherOrder,
  type VoucherRedemption,
} from "@/lib/db/schema";
import { isModuleOn } from "@/lib/features";
import { getFeatureFlagsForTenant, getThemeForTenant, readKey, setKey } from "@/lib/settings";
import { getDesignSystemForTenant } from "@/lib/design/system";
import {
  CODE_ALPHABET,
  formatCode,
  parseStoreSettings,
  type Colourway,
  type StoreTreatment,
  type ValidOrder,
  type VoucherStoreSettings,
} from "./model";

/**
 * Reads and writes for the voucher store, on the CURRENT tenant (the ambient
 * `db`: a staff request, or a public route / job inside runWithTenant).
 */

export const VOUCHER_STORE_KEY = "voucher_store";

/** The module flag for this business, failing closed. */
export function storeFlagOn(tenantId: number): boolean {
  try {
    return isModuleOn(getFeatureFlagsForTenant(tenantId), "voucher_store");
  } catch (err) {
    console.error("[vouchers] module flags unreadable:", err);
    return false;
  }
}

export function getStoreSettings(): VoucherStoreSettings {
  return parseStoreSettings(readKey<unknown>(VOUCHER_STORE_KEY, null));
}

export function saveStoreSettings(s: VoucherStoreSettings): void {
  setKey(VOUCHER_STORE_KEY, s);
}

/** Active therapies with a price, for the settings page. */
export function listSellableTherapies(): StoreTreatment[] {
  return db
    .select({ id: therapies.id, name: therapies.name, priceEur: therapies.defaultPriceEur })
    .from(therapies)
    .where(eq(therapies.isActive, true))
    .orderBy(asc(therapies.name))
    .all()
    .filter((t) => t.priceEur > 0);
}

/** The ticked treatments that are still active and priced, in the order ticked. */
export function storeTreatments(ids: readonly number[]): StoreTreatment[] {
  if (ids.length === 0) return [];
  const rows = db
    .select({ id: therapies.id, name: therapies.name, priceEur: therapies.defaultPriceEur })
    .from(therapies)
    .where(and(inArray(therapies.id, [...ids]), eq(therapies.isActive, true)))
    .all();
  return ids.map((id) => rows.find((r) => r.id === id)).filter((t): t is StoreTreatment => !!t && t.priceEur > 0);
}

export function therapyName(id: number | null): string | null {
  if (!id) return null;
  return db.select({ name: therapies.name }).from(therapies).where(eq(therapies.id, id)).get()?.name ?? null;
}

/**
 * The business's own colours, for the card colourways: its design system's
 * values when it has one, else its brand accent.
 */
export function brandPaletteForTenant(tenantId: number): string[] {
  const system = getDesignSystemForTenant(tenantId);
  const fromSystem = system ? system.values.filter((v) => v.role !== "reserved").map((v) => v.hex) : [];
  return fromSystem.length ? fromSystem : [getThemeForTenant(tenantId).accent];
}

// ---- orders --------------------------------------------------------------------

export function createPendingVoucherOrder(
  o: ValidOrder,
  extra: { colourway: Colourway; stripeAccountId: string; siteId: number | null; siteUrl: string },
): VoucherOrder {
  const [row] = db
    .insert(voucherOrders)
    .values({
      kind: o.kind,
      valueCents: o.valueCents,
      therapyId: o.therapyId,
      buyerName: o.buyerName,
      buyerEmail: o.buyerEmail,
      recipientName: o.toName,
      recipientEmail: o.recipientEmail,
      fromName: o.fromName,
      message: o.message,
      colourway: JSON.stringify(extra.colourway),
      deliverTo: o.deliverTo,
      deliverOn: o.deliverOn,
      status: "pending",
      stripeAccountId: extra.stripeAccountId,
      siteId: extra.siteId,
      siteUrl: extra.siteUrl,
      createdAt: Date.now(),
    })
    .returning()
    .all();
  return row!;
}

export function getVoucherOrder(id: number): VoucherOrder | null {
  return db.select().from(voucherOrders).where(eq(voucherOrders.id, id)).get() ?? null;
}

export function voucherOrderForSession(sessionId: string): VoucherOrder | null {
  return db.select().from(voucherOrders).where(eq(voucherOrders.stripeSessionId, sessionId)).get() ?? null;
}

export function voucherOrderForPaymentIntent(pi: string): VoucherOrder | null {
  return db.select().from(voucherOrders).where(eq(voucherOrders.paymentIntentId, pi)).get() ?? null;
}

export function setVoucherOrderSession(orderId: number, sessionId: string): void {
  db.update(voucherOrders).set({ stripeSessionId: sessionId }).where(eq(voucherOrders.id, orderId)).run();
}

export function setVoucherOrderStatus(orderId: number, status: VoucherOrder["status"], onlyFrom?: VoucherOrder["status"][]): boolean {
  const where = onlyFrom ? and(eq(voucherOrders.id, orderId), inArray(voucherOrders.status, onlyFrom)) : eq(voucherOrders.id, orderId);
  return db.update(voucherOrders).set({ status }).where(where).run().changes > 0;
}

// ---- vouchers ------------------------------------------------------------------

/** A code no voucher in this business has yet, e.g. "OH-2026-DTA9". */
export function newVoucherCode(prefix: string, year = new Date().getFullYear()): string {
  for (;;) {
    const code = formatCode(prefix, year, [0, 1, 2, 3].map(() => crypto.randomInt(CODE_ALPHABET.length)));
    if (!db.select({ id: giftVouchers.id }).from(giftVouchers).where(eq(giftVouchers.code, code)).get()) return code;
  }
}

/** The /v/<token> secret: 18 random bytes, unrelated to the short code. */
export function newViewToken(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function getVoucherById(id: number): Voucher | null {
  return db.select().from(giftVouchers).where(eq(giftVouchers.id, id)).get() ?? null;
}

export function getVoucherByViewToken(token: string): Voucher | null {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  return db.select().from(giftVouchers).where(eq(giftVouchers.viewToken, token)).get() ?? null;
}

/** By code, the way staff type it (any case, stray spaces). */
export function getVoucherByCode(code: string): Voucher | null {
  const c = code.trim().toUpperCase().replace(/\s+/g, "");
  if (!c) return null;
  return db.select().from(giftVouchers).where(sql`upper(${giftVouchers.code}) = ${c}`).get() ?? null;
}

export function orderForVoucher(v: Pick<Voucher, "voucherOrderId">): VoucherOrder | null {
  return v.voucherOrderId ? getVoucherOrder(v.voucherOrderId) : null;
}

export interface VoucherRow extends Voucher {
  order: Pick<VoucherOrder, "id" | "buyerName" | "buyerEmail" | "recipientEmail" | "deliverTo" | "deliverOn" | "deliveredAt" | "deliveryError" | "status"> | null;
}

/** Every voucher, newest first, with its online order when it has one. */
export function listVoucherRows(): VoucherRow[] {
  return db
    .select({ v: giftVouchers, o: voucherOrders })
    .from(giftVouchers)
    .leftJoin(voucherOrders, eq(voucherOrders.id, giftVouchers.voucherOrderId))
    .orderBy(desc(giftVouchers.createdAt))
    .all()
    .map(({ v, o }) => ({
      ...v,
      order: o
        ? {
            id: o.id,
            buyerName: o.buyerName,
            buyerEmail: o.buyerEmail,
            recipientEmail: o.recipientEmail,
            deliverTo: o.deliverTo,
            deliverOn: o.deliverOn,
            deliveredAt: o.deliveredAt,
            deliveryError: o.deliveryError,
            status: o.status,
          }
        : null,
    }));
}

export function listRedemptions(voucherId: number): (VoucherRedemption & { appointmentDate: string | null })[] {
  return db
    .select({ r: voucherRedemptions, date: appointments.date })
    .from(voucherRedemptions)
    .leftJoin(appointments, eq(appointments.id, voucherRedemptions.appointmentId))
    .where(eq(voucherRedemptions.voucherId, voucherId))
    .orderBy(asc(voucherRedemptions.createdAt), asc(voucherRedemptions.id))
    .all()
    .map(({ r, date }) => ({ ...r, appointmentDate: date ?? null }));
}

export function cancelVoucher(voucherId: number, now = Date.now()): void {
  db.update(giftVouchers).set({ balanceEur: 0, isRedeemed: true, cancelledAt: now }).where(eq(giftVouchers.id, voucherId)).run();
}

// ---- delivery --------------------------------------------------------------------

/**
 * Take the gift email for sending: stamps delivered_at only if nobody has
 * (and no failure is waiting for staff). The ticker and the purchase can
 * both try; only one gets true.
 */
export function claimDelivery(orderId: number, now = Date.now()): boolean {
  return (
    db
      .update(voucherOrders)
      .set({ deliveredAt: now })
      .where(and(eq(voucherOrders.id, orderId), isNull(voucherOrders.deliveredAt), isNull(voucherOrders.deliveryError)))
      .run().changes === 1
  );
}

/** The send failed: back to not delivered, with the reason for staff. */
export function failDelivery(orderId: number, error: string): void {
  db.update(voucherOrders).set({ deliveredAt: null, deliveryError: error.slice(0, 300) }).where(eq(voucherOrders.id, orderId)).run();
}

export function markDelivered(orderId: number, now = Date.now()): void {
  db.update(voucherOrders).set({ deliveredAt: now, deliveryError: null }).where(eq(voucherOrders.id, orderId)).run();
}

/** Staff asked to send it again: clear the last attempt so it can be claimed. */
export function resetDelivery(orderId: number): void {
  db.update(voucherOrders).set({ deliveredAt: null, deliveryError: null }).where(eq(voucherOrders.id, orderId)).run();
}

export function setRecipientEmail(orderId: number, email: string): void {
  db.update(voucherOrders).set({ recipientEmail: email }).where(eq(voucherOrders.id, orderId)).run();
}

/** Paid gifts for a recipient that have not gone and have not failed. The caller checks the time. */
export function pendingGiftOrders(): VoucherOrder[] {
  return db
    .select()
    .from(voucherOrders)
    .where(
      and(
        eq(voucherOrders.status, "paid"),
        eq(voucherOrders.deliverTo, "recipient"),
        isNull(voucherOrders.deliveredAt),
        isNull(voucherOrders.deliveryError),
        sql`${voucherOrders.giftVoucherId} is not null`,
      ),
    )
    .all();
}
