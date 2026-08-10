import { NextResponse, type NextRequest } from "next/server";

import { createSession } from "@/lib/auth";
import { consumeOpenToken } from "@/lib/platform/openToken";

export const dynamic = "force-dynamic";

/**
 * Public token-consuming endpoint for the platform "Open business" handoff
 * (console → app, different origins → no shared cookie).
 *
 * PUBLIC (see middleware.ts's PUBLIC_PATHS — pre-session, like /login) but
 * does nothing without a valid, unexpired, unused token: `consumeOpenToken`
 * is the ONLY source of truth for who's signing in — a query userId/tenantId
 * is never trusted (there isn't one). The token was minted by the guarded
 * platform mint endpoint (`POST /api/platform/tenants/:id/open`), which also
 * already granted this exact user a real admin membership in this exact
 * tenant — so by the time we get here, minting a normal session for
 * (userId, tenantId) is just the ordinary, already-a-member login path.
 *
 * Mints the session via the SAME helper the password login route uses
 * (`createSession` — session-mint + active-tenant + the `clientflow_session`
 * cookie) rather than hand-rolling a divergent auth path.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const claim = token ? consumeOpenToken(token) : null;

  if (!claim) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "?opened=expired";
    return NextResponse.redirect(url);
  }

  // Identical session-mint to a normal login: an auth_sessions row for this
  // user with this tenant already set as the active one, plus the same
  // httpOnly clientflow_session cookie. The membership already exists
  // (granted by the mint endpoint), so the app's ordinary tenant resolution
  // (getCurrentMembership) just works from here — no bypass, no special case.
  await createSession(claim.userId, claim.tenantId);

  const url = req.nextUrl.clone();
  url.pathname = "/dashboard";
  url.search = "";
  return NextResponse.redirect(url);
}
