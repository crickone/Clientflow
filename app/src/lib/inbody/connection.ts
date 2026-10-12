import "server-only";
import crypto from "node:crypto";

import { controlSqlite } from "@/lib/db/control";
import { decryptToken, encryptToken } from "@/lib/google/tokenCrypto";

/**
 * A tenant's InBody (LookinBody Web) connection, in the control DB so the
 * public webhook can find the tenant from its secret with one lookup.
 *
 * A row exists from the moment the settings page is first opened: the webhook
 * address has to be shown (and pasted into LookinBody) before the API key
 * exists, because InBody issues the key and the webhook in the same screen.
 */

export type InBodyRegion = "eur" | "usa" | "aus";

export const REGIONS: { value: InBodyRegion; label: string; base: string }[] = [
  { value: "eur", label: "Europe", base: "https://apieur.lookinbody.com" },
  { value: "usa", label: "United States", base: "https://apiusa.lookinbody.com" },
  { value: "aus", label: "Australia", base: "https://apiaus.lookinbody.com" },
];

export function regionBase(region: string): string {
  return (REGIONS.find((r) => r.value === region) ?? REGIONS[0]).base;
}

export interface InBodyConnection {
  tenantId: number;
  account: string;
  hasApiKey: boolean;
  region: InBodyRegion;
  webhookSecret: string;
  lastTestAt: number | null;
  lastTestOk: boolean | null;
  lastError: string | null;
  lastWebhookAt: number | null;
  lastSyncAt: number | null;
}

interface Row {
  tenant_id: number;
  account: string;
  api_key_enc: string | null;
  region: string;
  webhook_secret: string;
  last_test_at: number | null;
  last_test_ok: number | null;
  last_error: string | null;
  last_webhook_at: number | null;
  last_sync_at: number | null;
}

function toConnection(r: Row): InBodyConnection {
  return {
    tenantId: r.tenant_id,
    account: r.account,
    hasApiKey: Boolean(r.api_key_enc),
    region: (REGIONS.some((x) => x.value === r.region) ? r.region : "eur") as InBodyRegion,
    webhookSecret: r.webhook_secret,
    lastTestAt: r.last_test_at,
    lastTestOk: r.last_test_ok === null ? null : r.last_test_ok === 1,
    lastError: r.last_error,
    lastWebhookAt: r.last_webhook_at,
    lastSyncAt: r.last_sync_at,
  };
}

function row(tenantId: number): Row | undefined {
  return controlSqlite.prepare("SELECT * FROM inbody_connections WHERE tenant_id = ?").get(tenantId) as Row | undefined;
}

export function getInBodyConnection(tenantId: number): InBodyConnection | null {
  const r = row(tenantId);
  return r ? toConnection(r) : null;
}

/** The connection, created with a fresh webhook secret if there isn't one yet. */
export function ensureInBodyConnection(tenantId: number): InBodyConnection {
  const existing = row(tenantId);
  if (existing) return toConnection(existing);
  const secret = crypto.randomBytes(24).toString("hex");
  controlSqlite
    .prepare("INSERT OR IGNORE INTO inbody_connections (tenant_id, webhook_secret, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(tenantId, secret, Date.now(), Date.now());
  return toConnection(row(tenantId)!);
}

/** Connected = an account name and an API key, i.e. we can ask InBody for results. */
export function isInBodyConnected(tenantId: number): boolean {
  const r = row(tenantId);
  return Boolean(r && r.account.trim() && r.api_key_enc);
}

export function saveInBodyConnection(
  tenantId: number,
  input: { account: string; apiKey?: string; region: InBodyRegion },
): void {
  ensureInBodyConnection(tenantId);
  const sets = ["account = ?", "region = ?", "updated_at = ?"];
  const args: unknown[] = [input.account.trim(), input.region, Date.now()];
  // A blank key field means "keep the one we have": the saved key is never
  // sent back to the browser, so the form cannot show it.
  if (input.apiKey && input.apiKey.trim()) {
    sets.push("api_key_enc = ?", "last_test_ok = NULL", "last_error = NULL");
    args.push(encryptToken(input.apiKey.trim()));
  }
  controlSqlite.prepare(`UPDATE inbody_connections SET ${sets.join(", ")} WHERE tenant_id = ?`).run(...args, tenantId);
}

export function disconnectInBody(tenantId: number): void {
  controlSqlite
    .prepare("UPDATE inbody_connections SET account = '', api_key_enc = NULL, last_test_ok = NULL, last_error = NULL, updated_at = ? WHERE tenant_id = ?")
    .run(Date.now(), tenantId);
}

export function recordInBodyTest(tenantId: number, ok: boolean, error: string | null): void {
  controlSqlite
    .prepare("UPDATE inbody_connections SET last_test_at = ?, last_test_ok = ?, last_error = ? WHERE tenant_id = ?")
    .run(Date.now(), ok ? 1 : 0, error, tenantId);
}

export function markInBodyWebhook(tenantId: number): void {
  controlSqlite.prepare("UPDATE inbody_connections SET last_webhook_at = ? WHERE tenant_id = ?").run(Date.now(), tenantId);
}

export function markInBodySync(tenantId: number): void {
  controlSqlite.prepare("UPDATE inbody_connections SET last_sync_at = ? WHERE tenant_id = ?").run(Date.now(), tenantId);
}

/** The tenant whose webhook secret this is, compared in constant time. */
export function tenantForWebhookSecret(secret: string): { tenantId: number; account: string } | null {
  if (!/^[a-f0-9]{48}$/.test(secret)) return null;
  const r = controlSqlite.prepare("SELECT tenant_id, account, webhook_secret FROM inbody_connections WHERE webhook_secret = ?").get(secret) as
    | { tenant_id: number; account: string; webhook_secret: string }
    | undefined;
  if (!r) return null;
  const a = Buffer.from(r.webhook_secret);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { tenantId: r.tenant_id, account: r.account };
}

/** Credentials for an API call, or null when the tenant isn't connected. */
export function inbodyCredentials(tenantId: number): { base: string; account: string; apiKey: string } | null {
  const r = row(tenantId);
  if (!r || !r.account.trim() || !r.api_key_enc) return null;
  try {
    return { base: regionBase(r.region), account: r.account.trim(), apiKey: decryptToken(r.api_key_enc) };
  } catch {
    return null;
  }
}
