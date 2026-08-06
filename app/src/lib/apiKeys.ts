import "server-only";

import crypto from "node:crypto";

import { controlSqlite } from "@/lib/db/control";

/**
 * Per-tenant API keys for server-to-server integrations (see the `api_keys`
 * control table). A raw key is `cf_live_<48 hex>`; we persist ONLY its sha256
 * hash, so a DB leak can never reveal a usable secret. Verifying a key resolves
 * the OWNING tenant + its scopes — this is what lets the inbound-leads webhook
 * be tenant-explicit instead of silently falling back to the default tenant.
 *
 * Uses `controlSqlite` prepared statements directly (like lib/platform/auth.ts)
 * so it stays importable under the plain-tsx test runner.
 */

const KEY_PREFIX = "cf_live_";

function sha256Hex(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export interface GeneratedApiKey {
  /** The full secret. Shown to the admin ONCE — never retrievable again. */
  raw: string;
  /** Non-secret leading slice, persisted + shown in the UI to identify the key. */
  prefix: string;
}

/**
 * Mint a new API key for a tenant. Returns the raw key (display ONCE) + its
 * prefix; only the sha256 hash + prefix are stored.
 */
export function generateApiKey(
  tenantId: number,
  label?: string | null,
  scopes = "leads",
): GeneratedApiKey {
  const raw = KEY_PREFIX + crypto.randomBytes(24).toString("hex");
  const prefix = raw.slice(0, 14);
  controlSqlite
    .prepare(
      "INSERT INTO api_keys (tenant_id, key_hash, key_prefix, label, scopes) VALUES (?, ?, ?, ?, ?)",
    )
    .run(tenantId, sha256Hex(raw), prefix, label?.trim() || null, scopes);
  return { raw, prefix };
}

export interface VerifiedApiKey {
  tenantId: number;
  scopes: string;
}

/**
 * Verify a raw key. Returns the owning tenant + scopes for a live (non-revoked)
 * key, else null. Bumps `last_used_at` on a hit.
 */
export function verifyApiKey(raw: string): VerifiedApiKey | null {
  if (!raw || typeof raw !== "string") return null;
  const row = controlSqlite
    .prepare(
      "SELECT id, tenant_id, scopes FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL",
    )
    .get(sha256Hex(raw)) as
    | { id: number; tenant_id: number; scopes: string }
    | undefined;
  if (!row) return null;
  controlSqlite
    .prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?")
    .run(Date.now(), row.id);
  return { tenantId: row.tenant_id, scopes: row.scopes };
}

export interface ApiKeyRow {
  id: number;
  prefix: string;
  label: string | null;
  scopes: string;
  lastUsedAt: number | null;
  createdAt: number;
  revokedAt: number | null;
}

/** List a tenant's keys (newest first), WITHOUT the hash/raw secret. */
export function listApiKeys(tenantId: number): ApiKeyRow[] {
  const rows = controlSqlite
    .prepare(
      "SELECT id, key_prefix, label, scopes, last_used_at, created_at, revoked_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC",
    )
    .all(tenantId) as Array<{
    id: number;
    key_prefix: string;
    label: string | null;
    scopes: string;
    last_used_at: number | null;
    created_at: number;
    revoked_at: number | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    prefix: r.key_prefix,
    label: r.label,
    scopes: r.scopes,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
    revokedAt: r.revoked_at,
  }));
}

/** Revoke a key, scoped to its owning tenant (a tenant can't revoke another's). */
export function revokeApiKey(tenantId: number, id: number): void {
  controlSqlite
    .prepare(
      "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL",
    )
    .run(Date.now(), id, tenantId);
}
