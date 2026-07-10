import "server-only";

import { NextResponse } from "next/server";

import { requireUser, requireAdmin, requirePlatformAdmin } from "@/lib/auth";

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
 */
export async function guard(level: AuthLevel = "user"): Promise<Response | null> {
  try {
    if (level === "platform") await requirePlatformAdmin();
    else if (level === "admin") await requireAdmin();
    else await requireUser();
    return null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "FORBIDDEN") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
}
