import "server-only";
import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { runWithTenant } from "@/lib/db/tenant";
import { clients, leads, offerOrders, packages, payments } from "@/lib/db/schema";
import { getCampaign } from "@/lib/campaigns/store";
import { upsertLead } from "@/lib/leads";
import { pipelineForCampaign } from "@/lib/pipeline/pipelineRepo";
import { onPaymentRecorded } from "@/lib/pipeline/stage";
import { splitFullName } from "@/lib/humanName";
import { logActivity } from "@/lib/queries";
import { renderEmailShell, sendEmailForTenant, textToParagraphs } from "@/lib/email";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getThemeForTenant } from "@/lib/settings";
import type { CheckoutSession } from "@/lib/stripe/api";
import { formatEur, splitPrice } from "./model";
import { getOffer, getOrder, orderForPaymentIntent, orderForSession, setOrderStatus } from "./store";

/**
 * A paid Stripe Checkout becomes, in the business's own records:
 *  - the client (found by email, else created),
 *  - one session bundle (packages row) per service in the offer, used by the
 *    offer's use-by date, with what was paid split across them,
 *  - one card payment for the order (so revenue reports and the pipeline see it),
 *  - a lead on the campaign's board, linked to the client and moved to won,
 *  - a confirmation email to the buyer.
 *
 * Reached from the Stripe webhook AND from the buyer's return to the landing
 * page (whichever is first). The order row is claimed with one conditional
 * UPDATE (pending -> paid) before anything is written, so the two can never
 * both fulfil the same purchase.
 */
