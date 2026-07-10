import "server-only";

import Database from "better-sqlite3";
import type { Database as BetterSqlite3 } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";
// Cycle-safe: migrate.ts imports controlSqlite but only dereferences it inside
// runBootMigration(), which we call at the bottom of this module after
// controlSqlite is initialised.
import { runBootMigration } from "./migrate";

/**
 * Control plane (multi-tenant): a single global SQLite DB holding the tenant
 * registry plus identity (users + auth sessions). Business data lives in
 * per-tenant DBs (see ./tenant). Auth and tenant-resolution use THIS connection
 * directly — never the per-request tenant proxy (would be chicken-and-egg).
 *
 * NOTE (tenancy foundation, phase 0): this module is additive. It creates
 * control.db with empty tables; nothing reads from it yet. Auth flips onto it in
 * a later phase.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const CONTROL_PATH = path.join(DATA_DIR, "control.db");

// LAZY connection. Opening the DB at module load breaks `next build`: its
// parallel page-data workers each import this module and race to create/lock a
// fresh control.db (SQLITE_BUSY). Deferring the open until first real use means
// importing the module never touches disk — queries only ever run inside request
// handlers (runtime), never during the build.
let _control: BetterSqlite3 | null = null;
function rawControl(): BetterSqlite3 {
  if (_control) return _control;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const sqlite = new Database(CONTROL_PATH);
  sqlite.pragma("busy_timeout = 15000");
  // Skip the WAL mode-change during `next build`: its parallel page-data workers
  // open the same fresh DB at once, and switching journal_mode needs exclusive
  // access that can't be waited out → SQLITE_BUSY. WAL is set at runtime, where
  // there's a single process and no contention.
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("foreign_keys = ON");
  _control = sqlite; // set first so ensureControlTables' proxy resolves to it
  ensureControlTables();
  return sqlite;
}

// A Proxy that forwards every access to the lazily-opened connection (same
// pattern as the request-scoped `db` proxy). Importing this never opens the DB.
export const controlSqlite: BetterSqlite3 = new Proxy(
  {} as BetterSqlite3,
  {
    get(_t, prop, recv) {
      const real = rawControl() as unknown as Record<string | symbol, unknown>;
      const v = Reflect.get(real, prop, recv);
      return typeof v === "function"
        ? (v as (...a: unknown[]) => unknown).bind(real)
        : v;
    },
  },
);

export function ensureControlTables() {
  controlSqlite.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      db_file TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      name TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      tenant_id INTEGER REFERENCES tenants(id),
      is_platform_admin INTEGER NOT NULL DEFAULT 0,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      active_tenant_id INTEGER REFERENCES tenants(id),
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires ON auth_sessions(expires_at);

    -- Client-app credentials + sessions: a client's login for the mobile app,
    -- mapped to a tenant + their client row in that tenant DB.
    CREATE TABLE IF NOT EXISTS client_credentials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      last_login_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS client_sessions (
      id TEXT PRIMARY KEY,
      credential_id INTEGER NOT NULL REFERENCES client_credentials(id) ON DELETE CASCADE,
      tenant_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_client_sessions_expires ON client_sessions(expires_at);

    -- Multi-account identity: a person's access to one tenant with a per-tenant
    -- role. Replaces the single users.tenant_id/users.role binding.
    CREATE TABLE IF NOT EXISTS memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'staff',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_memberships_user_tenant ON memberships(user_id, tenant_id);
    CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id);

    -- CMS host routing: maps a public hostname to a tenant + site so that
    -- UNAUTHENTICATED public requests (no session cookie) can resolve which
    -- tenant DB + site to render. site_id is a logical (cross-file) reference
    -- into that tenant DB's sites table; SQLite can't FK across DB files.
    CREATE TABLE IF NOT EXISTS site_domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host TEXT NOT NULL UNIQUE,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      site_id INTEGER NOT NULL,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_site_domains_host ON site_domains(host);
    CREATE INDEX IF NOT EXISTS idx_site_domains_tenant_site ON site_domains(tenant_id, site_id);

    -- Shared CMS media library ("the CDN"). Lives in the control plane so a
    -- single pool of images is usable across EVERY site and tenant. Bytes are
    -- stored by the storage layer (data/cms-library/<storage_key>, R2-ready) and
    -- served publicly by /library-media/<id>. alt is auto-generated on upload.
    CREATE TABLE IF NOT EXISTS cms_library_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_key TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      alt TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  // Existing control DBs predate auth_sessions.active_tenant_id; the CREATE above
  // only applies to fresh installs, so add it once on older DBs (PRAGMA-guarded,
  // mirroring the tenant-plane column-add migrations).
  try {
    const cols = controlSqlite
      .prepare("PRAGMA table_info(auth_sessions)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "active_tenant_id")) {
      controlSqlite.exec(
        "ALTER TABLE auth_sessions ADD COLUMN active_tenant_id INTEGER REFERENCES tenants(id)",
      );
    }
  } catch (err) {
    console.error(
      "[control] auth_sessions active_tenant_id migration failed:",
      err,
    );
  }
}

// NB: ensureControlTables() is invoked lazily by rawControl() on first open —
// NOT here. Calling it at module load would open the DB during `next build`.

export const controlDb = drizzle(controlSqlite, { schema });

/**
 * Auth + user management read/write identity, which lives in the control plane.
 * They use THIS connection, never the per-request tenant `db` proxy.
 */
export const authDb = controlDb;

/**
 * Session cookie name. Defined here (rather than auth.ts) so both the auth layer
 * and the tenant resolver can import it without an import cycle through `db`.
 * Renamed from the legacy `renova_session` at the tenancy swap → forces one
 * re-login as old cookies stop validating.
 */
export const SESSION_COOKIE = "clientflow_session";

/** Client mobile-app session cookie (distinct from the coach `SESSION_COOKIE`). */
export const CLIENT_SESSION_COOKIE = "cf_client_session";

// Run the idempotent tenancy boot migration as a side-effect of importing the
// control plane. This guarantees it runs BEFORE the first login (which only
// touches control.db, not the `db` proxy / index.ts). Skipped during
// `next build` (route imports would otherwise run it at build time). migrate.ts
// uses controlSqlite via a deferred call, so this import is cycle-safe.
if (process.env.NEXT_PHASE !== "phase-production-build") {
  runBootMigration();
}
