import "server-only";

import type Database from "better-sqlite3";

import { controlSqlite } from "@/lib/db/control";
import { openTenantDb } from "@/lib/db/tenant";
import { resealIfPrevious } from "@/lib/google/tokenCrypto";
import { listTenants } from "@/lib/tenants";

/**
 * Finish an EMAIL_TOKEN_SECRET rotation: re-encrypt every stored secret that
 * is still under EMAIL_TOKEN_SECRET_PREVIOUS with the current key.
 * Idempotent and safe to run again; does nothing without the _PREVIOUS
 * variable. Reports counts only, never a value.
 *
 * Every place the app keeps a sealed secret is listed here. A new one must
 * be added, or a rotation leaves it readable only with the old key.
 */

type Column = { table: string; column: string; key: string; prefix?: string };

const CONTROL_COLUMNS: Column[] = [
  { table: "meta_grants", column: "token_enc", key: "tenant_id" },
  { table: "facebook_pages", column: "page_access_token", key: "id", prefix: "enc1:" },
  { table: "gmail_connections", column: "refresh_token", key: "id" },
  { table: "gmail_connections", column: "access_token", key: "id" },
  { table: "google_business_connections", column: "refresh_token", key: "id" },
  { table: "google_business_connections", column: "access_token", key: "id" },
  { table: "imap_connections", column: "password_enc", key: "id" },
  { table: "inbody_connections", column: "api_key_enc", key: "tenant_id" },
];

const TENANT_COLUMNS: Column[] = [
  { table: "wearable_connections", column: "access_token", key: "id" },
  { table: "wearable_connections", column: "refresh_token", key: "id" },
  { table: "sites", column: "meta_capi_token", key: "id" },
];

export interface ResealReport {
  resealed: number;
  unreadable: number;
}

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

function resealColumns(db: Database.Database, columns: Column[], report: ResealReport): void {
  for (const c of columns) {
    if (!tableExists(db, c.table)) continue;
    const rows = db
      .prepare(`SELECT ${c.key} AS k, ${c.column} AS v FROM ${c.table} WHERE ${c.column} IS NOT NULL AND ${c.column} != ''`)
      .all() as Array<{ k: number | string; v: string }>;
    const put = db.prepare(`UPDATE ${c.table} SET ${c.column} = ? WHERE ${c.key} = ? AND ${c.column} = ?`);
    for (const r of rows) {
      const sealed = c.prefix && r.v.startsWith(c.prefix) ? r.v.slice(c.prefix.length) : r.v;
      const out = resealIfPrevious(sealed);
      if ("resealed" in out) {
        put.run((c.prefix && r.v.startsWith(c.prefix) ? c.prefix : "") + out.resealed, r.k, r.v);
        report.resealed++;
      } else if ("unreadable" in out) report.unreadable++;
    }
  }
}

/** The WhatsApp config is a JSON settings row with two sealed fields. */
function resealWhatsAppConfig(db: Database.Database, report: ResealReport): void {
  if (!tableExists(db, "settings")) return;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'whatsapp_config'").get() as { value: string } | undefined;
  if (!row) return;
  let cfg: Record<string, unknown>;
  try {
    cfg = JSON.parse(row.value) as Record<string, unknown>;
  } catch {
    return;
  }
  let changed = false;
  for (const f of ["tokenEnc", "webhookSecretEnc"]) {
    const v = cfg[f];
    if (typeof v !== "string" || !v) continue;
    const out = resealIfPrevious(v);
    if ("resealed" in out) {
      cfg[f] = out.resealed;
      changed = true;
      report.resealed++;
    } else if ("unreadable" in out) report.unreadable++;
  }
  if (changed) db.prepare("UPDATE settings SET value = ? WHERE key = 'whatsapp_config' AND value = ?").run(JSON.stringify(cfg), row.value);
}

export function resealAllSecrets(): ResealReport {
  const report: ResealReport = { resealed: 0, unreadable: 0 };
  if (!process.env.EMAIL_TOKEN_SECRET_PREVIOUS) return report;
  resealColumns(controlSqlite as unknown as Database.Database, CONTROL_COLUMNS, report);
  for (const t of listTenants()) {
    try {
      const db = openTenantDb(t.dbFile).sqlite as unknown as Database.Database;
      resealColumns(db, TENANT_COLUMNS, report);
      resealWhatsAppConfig(db, report);
    } catch (err) {
      console.error(`[security] reseal: tenant ${t.id} skipped:`, err instanceof Error ? err.message : err);
    }
  }
  console.log(
    `[security] EMAIL_TOKEN_SECRET rotation: ${report.resealed} secret(s) re-encrypted with the new key; ${report.unreadable} unreadable with either key` +
      (report.unreadable === 0 ? ". Remove EMAIL_TOKEN_SECRET_PREVIOUS once this run is clean." : " (left as they were)."),
  );
  return report;
}
