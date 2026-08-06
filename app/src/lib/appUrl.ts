import "server-only";

import { headers } from "next/headers";

/**
 * Absolute base URL of the running app (e.g. https://app.clientflow.ie), used to
 * build links that leave the app and come back — invite emails, etc.
 *
 * Prefers an explicit APP_URL env (set this on deploy for stable links even from
 * background jobs); otherwise derives it from the incoming request's forwarded
 * host/proto (correct behind Railway's proxy); falls back to localhost in dev.
 */
export function getAppBaseUrl(): string {
  const env = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (env) return env.replace(/\/+$/, "");
  try {
    const h = headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host) {
      const proto =
        h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  } catch {
    // headers() unavailable outside a request scope — fall through.
  }
  return "http://localhost:3000";
}
