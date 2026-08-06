import "server-only";
import crypto, { timingSafeEqual } from "node:crypto";

import { controlSqlite } from "@/lib/db/control";
import { verifyPassword } from "@/lib/password";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Constant-time check of the app-to-app service key (x-platform-key). */
export function checkServiceKey(req: Request): boolean {
  const expected = process.env.PLATFORM_API_KEY;
  const provided = req.headers.get("x-platform-key");
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type PlatformUser = { userId: number; email: string; name: string | null };

export function platformLogin(
  email: string,
  password: string,
): { ok: true; token: string; user: PlatformUser } | { ok: false; error: string } {
  const u = controlSqlite
    .prepare("SELECT id, email, name, password_hash, is_platform_admin, is_active FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as
    | { id: number; email: string; name: string | null; password_hash: string; is_platform_admin: number; is_active: number }
    | undefined;
  // Uniform failure: never reveal which factor failed.
  const fail = { ok: false as const, error: "Invalid email or password" };
  if (!u || !u.is_active || !u.is_platform_admin) return fail;
  if (!verifyPassword(password, u.password_hash)) return fail;

  const token = crypto.randomBytes(32).toString("hex");
  controlSqlite
    .prepare("INSERT INTO platform_sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(token, u.id, Date.now() + SESSION_TTL_MS, Date.now());
  return { ok: true, token, user: { userId: u.id, email: u.email, name: u.name } };
}

export function requirePlatformSession(req: Request): PlatformUser {
  const token = req.headers.get("x-admin-session");
  if (!token) throw new Error("UNAUTHORIZED");
  const row = controlSqlite
    .prepare(
      `SELECT s.user_id, s.expires_at, u.email, u.name, u.is_platform_admin, u.is_active
       FROM platform_sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`,
    )
    .get(token) as
    | { user_id: number; expires_at: number; email: string; name: string | null; is_platform_admin: number; is_active: number }
    | undefined;
  if (!row || row.expires_at < Date.now() || !row.is_platform_admin || !row.is_active) {
    throw new Error("UNAUTHORIZED");
  }
  return { userId: row.user_id, email: row.email, name: row.name };
}

export function destroyPlatformSession(req: Request): void {
  const token = req.headers.get("x-admin-session");
  if (token) controlSqlite.prepare("DELETE FROM platform_sessions WHERE token = ?").run(token);
}

/** One-call guard for platform API routes: service key AND session, else a Response. */
export function guardPlatform(req: Request): PlatformUser | Response {
  if (!checkServiceKey(req)) return new Response("Not found", { status: 404 });
  try {
    return requirePlatformSession(req);
  } catch {
    return Response.json({ error: "Session expired" }, { status: 401 });
  }
}
