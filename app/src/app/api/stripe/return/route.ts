import { NextResponse } from "next/server";

import { getCurrentMembership, requireAdmin } from "@/lib/auth";
import { getAppBaseUrl } from "@/lib/appUrl";
import { getAccount } from "@/lib/stripe/api";
import { getStripeConnection, updateStripeAccountStatus } from "@/lib/stripe/connection";

export const dynamic = "force-dynamic";

function back(params: string) {
  return NextResponse.redirect(new URL(`/settings/integrations/stripe?${params}`, getAppBaseUrl()));
}

/**
 * Stripe sends the admin back here when they leave onboarding, finished or
 * not, however long they took. It only re-reads the signed-in business's own
 * account from Stripe, so it needs no token. The account.updated webhook
 * keeps the status current after that (Stripe's checks can take a while).
 */
export async function GET() {
  await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return NextResponse.redirect(new URL("/select-account", getAppBaseUrl()));

  const conn = getStripeConnection(membership.tenant.id);
  if (!conn) return back("error=not_connected");
  const account = await getAccount(conn.accountId);
  if (!account.ok) return back(`error=${encodeURIComponent(account.error)}`);
  updateStripeAccountStatus(membership.tenant.id, account.data);
  return back(account.data.details_submitted ? "connected=1" : "unfinished=1");
}
