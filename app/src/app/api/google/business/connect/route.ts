import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { buildAuthUrl, googleConfigured } from "@/lib/google/oauth";
import { GOOGLE_BUSINESS_SCOPES } from "@/lib/google/businessApi";
import { getAppBaseUrl } from "@/lib/appUrl";

export const dynamic = "force-dynamic";

/**
 * Start the Google Business sign-in (Business Profile, Search Console,
 * Analytics) for the admin's current tenant. Same CSRF scheme as the inbox
 * sign-in; the shared callback routes on `p: "business"` in the state.
 */
export async function GET(_req: NextRequest) {
  const base = getAppBaseUrl();
  await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return NextResponse.redirect(new URL("/select-account", base));
  if (!googleConfigured()) return NextResponse.redirect(new URL("/settings/integrations/google?error=google_not_configured", base));

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = Buffer.from(JSON.stringify({ t: membership.tenant.id, n: nonce, p: "business" })).toString("base64url");
  const res = NextResponse.redirect(buildAuthUrl(state, GOOGLE_BUSINESS_SCOPES));
  res.cookies.set("g_oauth_state", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
