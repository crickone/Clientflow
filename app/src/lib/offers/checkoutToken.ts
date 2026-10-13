import "server-only";

import { readTokenPayload, signTokenPayload } from "@/lib/signedToken";

/**
 * Signed by the landing page at render time, verified by the public checkout
 * route: which business, campaign and offer the Buy button is for, and the
 * page address Stripe sends the buyer back to. Nothing in the request body
 * can choose a tenant or a return address (same pattern as the campaign
 * signup token, lib/campaigns/signupToken.ts).
 */

export interface CheckoutClaim {
  tenantId: number;
  campaignId: number;
  offerId: number;
  returnUrl: string;
}

export function signCheckoutToken(c: CheckoutClaim): string | null {
  return signTokenPayload({ k: "offer-checkout", t: c.tenantId, c: c.campaignId, o: c.offerId, u: c.returnUrl });
}

export function verifyCheckoutToken(token: string): CheckoutClaim | null {
  const p = readTokenPayload(token);
  if (!p || p.k !== "offer-checkout") return null;
  const tenantId = Number(p.t);
  const campaignId = Number(p.c);
  const offerId = Number(p.o);
  const returnUrl = String(p.u ?? "");
  if (![tenantId, campaignId, offerId].every((n) => Number.isInteger(n) && n > 0)) return null;
  if (!/^https?:\/\/[^\s]+$/.test(returnUrl)) return null;
  return { tenantId, campaignId, offerId, returnUrl };
}
