import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { authDb } from "@/lib/db/control";
import { memberships, users } from "@/lib/db/schema";
import { createSession, verifyPassword, hashPassword } from "@/lib/auth";
import { rateLimit, resetRateLimit, clientIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Brute-force / credential-stuffing throttle, per client IP.
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 5 * 60 * 1000;

// A valid-format hash to verify against when the email is unknown, so a bad
// email costs the same scrypt work as a bad password — closes the response-time
// oracle an attacker could use to enumerate which emails have accounts.
const DUMMY_HASH = hashPassword("login-timing-equalizer");

export async function POST(req: NextRequest) {
  const rlKey = `login:${clientIp(req)}`;
  const rl = rateLimit(rlKey, MAX_ATTEMPTS, WINDOW_MS);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const user = await authDb
    .select()
    .from(users)
    .where(eq(users.email, email))
    .get();

  if (!user || !user.isActive) {
    verifyPassword(parsed.data.password, DUMMY_HASH); // equalize timing
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  if (!verifyPassword(parsed.data.password, user.passwordHash)) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Multi-account identity: which clinic(s) does this identity belong to?
  const active = await authDb
    .select({ tenantId: memberships.tenantId })
    .from(memberships)
    .where(and(eq(memberships.userId, user.id), eq(memberships.isActive, true)))
    .all();

  if (active.length === 0) {
    return NextResponse.json(
      { error: "Your account isn't linked to any clinic. Contact an admin." },
      { status: 401 },
    );
  }

  // Exactly one clinic → activate it now and skip the selector. More than one →
  // leave the session unresolved and send the user to /select-account to choose.
  const activeTenantId = active.length === 1 ? active[0].tenantId : null;
  await createSession(user.id, activeTenantId);
  await authDb
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

  // Successful login — clear this IP's attempt counter so earlier mistyped
  // passwords don't count against a now-authenticated user.
  resetRateLimit(rlKey);

  const redirect = user.mustChangePassword
    ? "/change-password"
    : activeTenantId == null
      ? "/select-account"
      : "/dashboard";

  return NextResponse.json({
    ok: true,
    redirect,
    mustChangePassword: user.mustChangePassword,
  });
}
