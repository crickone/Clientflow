"use server";

import { headers } from "next/headers";

import { api, ApiError } from "@/lib/api";

/**
 * Ask the main app to email a console reset link.
 *
 * `consoleUrl` is resolved from the incoming request rather than hardcoded, so
 * the emailed link lands back on the origin the admin is actually using —
 * production, a preview deploy, or localhost — instead of always production.
 *
 * Always reports success: the console must not become a way to find out which
 * email addresses have a platform account.
 */
export async function requestConsoleResetAction(email: string): Promise<{ ok: true }> {
  const h = headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  const consoleUrl = host ? `${proto}://${host}` : undefined;

  try {
    await api("/password-reset", {
      method: "POST",
      // No session: the caller is, by definition, signed out.
      session: null,
      body: { email, consoleUrl },
    });
  } catch (err) {
    // The CALLER still gets success — the response must not reveal which
    // addresses exist — but every failure is logged. Swallowing an ApiError
    // silently is how MAIN_APP_URL sitting on a retired domain
    // (app.clientflow.ie) produced a page that said "check your inbox" while
    // nothing had been sent, for an hour, with no trace anywhere.
    console.error("[console reset] request failed", err instanceof ApiError ? `${err.status} ${err.message}` : err);
  }
  return { ok: true };
}
