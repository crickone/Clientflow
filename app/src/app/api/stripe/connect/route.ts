import { NextResponse } from "next/server";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { getAppBaseUrl } from "@/lib/appUrl";
import { oauthAuthorizeUrl } from "@/lib/stripe/api";
import { signConnectState } from "@/lib/stripe/connection";

export const dynamic = "force-dynamic";

function back(params: string) {
  return NextResponse.redirect(new URL(`/settings/integrations/stripe?${params}`, getAppBaseUrl()));
}

/** Start "Connect with Stripe": send the admin to Stripe to approve. */
export async function GET() {
  const me = await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return NextResponse.redirect(new URL("/select-account", getAppBaseUrl()));
  const state = signConnectState(membership.tenant.id, me.id);
  const url = state ? oauthAuthorizeUrl(state, `${getAppBaseUrl()}/api/stripe/callback`) : null;
  if (!url) return back("error=not_configured");
  return NextResponse.redirect(url);
}
