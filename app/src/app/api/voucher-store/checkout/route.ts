import { NextResponse, type NextRequest } from "next/server";

import { startVoucherCheckout } from "@/lib/vouchers/checkout";
import { parseOrderDraft } from "@/lib/vouchers/model";
import { verifyVoucherStoreToken } from "@/lib/vouchers/storeToken";
import { clientIp, rateLimit } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Public: the voucher store's Pay button. The signed token (minted by the
 * /vouchers page) names the business and its site; the body carries the
 * buyer's choices, which are checked again here. Answers with the Stripe
 * Checkout URL to go to, or the reason and the field it is about.
 */
export async function POST(req: NextRequest) {
  const rl = rateLimit(`voucher-checkout:${clientIp(req)}`, 20, 60 * 1000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: "Too many tries. Please wait a minute." }, { status: 429 });
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  if (typeof parsed !== "object" || parsed === null) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  const body = parsed as { token?: unknown; order?: unknown };
  const claim = verifyVoucherStoreToken(String(body.token ?? ""));
  if (!claim) return NextResponse.json({ ok: false, error: "This page is out of date. Please refresh and try again." }, { status: 400 });
  const r = await startVoucherCheckout(claim, parseOrderDraft(body.order));
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}
