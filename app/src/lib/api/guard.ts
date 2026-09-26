import "server-only";

import { NextResponse } from "next/server";

import { requireUser, requireAdmin, requirePlatformAdmin } from "@/lib/auth";
import { tenantStampMismatch } from "./tenantStamp";

export type AuthLevel = "user" | "admin" | "platform";

/**
 * One-line auth gate for API route handlers. Call at the very top of a handler:
 *
 *   export async function GET() {
 *     const denied = await guard("user");
 *     if (denied) return denied;
 *     …
 *   }
 *
 * Returns a 401/403 JSON Response when the caller isn't authorized, or `null`
 * when they are (so the handler proceeds). This is the request-scoped session
 * check the edge middleware defers to — the middleware only confirms a cookie is
 * present; validity is enforced here against a live membership (see lib/auth).
 * Without this, a handler that touches `db` resolves to the default tenant for
 * an unresolved/forged cookie, exposing live tenant data.
 *
 * It also enforces that the caller is acting on the clinic it THINKS it is.
 * Authentication answers "may you touch a tenant"; it cannot answer "which one
 * did you mean", and with the active tenant living on the shared session row a
 * tab left open on clinic A starts writing to clinic B the moment another tab
 * switches. `tenantStampMismatch` refuses that with a 409 — see ./tenantStamp
 * for the full account. It runs AFTER the auth check so an unauthenticated
 * caller still gets 401, and it is a no-op for any request with no stamp
 * (webhooks, cron, the client mobile app).
 */
export async function guard(level: AuthLevel = "user"): Promise<Response | null> {
  try {
    if (level === "platform") await requirePlatformAdmin();
    else if (level === "admin") await requireAdmin();
    else await requireUser();
    return tenantStampMismatch();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "FORBIDDEN") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    if (msg === "TENANT_SUSPENDED") {
      // Billing not active for this tenant (suspended / awaiting first
      // payment) — authenticated but blocked until it's resolved.
      return NextResponse.json(
        { ok: false, error: "Billing is not active for this account." },
        { status: 402 },
      );
    }
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
}
