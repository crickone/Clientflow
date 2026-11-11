import { createHash } from "node:crypto";

/**
 * How a bearer token (a session cookie, a password-reset or invite link, a
 * console open link) is STORED: "h1:" + SHA-256 of the token. The raw token
 * only ever exists in the cookie or link; a copy of the database cannot be
 * used to sign in as anyone (October 2026 security audit, item 3).
 *
 * Every lookup hashes what it was given. Never pass a stored value back in
 * as if it were a token: hashing it again makes it match nothing, which is
 * the point.
 */
export const TOKEN_KEY_PREFIX = "h1:";

export function tokenKey(raw: string): string {
  return TOKEN_KEY_PREFIX + createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Tables and columns that hold bearer tokens, converted once at boot (lib/db/control.ts). */
export const TOKEN_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  { table: "auth_sessions", column: "id" },
  { table: "client_sessions", column: "id" },
  { table: "platform_sessions", column: "token" },
  { table: "platform_open_tokens", column: "token" },
  { table: "user_invites", column: "token" },
  { table: "client_password_resets", column: "token" },
  { table: "user_password_resets", column: "token" },
];
