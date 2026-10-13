import { NextResponse, type NextRequest } from "next/server";

import { verifyCheckoutToken } from "@/lib/offers/checkoutToken";
import { startCheckout } from "@/lib/offers/checkout";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Public: the landing page's Buy button. The signed token (minted by the page)
 * names the business, campaign, offer and return address; the body carries
 * nothing else that matters. Answers with the Stripe Checkout URL to go to.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`offer-checkout:${clientIp(req)}`, 20, 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many tries. Please wait a minute." }, { status: 429 });
  let body: { token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const claim = verifyCheckoutToken(String(body.token ?? ""));
  if (!claim) return NextResponse.json({ ok: false, error: "This page is out of date. Please refresh and try again." }, { status: 400 });
  const r = await startCheckout(claim);
  if (!r.ok) return NextResponse.json(r, { status: 409 });
  return NextResponse.json(r);
}
