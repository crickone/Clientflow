import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { buildAuthUrl, googleConfigured } from "@/lib/google/oauth";
import { getAppBaseUrl } from "@/lib/appUrl";

export const dynamic = "force-dynamic";

/**
 * Kick off the Gmail OAuth flow for the admin's current tenant. Stores a nonce in
 * an httpOnly cookie and embeds (tenantId, nonce) in the OAuth `state` for CSRF.
 */
export async function GET(_req: NextRequest) {
  // Build redirects off the EXTERNAL host (forwarded), not req.url — behind the
  // Railway proxy req.url is the internal 0.0.0.0:8080 and would break browsers.
  const base = getAppBaseUrl();
  await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) {
    return NextResponse.redirect(new URL("/select-account", base));
  }
  if (!googleConfigured()) {
    return NextResponse.redirect(
      new URL("/settings/email?error=google_not_configured", base),
    );
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = Buffer.from(
    JSON.stringify({ t: membership.tenant.id, n: nonce }),
  ).toString("base64url");

  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set("g_oauth_state", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
