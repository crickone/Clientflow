import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { exchangeCode } from "@/lib/google/oauth";
import { fetchGmailProfile, saveGmailConnection } from "@/lib/gmail";
import { fetchGoogleEmail, saveGoogleBusinessConnection } from "@/lib/google/business";
import { getAppBaseUrl } from "@/lib/appUrl";

export const dynamic = "force-dynamic";

// External host (forwarded) — req.url is the internal 0.0.0.0:8080 behind Railway.
function back(params: string) {
  return NextResponse.redirect(new URL(`/settings/email?${params}`, getAppBaseUrl()));
}

/** OAuth callback: validate state, exchange the code, store the connection. */
export async function GET(req: NextRequest) {
  const me = await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return NextResponse.redirect(new URL("/select-account", getAppBaseUrl()));

  const url = new URL(req.url);
  const error = url.searchParams.get("error");
  if (error) return back(`error=${encodeURIComponent(error)}`);

  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");
  const cookieNonce = req.cookies.get("g_oauth_state")?.value;
  if (!code || !stateRaw || !cookieNonce) return back("error=missing_state");

  // `p: "business"` marks the Google Business sign-in, which shares this
  // callback so no second redirect address has to be registered with Google.
  let state: { t: number; n: string; p?: string };
  try {
    state = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf8"));
  } catch {
    return back("error=bad_state");
  }
  if (state.n !== cookieNonce || state.t !== membership.tenant.id) {
    return back("error=state_mismatch");
  }

  if (state.p === "business") {
    const toSettings = (params: string) => {
      const r = NextResponse.redirect(new URL(`/settings/integrations/google?${params}`, getAppBaseUrl()));
      r.cookies.delete("g_oauth_state");
      return r;
    };
    try {
      const tokens = await exchangeCode(code);
      if (!tokens.refresh_token) return toSettings("error=no_refresh_token");
      const email = await fetchGoogleEmail(tokens.access_token);
      saveGoogleBusinessConnection({
        tenantId: membership.tenant.id,
        email: email || "Google account",
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        expiresIn: tokens.expires_in,
        scope: tokens.scope,
        connectedByUserId: me.id,
      });
      return toSettings("connected=1");
    } catch (err) {
      return toSettings(`error=${encodeURIComponent(err instanceof Error ? err.message : "exchange_failed")}`);
    }
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.refresh_token) {
      // No refresh token — usually a re-consent without prompt=consent. Ask again.
      return back("error=no_refresh_token");
    }
    const profile = await fetchGmailProfile(tokens.access_token);
    saveGmailConnection({
      tenantId: membership.tenant.id,
      email: profile.emailAddress,
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
      connectedByUserId: me.id,
    });
    const res = back(`connected=${encodeURIComponent(profile.emailAddress)}`);
    res.cookies.delete("g_oauth_state");
    return res;
  } catch (err) {
    return back(`error=${encodeURIComponent(err instanceof Error ? err.message : "exchange_failed")}`);
  }
}
