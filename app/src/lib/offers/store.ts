import "server-only";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { offerOrders, offers, therapies, type Offer, type OfferOrder } from "@/lib/db/schema";
import { offerState, parseItems, remaining, type OfferInput, type OfferItem, type OfferState } from "./model";

/** Offers and their orders, for the CURRENT tenant (ambient `db`). */

/** A checkout still open on Stripe holds its place for this long. */
export const HOLD_MS = 35 * 60 * 1000;

export interface OfferView extends Offer {
  items: (OfferItem & { name: string; defaultPriceEur: number })[];
  taken: number;
  sold: number;
  state: OfferState;
  left: number | null;
}

function itemsWithNames(items: OfferItem[]): OfferView["items"] {
  if (items.length === 0) return [];
  const rows = db
    .select({ id: therapies.id, name: therapies.name, price: therapies.defaultPriceEur })
    .from(therapies)
    .where(inArray(therapies.id, items.map((i) => i.therapyId)))
    .all();
  return items.map((i) => {
    const t = rows.find((r) => r.id === i.therapyId);
    return { ...i, name: t?.name ?? "Service", defaultPriceEur: t?.price ?? 0 };
  });
}

/** Paid orders, plus checkouts opened in the last HOLD_MS that haven't finished. */
export function takenCount(offerId: number, now = Date.now()): { taken: number; sold: number } {
  const r = db
    .select({
      sold: sql<number>`sum(case when ${offerOrders.status} = 'paid' then 1 else 0 end)`,
      held: sql<number>`sum(case when ${offerOrders.status} = 'pending' and ${offerOrders.createdAt} > ${now - HOLD_MS} then 1 else 0 end)`,
    })
    .from(offerOrders)
    .where(eq(offerOrders.offerId, offerId))
    .get();
  const sold = Number(r?.sold ?? 0);
  return { sold, taken: sold + Number(r?.held ?? 0) };
}

function toView(o: Offer, now: number): OfferView {
  const { taken, sold } = takenCount(o.id, now);
  return { ...o, items: itemsWithNames(parseItems(o.itemsJson)), taken, sold, state: offerState(o, taken, now), left: remaining(o.quantityLimit, taken) };
}

export function getOffer(id: number, now = Date.now()): OfferView | null {
  const o = db.select().from(offers).where(eq(offers.id, id)).get();
  return o ? toView(o, now) : null;
}

/** The campaign's offer (one per campaign; the newest if there were ever more). */
export function offerForCampaign(campaignId: number, now = Date.now()): OfferView | null {
  const o = db.select().from(offers).where(eq(offers.campaignId, campaignId)).orderBy(desc(offers.id)).get();
  return o ? toView(o, now) : null;
}

export function saveOffer(id: number | null, campaignId: number, input: OfferInput): number {
  const now = Date.now();
  const values = {
    campaignId,
    title: input.title,
    description: input.description,
    priceCents: input.priceCents,
    compareAtCents: input.compareAtCents,
    itemsJson: JSON.stringify(input.items),
    quantityLimit: input.quantityLimit,
    saleStartsAt: input.saleStartsAt,
    saleEndsAt: input.saleEndsAt,
    useByDate: input.useByDate,
    terms: input.terms,
    updatedAt: now,
  };
  if (id) {
    db.update(offers).set(values).where(and(eq(offers.id, id), eq(offers.campaignId, campaignId))).run();
    return id;
  }
  const [row] = db.insert(offers).values({ ...values, isActive: false, createdAt: now }).returning({ id: offers.id }).all();
  return row.id;
}

export function setOfferActive(id: number, active: boolean): void {
  db.update(offers).set({ isActive: active, updatedAt: Date.now() }).where(eq(offers.id, id)).run();
}

export function listOrders(offerId: number): OfferOrder[] {
  return db
    .select()
    .from(offerOrders)
    .where(and(eq(offerOrders.offerId, offerId), or(eq(offerOrders.status, "paid"), eq(offerOrders.status, "refunded"))))
    .orderBy(desc(offerOrders.createdAt))
    .all();
}

export function getOrder(id: number): OfferOrder | null {
  return db.select().from(offerOrders).where(eq(offerOrders.id, id)).get() ?? null;
}

export function orderForSession(sessionId: string): OfferOrder | null {
  return db.select().from(offerOrders).where(eq(offerOrders.stripeSessionId, sessionId)).get() ?? null;
}

export function orderForPaymentIntent(pi: string): OfferOrder | null {
  return db.select().from(offerOrders).where(eq(offerOrders.paymentIntentId, pi)).get() ?? null;
}

export function createPendingOrder(o: Offer, accountId: string): OfferOrder {
  const [row] = db
    .insert(offerOrders)
    .values({ offerId: o.id, stripeAccountId: accountId, amountCents: o.priceCents, currency: o.currency, status: "pending", createdAt: Date.now() })
    .returning()
    .all();
  return row;
}

export function setOrderSession(orderId: number, sessionId: string): void {
  db.update(offerOrders).set({ stripeSessionId: sessionId }).where(eq(offerOrders.id, orderId)).run();
}

export function setOrderStatus(orderId: number, status: OfferOrder["status"], onlyFrom?: OfferOrder["status"][]): boolean {
  const where = onlyFrom ? and(eq(offerOrders.id, orderId), inArray(offerOrders.status, onlyFrom)) : eq(offerOrders.id, orderId);
  const patch: Partial<OfferOrder> = { status };
  if (status === "refunded") patch.refundedAt = Date.now();
  return db.update(offerOrders).set(patch).where(where).run().changes > 0;
}

/** Sales totals per offer for the campaign hub. */
export function offerTotals(offerId: number): { sold: number; revenueCents: number; refunded: number } {
  const r = db
    .select({
      sold: sql<number>`sum(case when ${offerOrders.status} = 'paid' then 1 else 0 end)`,
      revenue: sql<number>`sum(case when ${offerOrders.status} = 'paid' then ${offerOrders.amountCents} else 0 end)`,
      refunded: sql<number>`sum(case when ${offerOrders.status} = 'refunded' then 1 else 0 end)`,
    })
    .from(offerOrders)
    .where(and(eq(offerOrders.offerId, offerId), gt(offerOrders.id, 0)))
    .get();
  return { sold: Number(r?.sold ?? 0), revenueCents: Number(r?.revenue ?? 0), refunded: Number(r?.refunded ?? 0) };
}
