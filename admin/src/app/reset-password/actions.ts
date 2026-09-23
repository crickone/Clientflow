"use server";

import { api, ApiError } from "@/lib/api";

export type VerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: "expired" | "used" | "invalid" };

/** Is the link still good? Asked before the form renders, so a dead link says so up front. */
export async function verifyConsoleResetAction(token: string): Promise<VerifyResult> {
  try {
    const res = await api<VerifyResult>("/password-reset/verify", {
      method: "POST",
      session: null,
      body: { token },
    });
    return res;
  } catch {
    return { ok: false, reason: "invalid" };
  }
}

export async function completeConsoleResetAction(
  token: string,
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api("/password-reset/complete", { method: "POST", session: null, body: { token, password } });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Could not set the password." };
  }
}
