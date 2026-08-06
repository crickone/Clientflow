"use server";

import { headers } from "next/headers";

import {
  completeClientReset,
  requestClientReset,
  type ResetResult,
} from "@/lib/clientPasswordReset";
import { rateLimit } from "@/lib/rateLimit";

/** Best-effort client IP from the proxy header (see lib/rateLimit clientIp). */
function requestIp(): string {
  const xff = headers().get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers().get("x-real-ip")?.trim() || "unknown";
}

/**
 * Forgot-password request. ALWAYS resolves to { ok: true } so the UI can't be
 * used to probe which emails have an account (no enumeration). Rate-limited per
 * IP and per email; when throttled we still return success and simply do nothing.
 */
export async function requestClientResetAction(email: string): Promise<{ ok: true }> {
  const normEmail = String(email ?? "").trim().toLowerCase();

  const perIp = rateLimit(`client-reset-ip:${requestIp()}`, 5, 10 * 60 * 1000);
  const perEmail = rateLimit(`client-reset-email:${normEmail}`, 3, 60 * 60 * 1000);
  if (!perIp.ok || !perEmail.ok) return { ok: true };

  await requestClientReset(normEmail);
  return { ok: true };
}

/** Set a new password from a reset/invite token. The token is the authority. */
export async function completeClientResetAction(
  token: string,
  password: string,
): Promise<ResetResult> {
  return completeClientReset(String(token ?? ""), String(password ?? ""));
}
