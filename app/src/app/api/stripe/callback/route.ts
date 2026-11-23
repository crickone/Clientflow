import { NextResponse, type NextRequest } from "next/server";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { getAppBaseUrl } from "@/lib/appUrl";
import { logActivity } from "@/lib/queries";
import { exchangeOAuthCode, getAccount, stripeKeyMode } from "@/lib/stripe/api";
import { getStripeConnection, readConnectState, saveStripeConnection, tenantForStripeAccount } from "@/lib/stripe/connection";

export const dynamic = "force-dynamic";

function back(params: string) {
  return NextResponse.redirect(new URL(`/settings/integrations/stripe?${params}`, getAppBaseUrl()));
}

/**
 * Stripe sends the admin back here after they pick an existing account (or
 * cancel). The signed state must name the business and admin who are signed
 * in now, so a stray or forged link can't attach an account to anyone else.
 * The account replaces any account this business had, e.g. one made by
 * "Make a new Stripe account" and never finished; that one stays in Stripe.
 */
export async function GET(req: NextRequest) {
  const me = await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return NextResponse.redirect(new URL("/select-account", getAppBaseUrl()));
  const tenantId = membership.tenant.id;

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return back(error === "access_denied" ? "error=cancelled" : `error=${encodeURIComponent(url.searchParams.get("error_description") || error)}`);

  const state = readConnectState(url.searchParams.get("state") ?? "");
  if (!state || state.tenantId !== tenantId || state.userId !== me.id) return back("error=state_mismatch");

  const code = url.searchParams.get("code");
  if (!code) return back("error=missing_code");
  const token = await exchangeOAuthCode(code);
  if (!token.ok) return back(`error=${encodeURIComponent(token.error)}`);
  const accountId = token.data.stripe_user_id;

  if (token.data.livemode !== (stripeKeyMode() === "live")) return back("error=wrong_mode");
  const owner = tenantForStripeAccount(accountId);
  if (owner !== null && owner !== tenantId) return back("error=in_use");

  const previous = getStripeConnection(tenantId)?.accountId ?? null;
  const account = await getAccount(accountId);
  saveStripeConnection(tenantId, accountId, token.data.livemode, account.ok ? account.data : null);
  await logActivity(
    "stripe_connected",
    `Existing Stripe account connected by ${me.email}${previous && previous !== accountId ? ` (replaces ${previous})` : ""}`,
    { accountId, replaced: previous },
  );
  return back("connected=1");
}
