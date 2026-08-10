import "server-only";

import crypto from "node:crypto";

import { controlSqlite } from "@/lib/db/control";

/**
 * Single-use handoff token TTL. Short enough that a captured/logged URL
 * (browser history, new-tab preview, a proxy log) is useless within seconds;
 * long enough to survive the console → app redirect round-trip.
 */
const OPEN_TOKEN_TTL_MS = 60 * 1000;

export interface OpenTokenClaim {
  userId: number;
  tenantId: number;
}

/**
 * Mint a one-time, ≤60s, single-use token binding (userId, tenantId) for the
 * cross-origin "Open business" login handoff (platform console →
 * app.clientflow.ie). Crypto-random, 32 bytes hex (64 chars) — same
 * generator `lib/platform/auth.ts`'s `platformLogin` already uses for
 * platform session tokens.
 */
export function createOpenToken(userId: number, tenantId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  controlSqlite
    .prepare(
      `INSERT INTO platform_open_tokens (token, user_id, tenant_id, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(token, userId, tenantId, now + OPEN_TOKEN_TTL_MS, now);
  pruneExpiredOpenTokens();
  return token;
}

/**
 * Validate and atomically consume a one-time open token.
 *
 * The UPDATE's WHERE clause (`used_at IS NULL AND expires_at > now`) IS the
 * single-use guarantee: SQLite serializes writes, so only one caller can ever
 * flip a given token's `used_at` from NULL — a concurrent or later replay of
 * the exact same token always sees `changes === 0` and loses, in the same
 * statement that reads validity. There is no separate read-then-write step
 * for a racing request to slip between.
 *
 * Returns the bound identity + tenant on success, else `null` — callers must
 * not try to distinguish *why* (unknown token, expired, or already used):
 * same uniform-failure posture as login's "Invalid email or password".
 */
export function consumeOpenToken(token: string): OpenTokenClaim | null {
  const now = Date.now();
  const claim = controlSqlite
    .prepare(
      `UPDATE platform_open_tokens SET used_at = ?
       WHERE token = ? AND used_at IS NULL AND expires_at > ?`,
    )
    .run(now, token, now);
  if (claim.changes !== 1) return null;

  const row = controlSqlite
    .prepare("SELECT user_id, tenant_id FROM platform_open_tokens WHERE token = ?")
    .get(token) as { user_id: number; tenant_id: number } | undefined;
  // Unreachable in practice: the UPDATE above only ever matches a row that
  // still exists (nothing deletes a token between the two statements on a
  // single-threaded better-sqlite3 connection) — guarded anyway so a future
  // change here fails closed rather than crashing on an undefined row.
  if (!row) return null;
  return { userId: row.user_id, tenantId: row.tenant_id };
}

/** Opportunistic cleanup of expired tokens; run on every mint. */
function pruneExpiredOpenTokens(): void {
  controlSqlite.prepare("DELETE FROM platform_open_tokens WHERE expires_at < ?").run(Date.now());
}
