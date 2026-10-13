import { NextResponse, type NextRequest } from "next/server";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { getAppBaseUrl } from "@/lib/appUrl";
import { logActivity } from "@/lib/queries";
import { exchangeOAuthCode, getAccount } from "@/lib/stripe/api";
import { readConnectState, saveStripeConnection } from "@/lib/stripe/connection";

export const dynamic = "force-dynamic";

function back(params: string) {
  return NextResponse.redirect(new URL(`/settings/integrations/stripe?${params}`, getAppBaseUrl()));
}

/**
 * Stripe sends the admin back here after they approve (or cancel). The
 * signed state must name the business and admin who are signed in now, so a
 * stray or forged link can't attach an account to anyone else.
 */
export async function GET(req: NextRequest) {
  const me = await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return NextResponse.redirect(new URL("/select-account", getAppBaseUrl()));

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return back(error === "access_denied" ? "error=cancelled" : `error=${encodeURIComponent(error)}`);

  const state = readConnectState(url.searchParams.get("state") ?? "");
  if (!state || state.tenantId !== membership.tenant.id || state.userId !== me.id) return back("error=state_mismatch");

  const code = url.searchParams.get("code");
  if (!code) return back("error=missing_code");
  const token = await exchangeOAuthCode(code);
  if (!token.ok) return back(`error=${encodeURIComponent(token.error)}`);

  const account = await getAccount(token.data.stripe_user_id);
  saveStripeConnection(membership.tenant.id, token.data.stripe_user_id, token.data.livemode === true, account.ok ? account.data : null);
  await logActivity("stripe_connected", `Stripe account connected by ${me.email}`, { accountId: token.data.stripe_user_id });
  return back("connected=1");
}
