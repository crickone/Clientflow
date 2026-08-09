import { NextResponse, type NextRequest } from "next/server";

import { createClientSession, loginClient } from "@/lib/clientAuth";
import { rateLimit, resetRateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Brute-force / credential-stuffing throttle, per client IP — mirrors the
// coach/platform login's throttle (api/auth/login/route.ts). A distinct key
// prefix keeps this bucket separate from the coach-login one so traffic on
// one login surface never eats into the other's allowance for the same IP
// (e.g. a shared gym/office network hitting both forms).
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000;

export async function POST(req: NextRequest) {
  const rlKey = `client-login:${clientIp(req)}`;
  const rl = rateLimit(rlKey, MAX_ATTEMPTS, WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }
  const email = (body.email ?? "").trim();
  const password = body.password ?? "";
  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "Email and password are required." }, { status: 400 });
  }
  const info = loginClient(email, password);
  if (!info) {
    return NextResponse.json({ ok: false, error: "Incorrect email or password." }, { status: 401 });
  }
  await createClientSession(info);
  // Successful login — clear this IP's attempt counter so earlier mistyped
  // passwords don't count against a now-authenticated user.
  resetRateLimit(rlKey);
  return NextResponse.json({ ok: true });
}
