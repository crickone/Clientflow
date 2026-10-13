import { NextResponse, type NextRequest } from "next/server";

import { verifyStripeSignature } from "@/lib/stripe/encode";
import { tenantForStripeAccount, updateStripeAccountStatus, removeStripeConnection } from "@/lib/stripe/connection";
import type { CheckoutSession, StripeAccount } from "@/lib/stripe/api";
import { expireOrder, fulfilCheckout, refundOrder } from "@/lib/offers/fulfil";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 512 * 1024;

/**
 * Stripe Connect webhook: events from every connected business's account
 * arrive here, each naming its account. Public route (middleware allow-list);
 * the Stripe-Signature check against STRIPE_WEBHOOK_SECRET is what makes it
 * safe. Answers 200 for anything verified, even events we ignore, so Stripe
 * doesn't retry them; 400 only for a bad signature.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false, error: "Bad signature." }, { status: 400 });
  }
  let event: { type?: string; account?: string; data?: { object?: Record<string, unknown> } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const account = event.account ?? "";
  const tenantId = account ? tenantForStripeAccount(account) : null;
  const obj = event.data?.object ?? {};
  if (!tenantId) return NextResponse.json({ ok: true, ignored: "unknown account" });

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await fulfilCheckout(tenantId, account, obj as unknown as CheckoutSession);
        break;
      case "checkout.session.expired":
        expireOrder(tenantId, String(obj.id ?? ""));
        break;
      case "charge.refunded": {
        const pi = typeof obj.payment_intent === "string" ? obj.payment_intent : "";
        if (pi && obj.refunded === true) refundOrder(tenantId, pi);
        break;
      }
      case "account.updated":
        updateStripeAccountStatus(tenantId, obj as unknown as StripeAccount);
        break;
      case "account.application.deauthorized":
        removeStripeConnection(tenantId);
        break;
    }
  } catch (err) {
    // A 500 makes Stripe retry, which is what we want for a write that failed.
    console.error(`[stripe webhook] ${event.type} failed`, err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
