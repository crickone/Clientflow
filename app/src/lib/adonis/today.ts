import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { offerOrders, voucherOrders } from "@/lib/db/schema";
import { listConversations } from "@/lib/conversations";
import { getStripeConnection } from "@/lib/stripe/connection";
import { countInbox, weekStartDublin, type TodayCounts } from "./todayModel";

/**
 * The three numbers on the /adonis opening screen, for the CURRENT tenant
 * (ambient db). Sales count paid offer orders and paid voucher orders since
 * Monday 00:00 Irish time, on the Stripe account connected now, so test-mode
 * sales on an old account are not counted. A business with no Stripe
 * connection has no sales.
 */
export function getTodayCounts(o: { tenantId: number; withSales: boolean; now?: number }): TodayCounts {
  const inbox = countInbox(listConversations());
  if (!o.withSales) return { ...inbox, salesCents: null, salesCount: null };
  const conn = getStripeConnection(o.tenantId);
  if (!conn) return { ...inbox, salesCents: 0, salesCount: 0 };
  const since = weekStartDublin(o.now ?? Date.now());
  const offers = db
    .select({ n: sql<number>`count(*)`, cents: sql<number>`coalesce(sum(${offerOrders.amountCents}), 0)` })
    .from(offerOrders)
    .where(
      sql`${offerOrders.status} = 'paid' and ${offerOrders.stripeAccountId} = ${conn.accountId} and coalesce(${offerOrders.paidAt}, ${offerOrders.createdAt}) >= ${since}`,
    )
    .get();
  const vouchers = db
    .select({ n: sql<number>`count(*)`, cents: sql<number>`coalesce(sum(${voucherOrders.valueCents}), 0)` })
    .from(voucherOrders)
    .where(
      sql`${voucherOrders.status} = 'paid' and ${voucherOrders.stripeAccountId} = ${conn.accountId} and coalesce(${voucherOrders.paidAt}, ${voucherOrders.createdAt}) >= ${since}`,
    )
    .get();
  return {
    ...inbox,
    salesCents: Number(offers?.cents ?? 0) + Number(vouchers?.cents ?? 0),
    salesCount: Number(offers?.n ?? 0) + Number(vouchers?.n ?? 0),
  };
}
