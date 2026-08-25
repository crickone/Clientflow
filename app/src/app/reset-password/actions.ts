"use server";

import { completeUserReset, type UserResetResult } from "@/lib/userPasswordReset";

/**
 * Set a new password from a reset token. The token is the sole bearer of
 * authority here (no session required) — this action must stay reachable
 * signed-out, but still validates its inputs defensively against a direct or
 * crafted POST (see completeUserReset for the actual guards: single-use,
 * expiry, min length, never reactivates a disabled account).
 */
export async function completePasswordResetAction(
  token: string,
  password: string,
): Promise<UserResetResult> {
  return completeUserReset(String(token ?? ""), String(password ?? ""));
}
