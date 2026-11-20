import { NextResponse } from "next/server";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { getAppBaseUrl } from "@/lib/appUrl";
import { logActivity } from "@/lib/queries";
import { accountCreateParams, createAccountLink, createConnectedAccount, stripeKeyMode } from "@/lib/stripe/api";
import { getStripeConnection, saveStripeConnection } from "@/lib/stripe/connection";

export const dynamic = "force-dynamic";

function back(params: string) {
  return NextResponse.redirect(new URL(`/settings/integrations/stripe?${params}`, getAppBaseUrl()));
}

/** Ten-minute window: a double click, or a retry soon after, gets the same account back from Stripe. */
const CREATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * "Connect with Stripe" and "Continue in Stripe": make the business's Stripe
 * account the first time, then send the admin to Stripe's own onboarding for
 * it. Stripe also sends people back here when an onboarding link has expired
 * (the link's refresh_url), and this simply makes a fresh one.
 */
export async function GET() {
  const me = await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return NextResponse.redirect(new URL("/select-account", getAppBaseUrl()));
  const mode = stripeKeyMode();
  if (!mode) return back("error=not_configured");
  const tenantId = membership.tenant.id;
  const base = getAppBaseUrl();

  let accountId = getStripeConnection(tenantId)?.accountId ?? null;
  if (!accountId) {
    const made = await createConnectedAccount(
      accountCreateParams({ email: me.email ?? null, businessName: membership.tenant.name ?? null, tenantId }),
      `connect-${mode}-t${tenantId}-${Math.floor(Date.now() / CREATE_WINDOW_MS)}`,
    );
    if (!made.ok) return back(`error=${encodeURIComponent(made.error)}`);
    saveStripeConnection(tenantId, made.data.id, mode === "live", made.data);
    await logActivity("stripe_connected", `Stripe account created by ${me.email}`, { accountId: made.data.id });
    accountId = made.data.id;
  }

  const link = await createAccountLink(accountId, `${base}/api/stripe/connect`, `${base}/api/stripe/return`);
  if (!link.ok) return back(`error=${encodeURIComponent(link.error)}`);
  return NextResponse.redirect(link.data.url);
}
