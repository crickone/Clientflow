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
  // busy_timeout already exceeds the brief's suggested 5000ms floor (Batch 6a,
  // improvement-plan-2026-08.md Theme E5: "set busy_timeout=5000 if not
  // already set") — 15000 is MORE forgiving under write contention, so it's
  // left as-is rather than lowered.
  sqlite.pragma("busy_timeout = 15000");
  // WAL auto-checkpoint threshold in pages (Batch 6a, Theme E5). This is
  // SQLite's own default, set explicitly so it's not left to chance across
  // SQLite builds/versions. Auto-checkpoint (PASSIVE) recycles the WAL's
  // CONTENTS at this threshold but does NOT shrink the *-wal file back down
  // on disk — that's what the daily wal_checkpoint(TRUNCATE) pass (see
  // lib/db/tenant.ts's checkpointAllOpenConnections, called from the daily
  // scheduler) is for. Safe to set before WAL mode is even enabled — unlike
  // `journal_mode = WAL` below, this pragma is connection-local state, not an
  // exclusive-lock file operation, so it doesn't need the build-phase guard.
  sqlite.pragma("wal_autocheckpoint = 1000");
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

    -- Public form-share routing (Batch 4c, improvement-plan-2026-08.md Theme
    -- D5): maps a contact form's (globally unique) share_slug straight to its
    -- owning tenant + form id, so an unauthenticated /f/<slug> request can
    -- resolve its tenant WITHOUT scanning every tenant db. See
    -- schema.ts's formShareLinks comment / lib/forms.ts's saveForm/deleteForm.
    CREATE TABLE IF NOT EXISTS form_share_links (
      share_slug TEXT PRIMARY KEY,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      form_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_form_share_links_tenant_form ON form_share_links(tenant_id, form_id);

    -- Shared CMS media library ("the CDN"). Lives in the control plane so a
    -- single pool of images is usable across EVERY site and tenant. Bytes are
    -- stored by the storage layer (data/cms-library/<storage_key>, R2-ready) and
    -- served publicly by /library-media/<id>. alt is auto-generated on upload.
    -- tenant_id (Batch 2c, improvement-plan-2026-08.md Theme B2) stamps the
    -- uploading tenant so the admin LIST can be scoped per-tenant; it's nullable
    -- because rows created before this column existed have no recoverable owner
    -- — those legacy rows stay visible to every tenant (see
    -- listLibraryAssets()), only NEW uploads are isolated.
    CREATE TABLE IF NOT EXISTS cms_library_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
      storage_key TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      alt TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Staff invitations: a pending "set your password" link emailed to a new
    -- team member. Identity + membership are created up-front; accepting sets
    -- the password and clears must_change_password.
    CREATE TABLE IF NOT EXISTS user_invites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'staff',
      invited_by_user_id INTEGER REFERENCES users(id),
      expires_at INTEGER NOT NULL,
      accepted_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_user_invites_tenant ON user_invites(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_user_invites_email ON user_invites(email);

    -- Small key/value store for background jobs (e.g. the daily scheduler's
    -- last-run date, so it never runs twice a day even across restarts).
    CREATE TABLE IF NOT EXISTS cron_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- A tenant's connected Gmail account (OAuth). Tokens stored ENCRYPTED.
    CREATE TABLE IF NOT EXISTS gmail_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      access_token TEXT,
      token_expiry INTEGER,
      scope TEXT,
      history_id TEXT,
      last_sync_at INTEGER,
      connected_by_user_id INTEGER REFERENCES users(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- ── Platform billing (spec 2026-07-21) ────────────────────────────────
    -- One row per tenant that participates in billing. Legacy tenants without
    -- a row are NOT gated. billing_exempt=1 → agency-run tenant: shown as
    -- active, never charged, excluded from MRR.
    CREATE TABLE IF NOT EXISTS tenant_billing (
      tenant_id       INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      status          TEXT NOT NULL DEFAULT 'pending_payment'
                      CHECK (status IN ('pending_payment','active','past_due','suspended','cancelled')),
      billing_exempt  INTEGER NOT NULL DEFAULT 0,
      card_token      TEXT,
      card_last4      TEXT,
      card_expiry     TEXT,
      anchor_day      INTEGER,
      next_renewal_at TEXT,
      failed_attempts INTEGER NOT NULL DEFAULT 0,
      last_failure_at INTEGER,
      activated_at    INTEGER,
      suspended_at    INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS billing_invoices (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id       INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      period_start    TEXT NOT NULL,
      period_end      TEXT NOT NULL,
      net_cents       INTEGER NOT NULL,
      vat_cents       INTEGER NOT NULL,
      gross_cents     INTEGER NOT NULL,
      vat_rate_bp     INTEGER NOT NULL,
      currency        TEXT NOT NULL DEFAULT 'EUR',
      status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','failed','waived','refunded')),
      gateway_ref     TEXT,
      attempt_count   INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      -- Atomic per-invoice charge claim: set to Date.now() while a charge is
      -- in flight, cleared (NULL) when it settles. A concurrent run can only
      -- claim an invoice whose claim is NULL or older than the TTL (stale/crash).
      charge_started_at INTEGER,
      paid_at         INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE (tenant_id, period_start)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_invoices_tenant ON billing_invoices(tenant_id);

    CREATE TABLE IF NOT EXISTS billing_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id  INTEGER,
      type       TEXT NOT NULL,
      detail     TEXT,
      actor      TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_billing_events_tenant ON billing_events(tenant_id, created_at);

    CREATE TABLE IF NOT EXISTS platform_sessions (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- A pending hosted-capture session (provider-agnostic): maps the provider's
    -- session ref back to the tenant + purpose on callback/completion.
    CREATE TABLE IF NOT EXISTS capture_sessions (
      ref         TEXT PRIMARY KEY,
      tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      purpose     TEXT NOT NULL CHECK (purpose IN ('activate','update_card','reactivate')),
      amount_cents INTEGER,
      invoice_id  INTEGER,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete','failed')),
      created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Per-tenant API keys for server-to-server integrations (Zapier/Make/etc.).
    -- The raw key is shown to the admin ONCE at creation; we persist only its
    -- sha256 hash (key_hash) so a DB leak can't reveal usable keys. key_prefix
    -- is the non-secret leading slice, shown in the UI to identify a key. A key
    -- carries scopes (currently just 'leads') and routes an inbound request to
    -- its OWNING tenant — the fix for the tenant-blind inbound-leads webhook.
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      label TEXT,
      scopes TEXT NOT NULL DEFAULT 'leads',
      last_used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

    -- Client-app password resets + first-password invites. A single-use,
    -- expiring token tied to a client_credentials row. Used by both the
    -- migration bulk-invite ("set your password") and the client forgot-password
    -- flow. Cascades away with the credential.
    CREATE TABLE IF NOT EXISTS client_password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      credential_id INTEGER NOT NULL REFERENCES client_credentials(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_client_password_resets_cred ON client_password_resets(credential_id);

    -- ── AI usage metering (agentic-OS) ────────────────────────────────────
    -- Per-tenant AI spend metering (central so the platform can see + bill cross-gym spend).
    CREATE TABLE IF NOT EXISTS ai_usage (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      yyyymm        TEXT NOT NULL,           -- billing bucket, e.g. '2026-08'
      agent_key     TEXT NOT NULL,           -- 'sales' | 'assistant' | ...
      model         TEXT NOT NULL,
      input_tokens      INTEGER NOT NULL DEFAULT 0,
      output_tokens     INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_create_tokens INTEGER NOT NULL DEFAULT 0,
      cost_cents    REAL NOT NULL DEFAULT 0,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_month ON ai_usage(tenant_id, yyyymm);

    -- Per-tenant override of the monthly AI spend cap (Batch 3bc,
    -- improvement-plan-2026-08.md Theme C4). Deliberately sparse: a tenant
    -- that has never customized its cap has NO row here at all and falls
    -- back to the DEFAULT MONTHLY_CAP_CENTS — see getTenantCapCents /
    -- assertUnderCap in @/lib/ai/usage.ts. PK lookup keeps the hot-path read
    -- (every AI call goes through assertUnderCap) a single indexed row fetch.
    CREATE TABLE IF NOT EXISTS tenant_ai_cap (
      tenant_id  INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      cap_cents  INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
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

  // Existing control DBs predate billing_invoices.charge_started_at (the atomic
  // per-invoice charge claim). The CREATE above only applies to fresh installs,
  // so add it once on older DBs (PRAGMA-guarded, mirroring the migration above).
  try {
    const cols = controlSqlite
      .prepare("PRAGMA table_info(billing_invoices)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "charge_started_at")) {
      controlSqlite.exec(
        "ALTER TABLE billing_invoices ADD COLUMN charge_started_at INTEGER",
      );
    }
  } catch (err) {
    console.error(
      "[control] billing_invoices charge_started_at migration failed:",
      err,
    );
  }

  // Existing control DBs predate cms_library_assets.tenant_id (Batch 2c,
  // improvement-plan-2026-08.md Theme B2 — the shared media library leaked
  // every tenant's uploads to every other tenant's admin). The CREATE above
  // only applies to fresh installs, so add the column once on older DBs
  // (PRAGMA-guarded, mirroring the migrations above). The index is created
  // unconditionally afterwards (IF NOT EXISTS): by that point the column
  // exists on every DB, old (just migrated) or new (created inline above), so
  // it's safe to run every boot — doing it here rather than in the CREATE-TABLE
  // block above avoids a "no such column" failure on an old DB that hasn't run
  // the ALTER yet when this whole function's first exec() runs.
  try {
    const cols = controlSqlite
      .prepare("PRAGMA table_info(cms_library_assets)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "tenant_id")) {
      controlSqlite.exec(
        "ALTER TABLE cms_library_assets ADD COLUMN tenant_id INTEGER REFERENCES tenants(id)",
      );
    }
    controlSqlite.exec(
      "CREATE INDEX IF NOT EXISTS idx_cms_library_assets_tenant ON cms_library_assets(tenant_id)",
    );
  } catch (err) {
    console.error(
      "[control] cms_library_assets tenant_id migration failed:",
      err,
    );
  }
}

// NB: ensureControlTables() is invoked lazily by rawControl() on first open —
// NOT here. Calling it at module load would open the DB during `next build`.

export const controlDb = drizzle(controlSqlite, { schema });

/** Tiny key/value store for background-job state (see cron_state table). */
export function getCronState(key: string): string | null {
  const row = controlSqlite.prepare("SELECT value FROM cron_state WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}
export function setCronState(key: string, value: string): void {
  controlSqlite
    .prepare("INSERT INTO cron_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(key, value);
}

/**
 * Pure decision helper for the cron_state date-guard pattern (Batch 1 —
 * production safety net, improvement-plan-2026-08.md Theme A5): given the UTC
 * calendar date (`YYYY-MM-DD`) a once-a-day job last completed — or `null` if
 * it never has — should it run now? Kept free of `Date.now()`/DB access so
 * it's trivially unit-testable; every "did today already run?" check (the
 * daily automations tick, the backup + lapse boot-time catch-ups) should call
 * this instead of re-deriving the date-string comparison inline.
 */
export function shouldRunToday(lastRunDateUtc: string | null, nowMs: number): boolean {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  return lastRunDateUtc !== today;
}

/**
 * Atomically claim a once-a-day job (Batch 6a — improvement-plan-2026-08.md
 * Theme E4, multi-instance scheduler locks). `shouldRunToday`'s read-then-write
 * pattern (read cron_state, decide, THEN write cron_state later) is safe for
 * one process but not two: both replicas' schedulers can read "not run yet"
 * before either has written today's date, so both proceed — a double backup
 * upload, a double birthday email pass, a double lapse recompute. This
 * collapses claim + guard into a single atomic UPDATE so only ONE caller can
 * ever win `key` for `todayUtc`, even with two processes racing this at the
 * same instant.
 *
 * `INSERT OR IGNORE` first guarantees a row exists to UPDATE — a key with no
 * row yet (never run before) would otherwise match nothing in the UPDATE's
 * WHERE clause — WITHOUT clobbering a real value from a prior day (IGNORE
 * means the insert no-ops if the row already exists). The sentinel `''` can
 * never equal a real `todayUtc` (`YYYY-MM-DD`), so a brand-new key always
 * loses to the UPDATE below on its very first claim. Mirrors the shape of
 * billing's per-invoice atomic claim (`charge_started_at` in
 * lib/billing/engine.ts's attemptCharge): claim via a conditional UPDATE,
 * check `changes > 0` to know if you won.
 *
 * Only the winner (return value `true`) should run the job. The winner is
 * responsible for calling `resetDailyClaim(key)` if the job then FAILS, so a
 * later tick/replica/boot can retry today — see its doc below. A successful
 * job leaves the claim as-is (today's value already written here) — that IS
 * "done for today", exactly mirroring Batch 1's "only persist success"
 * retry-on-failure behaviour, now race-safe across instances too.
 */
export function claimDailyRun(key: string, todayUtc: string): boolean {
  controlSqlite.prepare("INSERT OR IGNORE INTO cron_state (key, value) VALUES (?, '')").run(key);
  const result = controlSqlite
    .prepare("UPDATE cron_state SET value = ? WHERE key = ? AND (value IS NULL OR value != ?)")
    .run(todayUtc, key, todayUtc);
  return result.changes > 0;
}

/**
 * Release a claim previously won via claimDailyRun so a later tick/replica/
 * boot can retry `key` today — call this when the job FAILS after winning
 * the claim (see lib/backup/scheduler.ts, lib/pipeline/lapseScheduler.ts,
 * lib/automations/scheduler.ts). Deletes the row outright rather than
 * writing a sentinel back: an absent row and a fresh key both mean "never
 * completed", which is exactly the state a failed run should return to. Do
 * NOT call this after a successful run — leaving the claim (today's value)
 * in place is what marks today done; the boot catch-up in each scheduler
 * still runs a missed day, since a day with no successful claim is
 * indistinguishable from a day nobody has attempted yet.
 */
export function resetDailyClaim(key: string): void {
  controlSqlite.prepare("DELETE FROM cron_state WHERE key = ?").run(key);
}

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
