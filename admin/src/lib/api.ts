import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const BASE = process.env.MAIN_APP_URL!;
const KEY = process.env.PLATFORM_API_KEY!;
export const ADMIN_COOKIE = "cf_admin_session";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Server-side call to the main app's platform API (key + session attached). */
export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; session?: string | null } = {},
): Promise<T> {
  const session = opts.session === undefined ? (await cookies()).get(ADMIN_COOKIE)?.value ?? null : opts.session;
  const res = await fetch(`${BASE}/api/platform${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "x-platform-key": KEY,
      ...(session ? { "x-admin-session": session } : {}),
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  // A page renders in parallel with the layout's requireAdminSession, so its own
  // call can see an expired sign-in first. Send it to /login instead of an
  // error screen. Only for a cookie session: /login's own call sends none.
  if (res.status === 401 && session && opts.session === undefined) redirect("/login");
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* keep default */ }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}
