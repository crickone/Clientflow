import "server-only";

import { runWithTenant } from "@/lib/db/tenant";
import { createCheckoutSession } from "@/lib/stripe/api";
import { getStripeConnection } from "@/lib/stripe/connection";
import { formatEur } from "./model";
import { createPendingOrder, getOffer, setOrderSession, setOrderStatus } from "./store";
import type { Arrival } from "@/lib/arrival";
import type { CheckoutClaim } from "./checkoutToken";

/**
 * Open a Stripe Checkout page for one offer, on the business's own connected
 * Stripe account. A pending order is written first so the last place can't
 * be sold twice while the buyer pays (see store.takenCount).
 */
export async function startCheckout(claim: CheckoutClaim, arrival: Arrival | null = null): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const conn = getStripeConnection(claim.tenantId);
  if (!conn) return { ok: false, error: "Online payments aren't set up for this business yet." };

  return runWithTenant(claim.tenantId, async () => {
    const offer = getOffer(claim.offerId);
    if (!offer || offer.campaignId !== claim.campaignId) return { ok: false as const, error: "This offer isn't available." };
    if (offer.state === "sold_out") return { ok: false as const, error: "Sorry, this offer has sold out." };
    if (offer.state === "ended") return { ok: false as const, error: "Sorry, this offer has ended." };
    if (offer.state !== "live") return { ok: false as const, error: "This offer isn't on sale yet." };

    const order = createPendingOrder(offer, conn.accountId, arrival);
    const includes = offer.items.map((i) => `${i.sessions} x ${i.name}`).join(", ");
    const useBy = new Date(`${offer.useByDate}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    const termsLine = [`Use by ${useBy}.`, offer.terms ?? ""].join(" ").trim().slice(0, 1000);
    const sep = claim.returnUrl.includes("?") ? "&" : "?";
    const meta = { tenant_id: String(claim.tenantId), offer_id: String(offer.id), order_id: String(order.id) };

    const r = await createCheckoutSession(
      conn.accountId,
      {
        mode: "payment",
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: offer.currency,
              unit_amount: offer.priceCents,
              product_data: { name: offer.title, description: (offer.description ? `${offer.description} ` : "") + `Includes ${includes}.` },
            },
          },
        ],
        success_url: `${claim.returnUrl}${sep}paid=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: claim.returnUrl,
        client_reference_id: String(order.id),
        metadata: meta,
        payment_intent_data: { metadata: meta, description: `${offer.title} (${formatEur(offer.priceCents)})` },
        phone_number_collection: { enabled: true },
        customer_creation: "always",
        custom_text: { submit: { message: termsLine } },
        expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
        locale: "auto",
      },
      `offer-order-${claim.tenantId}-${order.id}`,
    );
    if (!r.ok || !r.data.url) {
      setOrderStatus(order.id, "failed");
      console.error("[offers] checkout failed", r.ok ? "no url" : r.error);
      return { ok: false as const, error: "Payments aren't working right now. Please try again shortly." };
    }
    setOrderSession(order.id, r.data.id);
    return { ok: true as const, url: r.data.url };
  });
}
