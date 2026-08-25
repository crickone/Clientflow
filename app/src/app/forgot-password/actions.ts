"use server";

import { headers } from "next/headers";

import { requestUserReset } from "@/lib/userPasswordReset";
import { rateLimit } from "@/lib/rateLimit";

/** Best-effort client IP from the proxy header (see lib/rateLimit clientIp — a
 *  server action has no Request object, so this reads the header directly,
 *  same as app/app/reset/actions.ts's requestIp). */
function requestIp(): string {
  const xff = headers().get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers().get("x-real-ip")?.trim() || "unknown";
}

/**
 * Staff forgot-password request. ALWAYS resolves to { ok: true } so the UI
 * can't be used to probe which emails have an account (no enumeration).
 * Rate-limited per IP and per email; when throttled we still return success
 * and simply do nothing — same posture as the client-app equivalent
 * (app/app/reset/actions.ts's requestClientResetAction).
 */
export async function requestPasswordResetAction(email: string): Promise<{ ok: true }> {
  const normEmail = String(email ?? "").trim().toLowerCase();

  const perIp = rateLimit(`staff-reset-ip:${requestIp()}`, 5, 10 * 60 * 1000);
  const perEmail = rateLimit(`staff-reset-email:${normEmail}`, 3, 60 * 60 * 1000);
  if (!perIp.ok || !perEmail.ok) return { ok: true };

  await requestUserReset(normEmail);
  return { ok: true };
}
