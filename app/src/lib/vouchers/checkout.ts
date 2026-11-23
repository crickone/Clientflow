import "server-only";

import { runWithTenant } from "@/lib/db/tenant";
import { createCheckoutSession } from "@/lib/stripe/api";
import { canTakePayments, getStripeConnection } from "@/lib/stripe/connection";
import {
  colourways,
  dublinDate,
  expiryDate,
  findColourway,
  formatEuro,
  formatLongDate,
  validateOrder,
  type OrderDraft,
  type OrderDraftField,
} from "./model";
import {
  brandPaletteForTenant,
  createPendingVoucherOrder,
  getStoreSettings,
  setVoucherOrderSession,
  setVoucherOrderStatus,
  storeFlagOn,
  storeTreatments,
} from "./store";
import type { VoucherStoreClaim } from "./storeToken";

export type CheckoutStart = { ok: true; url: string } | { ok: false; error: string; field?: OrderDraftField };

/**
 * Open Stripe Checkout for one voucher on the business's own connected
 * account. A pending order is written first; the webhook or the buyer's
 * return turns it into a voucher (fulfil.ts). No application fee: the
 * business keeps everything except Stripe's own fee.
 */
export async function startVoucherCheckout(claim: VoucherStoreClaim, draft: OrderDraft, now = Date.now()): Promise<CheckoutStart> {
  const conn = getStripeConnection(claim.tenantId);
  if (!conn || !canTakePayments(conn)) return { ok: false, error: "This business isn't taking payments online yet." };
  if (!storeFlagOn(claim.tenantId)) return { ok: false, error: "Gift vouchers aren't on sale online yet." };

  return runWithTenant(claim.tenantId, async (): Promise<CheckoutStart> => {
    const settings = getStoreSettings();
    if (!settings.enabled) return { ok: false, error: "Gift vouchers aren't on sale online yet." };
    const palette = colourways(brandPaletteForTenant(claim.tenantId));
    const today = dublinDate(now);
    const check = validateOrder(draft, {
      settings,
      treatments: storeTreatments(settings.therapyIds),
      colourwayIds: palette.map((c) => c.id),
      today,
    });
    if (!check.ok) return { ok: false, error: check.error, field: check.field };
    const o = check.order;

    const order = createPendingVoucherOrder(o, {
      colourway: findColourway(palette, o.colourwayId)!,
      stripeAccountId: conn.accountId,
      siteId: claim.siteId,
      siteUrl: claim.siteUrl,
    });
    const what = o.kind === "treatment" ? `${o.therapyName}` : formatEuro(o.valueCents / 100);
    const meta = { kind: "voucher", tenant_id: String(claim.tenantId), voucher_order_id: String(order.id) };
    const r = await createCheckoutSession(
      conn.accountId,
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "eur",
              unit_amount: o.valueCents,
              product_data: {
                name: `Gift voucher: ${what}`,
                description: `For ${o.toName}, from ${o.fromName}. Valid until ${formatLongDate(expiryDate(today, settings.expiryYears))}.`,
              },
            },
          },
        ],
        customer_email: o.buyerEmail,
        success_url: `${claim.siteUrl}/vouchers?paid=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${claim.siteUrl}/vouchers`,
        client_reference_id: String(order.id),
        metadata: meta,
        payment_intent_data: { metadata: meta, description: `Gift voucher ${what}` },
        expires_at: Math.floor(now / 1000) + 31 * 60,
        locale: "auto",
      },
      `voucher-order-${claim.tenantId}-${order.id}`,
    );
    if (!r.ok || !r.data.url) {
      setVoucherOrderStatus(order.id, "failed");
      console.error("[vouchers] checkout failed", r.ok ? "no url" : r.error);
      return { ok: false, error: "Payments aren't working right now. Nothing was charged. Please try again shortly." };
    }
    setVoucherOrderSession(order.id, r.data.id);
    return { ok: true, url: r.data.url };
  });
}
