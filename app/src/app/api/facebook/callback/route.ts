import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { exchangeCode } from "@/lib/facebook/oauth";
import { discoverAssets, saveGrant, saveAdAccounts } from "@/lib/facebook/grants";
import { saveConnectedPages } from "@/lib/facebook/pages";
import { getAppBaseUrl } from "@/lib/appUrl";

export const dynamic = "force-dynamic";

// External forwarded host — req.url is the internal 0.0.0.0:8080 behind Railway.
function back(params: string) {
  return NextResponse.redirect(new URL(`/settings/integrations/facebook?${params}`, getAppBaseUrl()));
}

/**
 * Facebook OAuth callback — mirrors api/google/callback. Validate state, swap the
 * code for the tenant's grant token, store it with the Pages and ad accounts it
 * was granted, subscribe the Pages to our webhook, redirect back.
 */
export async function GET(req: NextRequest) {
  const me = await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return NextResponse.redirect(new URL("/select-account", getAppBaseUrl()));

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return back(`error=${encodeURIComponent(error)}`);

  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const cookieNonce = req.cookies.get("fb_oauth_state")?.value;
  if (!code || !stateRaw || !cookieNonce) return back("error=missing_state");

  let state: { t: number; n: string };
  try {
    state = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
  } catch {
    return back("error=bad_state");
  }
  if (state.n !== cookieNonce || state.t !== membership.tenant.id) return back("error=state_mismatch");

  try {
    const tenantId = membership.tenant.id;
    const grant = await exchangeCode(code);
    const assets = await discoverAssets(grant.token);
    saveGrant(tenantId, grant.token, grant.kind, grant.expiresAt, me.id);
    saveAdAccounts(tenantId, assets.adAccounts);
    const names = await saveConnectedPages(tenantId, assets.pages, me.id);
    if (names.length === 0) return back("error=no_pages");
    const res = back(`connected=${encodeURIComponent(String(names.length))}`);
    res.cookies.delete("fb_oauth_state");
    return res;
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : "connect_failed")}`);
  }
}