export async function fulfilCheckout(
  tenantId: number,
  accountId: string,
  session: CheckoutSession,
): Promise<{ status: "fulfilled" | "already" | "unpaid" | "not_found" | "mismatch"; orderId?: number }> {
  return runWithTenant(tenantId, async () => {
    const order = orderForSession(session.id) ?? (session.client_reference_id ? getOrder(Number(session.client_reference_id)) : null);
    if (!order || order.stripeAccountId !== accountId) return { status: "not_found" as const };
    if (order.status === "paid" || order.status === "refunded") return { status: "already" as const, orderId: order.id };
    if (session.payment_status !== "paid") return { status: "unpaid" as const, orderId: order.id };
    if (session.amount_total !== order.amountCents || (session.currency ?? "").toLowerCase() !== order.currency) {
      console.error(`[offers] amount mismatch on order ${order.id}: paid ${session.amount_total} ${session.currency}, expected ${order.amountCents} ${order.currency}`);
      return { status: "mismatch" as const, orderId: order.id };
    }
    // Claim it. Only one caller gets changes === 1.
    const claimed = db
      .update(offerOrders)
      .set({ status: "paid", paidAt: Date.now(), stripeSessionId: session.id, paymentIntentId: session.payment_intent ?? null })
      .where(sql`${offerOrders.id} = ${order.id} and ${offerOrders.status} in ('pending', 'expired', 'failed')`)
      .run().changes;
    if (claimed !== 1) return { status: "already" as const, orderId: order.id };

    const offer = getOffer(order.offerId);
    const details = session.customer_details ?? {};
    const email = (details.email ?? "").trim().toLowerCase() || null;
    const fullName = (details.name ?? "").trim();
    const phone = (details.phone ?? "").trim();
    const { firstName, lastName } = splitFullName(fullName);

    let client = email
      ? db.select().from(clients).where(sql`lower(${clients.email}) = ${email}`).get()
      : undefined;
    if (!client) {
      [client] = db
        .insert(clients)
        .values({ firstName: firstName || "Online", lastName: lastName || "buyer", email, phone })
        .returning()
        .all();
    } else if (!client.phone && phone) {
      db.update(clients).set({ phone, updatedAt: new Date() }).where(eq(clients.id, client.id)).run();
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Dublin" });
    const packageIds: number[] = [];
    if (offer) {
      const shares = splitPrice(order.amountCents, offer.items.map((i) => i.defaultPriceEur * i.sessions));
      offer.items.forEach((item, idx) => {
        const [pkg] = db
          .insert(packages)
          .values({
            clientId: client!.id,
            therapyId: item.therapyId,
            packageName: `${offer.title}: ${item.sessions} x ${item.name}`,
            totalSessions: item.sessions,
            pricePaidEur: shares[idx] / 100,
            purchaseDate: today,
            expiryDate: offer.useByDate,
            notes: `Bought online (Stripe ${session.payment_intent ?? session.id}).`,
          })
          .returning({ id: packages.id })
          .all();
        packageIds.push(pkg.id);
      });
    }
    // One payment for the order: the pipeline counts payments (one = won,
    // two = repeat customer), and one purchase is one payment. The per-bundle
    // split lives on each bundle's price_paid_eur.
    db.insert(payments)
      .values({
        clientId: client.id,
        packageId: packageIds[0] ?? null,
        amountEur: order.amountCents / 100,
        paymentMethod: "card",
        notes: `Online: ${offer?.title ?? "offer"} (Stripe ${session.payment_intent ?? session.id})`,
      })
      .run();

    db.update(offerOrders)
      .set({ clientId: client.id, email, name: fullName || null, phone: phone || null, packageIdsJson: JSON.stringify(packageIds) })
      .where(eq(offerOrders.id, order.id))
      .run();

    // The campaign's board: a lead for the buyer, linked to the client, so
    // the payment just recorded moves it to won.
    const campaign = offer?.campaignId ? getCampaign(offer.campaignId) : null;
    try {
      const { lead } = upsertLead({
        source: "offer",
        sourceLeadId: `offer:${order.id}`,
        campaign: campaign?.name ?? offer?.title ?? "Online offer",
        pipelineId: campaign ? pipelineForCampaign(campaign.id)?.id ?? null : null,
        fullName: fullName || null,
        email,
        phone: phone || null,
        notes: `Bought ${offer?.title ?? "an offer"} online for ${formatEur(order.amountCents)}.`,
      });
      db.update(leads).set({ clientId: client.id }).where(eq(leads.id, lead.id)).run();
      onPaymentRecorded(client.id);
    } catch (err) {
      console.error("[offers] lead update failed", err);
    }
    await logActivity("offer_sale", `${fullName || email || "Someone"} bought ${offer?.title ?? "an offer"} online (${formatEur(order.amountCents)})`, { orderId: order.id, clientId: client.id });

    if (email && offer) {
      void sendConfirmation(tenantId, email, firstName || fullName || "", offer.title, offer.items, offer.useByDate, order.amountCents).catch((err) =>
        console.error("[offers] confirmation email failed", err),
      );
    }
    return { status: "fulfilled" as const, orderId: order.id };
  });
}

/** Stripe refunded the payment: the order is refunded and its bundles stop being usable. */
export function refundOrder(tenantId: number, paymentIntentId: string): boolean {
  return runWithTenant(tenantId, () => {
    const order = orderForPaymentIntent(paymentIntentId);
    if (!order || order.status !== "paid") return false;
    setOrderStatus(order.id, "refunded", ["paid"]);
    const ids: number[] = JSON.parse(order.packageIdsJson ?? "[]");
    for (const id of ids) db.update(packages).set({ isActive: false }).where(eq(packages.id, id)).run();
    void logActivity("offer_refund", `Online order #${order.id} was refunded in Stripe; its session bundles were switched off.`, { orderId: order.id });
    return true;
  });
}

export function expireOrder(tenantId: number, sessionId: string): void {
  runWithTenant(tenantId, () => {
    const order = orderForSession(sessionId);
    if (order) setOrderStatus(order.id, "expired", ["pending"]);
  });
}

async function sendConfirmation(
  tenantId: number,
  to: string,
  firstName: string,
  title: string,
  items: { sessions: number; name: string }[],
  useByDate: string,
  amountCents: number,
) {
  const business = getBusinessProfileForTenant(tenantId);
  const accent = getThemeForTenant(tenantId).accent;
  const useBy = new Date(`${useByDate}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const list = items.map((i) => `<li style="margin:0 0 4px;">${i.sessions} x ${escapeHtml(i.name)}</li>`).join("");
  const contact = [business.phone && `call ${escapeHtml(business.phone)}`, business.email && `email ${escapeHtml(business.email)}`].filter(Boolean).join(" or ");
  const bodyHtml = `
    ${textToParagraphs(`${firstName ? `Hi ${firstName}, thanks` : "Thanks"} for buying ${title}. You paid ${formatEur(amountCents)}.`)}
    <p style="margin:0 0 6px;font-weight:600;">What's included</p>
    <ul style="margin:0 0 16px;padding-left:18px;">${list}</ul>
    ${textToParagraphs(`Use your sessions by ${useBy}.${contact ? ` To book, ${contact}.` : ""}`)}`;
  const html = renderEmailShell({ businessName: business.businessName, accent, heading: "Your purchase", bodyHtml, footer: `Sent by ${business.businessName}.` });
  return sendEmailForTenant(tenantId, { to, subject: `Your ${title}`, html });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
