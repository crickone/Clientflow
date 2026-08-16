import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import { requireAdmin, getCurrentMembership } from "@/lib/auth";
import { buildAuthUrl, facebookConfigured } from "@/lib/facebook/oauth";
import { getAppBaseUrl } from "@/lib/appUrl";

export const dynamic = "force-dynamic";

/**
 * Kick off the Facebook OAuth flow for the admin's current tenant — mirrors
 * api/google/connect. Stores a nonce in an httpOnly cookie and embeds
 * (tenantId, nonce) in the OAuth `state` for CSRF.
 */
export async function GET(_req: NextRequest) {
  const base = getAppBaseUrl(); // external forwarded host — req.url is internal behind Railway
  await requireAdmin();
  const membership = getCurrentMembership();
  if (!membership) return NextResponse.redirect(new URL("/select-account", base));
  if (!facebookConfigured()) {
    return NextResponse.redirect(new URL("/settings/integrations/facebook?error=not_configured", base));
  }

  const nonce = crypto.randomBytes(16).toString("hex");
  const state = Buffer.from(JSON.stringify({ t: membership.tenant.id, n: nonce })).toString("base64url");

  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set("fb_oauth_state", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
