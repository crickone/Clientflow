import "server-only";

import Database from "better-sqlite3";
import type { Database as BetterSqlite3 } from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { and, eq } from "drizzle-orm";
import { cache } from "react";
import { cookies } from "next/headers";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";
import { runMigrations, TENANT_MIGRATIONS } from "./migrations";
import { CLIENT_SESSION_COOKIE, controlDb, controlSqlite, SESSION_COOKIE } from "./control";

/**
 * Per-tenant database plane. Each business has its own SQLite file holding all
 * business data (everything except users/auth_sessions, which live in the
 * control plane). The current tenant is resolved per request from the session
 * cookie; background jobs and provisioning resolve a tenant explicitly.
 */

export type TenantDb = BetterSQLite3Database<typeof schema>;

interface TenantConn {
  sqlite: BetterSqlite3;
  db: TenantDb;
}

const DATA_DIR = path.join(process.cwd(), "data");
export const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG || "renova";

// Process-level connection cache, keyed by db_file. better-sqlite3 connections
// are long-lived; one per tenant file for the life of the server. Iteration
// order doubles as LRU order: openTenantDb() re-inserts a key on every cache
// HIT (delete + set moves it to the end), so the Map's insertion order is
// always least-recently-used → most-recently-used. See MAX_CACHED_CONNS below.
const connCache = new Map<string, TenantConn>();

// LRU cap on connCache (Batch 6a — improvement-plan-2026-08.md Theme E5).
// Unbounded growth was fine at today's scale (2 tenants) but not forever —
// every provisioned tenant left a native better-sqlite3 handle open for the
// life of the process. 50 is comfortably above any current/near-term tenant
// count, so this is inert today; it only bounds growth for later.
const MAX_CACHED_CONNS = 50;

/**
 * Pure LRU-eviction decision: given cache keys in LEAST → MOST-recently-used
 * order (connCache's iteration order — see its comment above) and the cap,
 * return the one key to evict, or null if at/under the cap. Kept free of the
 * Map/connection objects themselves so it's trivially unit-testable
 * (tenant.test.ts) independent of real better-sqlite3 handles. Only ever
 * needs to return a single key: openTenantDb calls this right after adding
 * AT MOST one new entry, so size can never exceed cap+1 at the call site.
 */
export function pickLruEviction(keysLruToMru: readonly string[], cap: number): string | null {
  if (keysLruToMru.length <= cap) return null;
  return keysLruToMru[0] ?? null;
}

// Explicit tenant binding for detached background jobs. A fire-and-forget job
// spawned from a request loses the request's cookie context by the time its
// async work runs, so the request-scoped `db` proxy would fall back to the
// DEFAULT tenant — silently writing one clinic's data into another's DB. Wrap
// such a job in `runWithTenant(tenantId, …)` (capturing the id while still in
// the request) and every `db` access inside it — and everything it calls —
// resolves to that tenant instead.
const tenantContext = new AsyncLocalStorage<number>();

/** Bind a callback (typically a detached job) to an explicit tenant. */
export function runWithTenant<T>(tenantId: number, fn: () => T): T {
  return tenantContext.run(tenantId, fn);
}

/**
 * Resolve a tenant's `db_file` (as stored in the registry) to an absolute path.
 * Renova's file is `clinic.db` at the data root; provisioned tenants use
 * `tenants/<slug>/<slug>.db`. Absolute paths are honoured as-is.
 */
function resolveDbPath(dbFile: string): string {
  return path.isAbsolute(dbFile) ? dbFile : path.join(DATA_DIR, dbFile);
}

/** Open (or reuse) a tenant connection by its registry `db_file`. */
export function openTenantDb(dbFile: string): TenantConn {
  const existing = connCache.get(dbFile);
  if (existing) {
    // Mark most-recently-used: delete + re-insert moves this key to the END
    // of the Map's iteration order, which pickLruEviction relies on below to
    // find the LEAST-recently-used key (index 0) in O(1) amortised work.
    connCache.delete(dbFile);
    connCache.set(dbFile, existing);
    return existing;
  }

  const fullPath = resolveDbPath(dbFile);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const sqlite = new Database(fullPath);
  // busy_timeout already exceeds the brief's suggested 5000ms floor (Batch 6a,
  // improvement-plan-2026-08.md Theme E5) — 15000 is MORE forgiving under
  // write contention, so it's left as-is rather than lowered (mirrors
  // control.ts's rawControl()).
  sqlite.pragma("busy_timeout = 15000");
  // WAL auto-checkpoint threshold in pages — SQLite's own default, set
  // explicitly (see control.ts's rawControl() for the full rationale: this
  // recycles WAL contents at the threshold but doesn't shrink the *-wal file
  // on disk; checkpointAllOpenConnections below does that, daily).
  sqlite.pragma("wal_autocheckpoint = 1000");
  // Skip the WAL mode-change during `next build` (see control.ts): parallel
  // page-data workers contend on the exclusive journal_mode switch → SQLITE_BUSY.
  if (process.env.NEXT_PHASE !== "phase-production-build") {
    sqlite.pragma("journal_mode = WAL");
  }
  sqlite.pragma("foreign_keys = ON");
  ensureTenantTables(sqlite);
  // Batch 6b (improvement-plan-2026-08.md Theme E1): versioned migrations for
  // schema EVOLUTION (non-additive changes), run after the additive
  // bootstrap above. See migrations/index.ts for the division of labour.
  runMigrations(sqlite, TENANT_MIGRATIONS);
  const conn: TenantConn = { sqlite, db: drizzle(sqlite, { schema }) };
  connCache.set(dbFile, conn);

  // LRU eviction (Batch 6a, Theme E5): better-sqlite3 is fully synchronous,
  // so a handle is never "in use" across an `await` — nothing else can run
  // between this open completing and the eviction below, so closing the
  // least-recently-used handle here can never race a query in flight on it.
  // The connection just inserted above is structurally exempt: `.set()` on a
  // brand-new key always lands at the END of iteration order (most-recently-
  // used), so pickLruEviction's index-0 pick can never select it.
  const evictKey = pickLruEviction([...connCache.keys()], MAX_CACHED_CONNS);
  if (evictKey) {
    const evicted = connCache.get(evictKey);
    connCache.delete(evictKey);
    try {
      evicted?.sqlite.close();
    } catch (err) {
      console.error(`[db] LRU eviction: closing connection for ${evictKey} failed:`, err);
    }
  }

  return conn;
}

/**
 * Evict + close ONE tenant's cached connection by its registry `db_file` (the
 * same key openTenantDb() uses), if one is currently cached. Used by
 * offboardTenant (billing/engine.ts) before it deletes that tenant's live DB
 * file — a still-open better-sqlite3 handle can keep the file locked, or
 * silently recreate empty `-wal`/`-shm` siblings on its next access, either of
 * which would undermine "the live DB is gone". A no-op (never throws) when the
 * connection was never opened / already evicted — mirrors the LRU eviction's
 * own try/catch-and-log-only close() above.
 */
export function closeTenantConn(dbFile: string): void {
  const existing = connCache.get(dbFile);
  if (!existing) return;
  connCache.delete(dbFile);
  try {
    existing.sqlite.close();
  } catch (err) {
    console.error(`[db] closeTenantConn: closing connection for ${dbFile} failed:`, err);
  }
}

/**
 * Best-effort `PRAGMA wal_checkpoint(TRUNCATE)` over the control connection +
 * every currently-cached tenant connection (Batch 6a — improvement-plan-
 * 2026-08.md Theme E5). Auto-checkpointing (wal_autocheckpoint, set on every
 * open above / in control.ts) recycles the WAL's CONTENTS at the page
 * threshold but does NOT shrink the `*-wal` file back down on disk — that's
 * what this explicit TRUNCATE pass is for (control.db-wal was observed
 * growing to ~4MB on a long-lived writer). Call this once/day from the
 * in-process daily scheduler tick — NEVER from a request path, since a
 * checkpoint briefly blocks writers on that connection. Per-connection
 * try/catch: one busy/wedged connection must not skip the rest.
 */
export function checkpointAllOpenConnections(): { ok: string[]; failed: string[] } {
  const ok: string[] = [];
  const failed: string[] = [];
  const attempt = (label: string, sqlite: BetterSqlite3) => {
    try {
      sqlite.pragma("wal_checkpoint(TRUNCATE)");
      ok.push(label);
    } catch (err) {
      failed.push(label);
      console.error(`[db] wal_checkpoint(TRUNCATE) failed for ${label}:`, err);
    }
  };
  attempt("control", controlSqlite);
  for (const [dbFile, conn] of connCache) attempt(dbFile, conn.sqlite);
  return { ok, failed };
}

/** Explicit tenant resolution by slug (jobs, provisioning, fallback). */
export function getTenantBySlug(slug: string) {
  return controlDb
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.slug, slug))
    .get();
}

/** Explicit tenant resolution by id. */
export function getTenantById(id: number) {
  return controlDb
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, id))
    .get();
}

export function getTenantDbBySlug(slug: string): TenantDb {
  const tenant = getTenantBySlug(slug);
  if (!tenant) throw new Error(`[tenant] unknown tenant slug: ${slug}`);
  return openTenantDb(tenant.dbFile).db;
}

export function getTenantDbById(id: number): TenantDb {
  const tenant = getTenantById(id);
  if (!tenant) throw new Error(`[tenant] unknown tenant id: ${id}`);
  return openTenantDb(tenant.dbFile).db;
}

/**
 * The current request's tenant. Resolves cookie → control session →
 * session.active_tenant_id → tenant. Falls back to the default tenant when there
 * is no resolvable session or active tenant — this covers the public
 * server-to-server webhooks (no cookie) and a multi-clinic user who hasn't
 * chosen yet (their page request gets redirected to /select-account by the auth
 * guards before any business data renders). Safe because middleware redirects
 * every logged-out app request to /login. Memoised per request with React
 * cache().
 */
export const getCurrentTenant = cache(() => {
  // A detached job bound via runWithTenant wins over cookie resolution.
  const ctxTenantId = tenantContext.getStore();
  if (ctxTenantId != null) {
    const t = getTenantById(ctxTenantId);
    if (t) return t;
    throw new Error(`[tenant] runWithTenant: unknown tenant id ${ctxTenantId}`);
  }

  let token: string | undefined;
  try {
    token = cookies().get(SESSION_COOKIE)?.value;
  } catch {
    // cookies() throws only outside a request scope — a detached background job.
    // Had it bound a tenant via runWithTenant we'd have returned above, so
    // reaching here means a job used the request-scoped `db` proxy with no
    // tenant context. Fail loud rather than silently writing to the default
    // tenant (which would mix one clinic's data into another). `next build`
    // static generation also runs outside a request — let it fall through.
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      throw new Error(
        "[tenant] the request-scoped `db` was accessed outside a request " +
          "without a tenant context. A background job must run inside " +
          "runWithTenant(tenantId, …) or use getTenantDbById(id).",
      );
    }
    token = undefined;
  }

  if (token) {
    const row = controlDb
      .select({
        activeTenantId: schema.authSessions.activeTenantId,
        userId: schema.authSessions.userId,
        expiresAt: schema.authSessions.expiresAt,
      })
      .from(schema.authSessions)
      .where(eq(schema.authSessions.id, token))
      .get();
    if (row && row.expiresAt.getTime() > Date.now()) {
      let tid = row.activeTenantId;
      // MUST mirror getCurrentMembership(): a session that never picked an active
      // tenant still resolves when the user has exactly one active membership.
      // Without this, requireUser() passes as tenant B (single membership) while
      // the db proxy silently falls through to the DEFAULT tenant below — a
      // cross-tenant read/write. 0 or >1 memberships → leave unresolved (the
      // request is rejected by requireUser; only /select-account chrome renders).
      if (tid == null) {
        const ms = controlDb
          .select({ tenantId: schema.memberships.tenantId })
          .from(schema.memberships)
          .where(
            and(
              eq(schema.memberships.userId, row.userId),
              eq(schema.memberships.isActive, true),
            ),
          )
          .all();
        if (ms.length === 1) tid = ms[0].tenantId;
      }
      if (tid != null) {
        const t = getTenantById(tid);
        if (t) return t;
      }
    }
  }

  // Client mobile app: resolve tenant from the client session cookie so the
  // per-request `db` proxy points at the signed-in client's tenant DB.
  let clientToken: string | undefined;
  try {
    clientToken = cookies().get(CLIENT_SESSION_COOKIE)?.value;
  } catch {
    clientToken = undefined;
  }
  if (clientToken) {
    const cs = controlDb
      .select({ tenantId: schema.clientSessions.tenantId, expiresAt: schema.clientSessions.expiresAt })
      .from(schema.clientSessions)
      .where(eq(schema.clientSessions.id, clientToken))
      .get();
    if (cs && cs.expiresAt.getTime() > Date.now()) {
      const t = getTenantById(cs.tenantId);
      if (t) return t;
    }
  }

  const fallback = getTenantBySlug(DEFAULT_TENANT_SLUG);
  if (fallback) return fallback;

  // Registry not yet populated — e.g. build-time static generation (the boot
  // migration is skipped during `next build`) or a pre-migration boot. Resolve
  // the default tenant to the legacy clinic.db directly so db access never hard
  // fails. The synthetic id is never used: business tables carry no tenant_id,
  // and identity queries go through the control plane, not this proxy.
  return {
    id: 0,
    slug: DEFAULT_TENANT_SLUG,
    name: "Default",
    dbFile: "clinic.db",
    isActive: true,
    createdAt: new Date(),
  };
});

/** The current request's tenant DB (see getCurrentTenant). */
export function getCurrentTenantDb(): TenantDb {
  // A detached job binds its tenant explicitly (runWithTenant); resolve it
  // directly so background work never depends on request-scoped cookie state.
  const ctxTenantId = tenantContext.getStore();
  if (ctxTenantId != null) return getTenantDbById(ctxTenantId);
  return openTenantDb(getCurrentTenant().dbFile).db;
}

/**
 * Idempotently create the business tables on a tenant connection. This is the
 * business half of the legacy `index.ts` schema — users/auth_sessions are NOT
 * here (they live in control.db). Re-running on every open is cheap and
 * self-healing; the same pattern the single-tenant app always used.
 */
export function ensureTenantTables(sqlite: BetterSqlite3): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      phone TEXT NOT NULL,
      date_of_birth TEXT,
      address TEXT,
      medical_notes TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      gdpr_consent INTEGER DEFAULT 0,
      gdpr_consent_date INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      all_day INTEGER NOT NULL DEFAULT 0,
      location TEXT,
      color TEXT,
      created_by_user_id INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_calendar_events_date ON calendar_events(date);

    CREATE TABLE IF NOT EXISTS client_emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent',
      provider_id TEXT,
      error TEXT,
      sent_by_user_id INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_client_emails_client ON client_emails(client_id);

    CREATE TABLE IF NOT EXISTS email_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      gmail_message_id TEXT NOT NULL UNIQUE,
      gmail_thread_id TEXT,
      direction TEXT NOT NULL,
      from_email TEXT,
      from_name TEXT,
      to_email TEXT,
      subject TEXT,
      snippet TEXT,
      body_html TEXT,
      body_text TEXT,
      client_id INTEGER,
      internal_date INTEGER,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_email_messages_thread ON email_messages(gmail_thread_id);
    CREATE INDEX IF NOT EXISTS idx_email_messages_client ON email_messages(client_id);
    CREATE INDEX IF NOT EXISTS idx_email_messages_date ON email_messages(internal_date);

    CREATE TABLE IF NOT EXISTS therapies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      colour_hex TEXT NOT NULL,
      default_duration_minutes INTEGER NOT NULL,
      default_price_eur REAL NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      therapy_ids TEXT NOT NULL DEFAULT '[]',
      total_price_eur REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      therapy_id INTEGER NOT NULL REFERENCES therapies(id),
      package_name TEXT NOT NULL,
      total_sessions INTEGER NOT NULL,
      sessions_used INTEGER NOT NULL DEFAULT 0,
      price_paid_eur REAL NOT NULL,
      purchase_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      therapy_id INTEGER NOT NULL REFERENCES therapies(id),
      date TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      therapist_notes TEXT,
      outcome_rating INTEGER,
      package_id INTEGER REFERENCES packages(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS gift_vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      purchaser_name TEXT NOT NULL,
      purchaser_email TEXT,
      recipient_name TEXT,
      therapy_id INTEGER REFERENCES therapies(id),
      value_eur REAL NOT NULL,
      balance_eur REAL NOT NULL DEFAULT 0,
      is_redeemed INTEGER NOT NULL DEFAULT 0,
      redeemed_by_client_id INTEGER REFERENCES clients(id),
      redeemed_at INTEGER,
      purchase_date TEXT NOT NULL,
      expiry_date TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      appointment_id INTEGER REFERENCES appointments(id),
      package_id INTEGER REFERENCES packages(id),
      voucher_id INTEGER REFERENCES gift_vouchers(id),
      amount_eur REAL NOT NULL,
      payment_method TEXT NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS package_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      therapy_id INTEGER NOT NULL REFERENCES therapies(id),
      total_sessions INTEGER NOT NULL,
      price_eur REAL NOT NULL,
      validity_months INTEGER NOT NULL DEFAULT 12,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS block_outs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      date TEXT,
      end_date TEXT,
      day_of_week INTEGER,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS class_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      capacity INTEGER NOT NULL DEFAULT 1,
      location TEXT,
      instructor TEXT,
      visibility TEXT NOT NULL DEFAULT 'public',
      days_of_week TEXT NOT NULL,
      start_time TEXT NOT NULL,
      duration_min INTEGER NOT NULL DEFAULT 60,
      start_date TEXT NOT NULL,
      end_date TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS class_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      schedule_id INTEGER REFERENCES class_schedules(id) ON DELETE SET NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      color TEXT NOT NULL DEFAULT '#3b82f6',
      capacity INTEGER NOT NULL DEFAULT 1,
      location TEXT,
      instructor TEXT,
      visibility TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'scheduled',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_class_sessions_date ON class_sessions(date);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_class_sessions_schedule_slot
      ON class_sessions(schedule_id, date, start_time);

    CREATE TABLE IF NOT EXISTS session_bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES class_sessions(id) ON DELETE CASCADE,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'booked',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_session_bookings_unique
      ON session_bookings(session_id, client_id);
    CREATE INDEX IF NOT EXISTS idx_session_bookings_session
      ON session_bookings(session_id);

    CREATE TABLE IF NOT EXISTS membership_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      price_cents INTEGER NOT NULL DEFAULT 0,
      billing_interval TEXT NOT NULL DEFAULT 'month',
      billing_count INTEGER NOT NULL DEFAULT 1,
      unlimited_sessions INTEGER NOT NULL DEFAULT 0,
      sessions_quantity INTEGER NOT NULL DEFAULT 1,
      visibility TEXT NOT NULL DEFAULT 'all',
      joining_fee_cents INTEGER NOT NULL DEFAULT 0,
      open_access INTEGER NOT NULL DEFAULT 0,
      priority_booking INTEGER NOT NULL DEFAULT 0,
      for_sale INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS client_memberships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      membership_id INTEGER REFERENCES membership_plans(id) ON DELETE SET NULL,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      membership_name TEXT NOT NULL,
      price_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT NOT NULL,
      next_billing_date TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_client_memberships_client
      ON client_memberships(client_id);
    CREATE INDEX IF NOT EXISTS idx_client_memberships_membership
      ON client_memberships(membership_id);

    CREATE TABLE IF NOT EXISTS package_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      price_cents INTEGER NOT NULL DEFAULT 0,
      unlimited_sessions INTEGER NOT NULL DEFAULT 0,
      sessions_quantity INTEGER NOT NULL DEFAULT 1,
      unlimited_duration INTEGER NOT NULL DEFAULT 0,
      expiration_count INTEGER NOT NULL DEFAULT 1,
      expiration_interval TEXT NOT NULL DEFAULT 'month',
      single_purchase INTEGER NOT NULL DEFAULT 0,
      activate_on_first_booking INTEGER NOT NULL DEFAULT 0,
      auto_renewal INTEGER NOT NULL DEFAULT 0,
      restrict_to_members INTEGER NOT NULL DEFAULT 0,
      visibility TEXT NOT NULL DEFAULT 'all',
      open_access INTEGER NOT NULL DEFAULT 0,
      priority_booking INTEGER NOT NULL DEFAULT 0,
      for_sale INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS client_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER REFERENCES package_plans(id) ON DELETE SET NULL,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      package_name TEXT NOT NULL,
      price_cents INTEGER NOT NULL DEFAULT 0,
      sessions_total INTEGER NOT NULL DEFAULT 0,
      unlimited_sessions INTEGER NOT NULL DEFAULT 0,
      sessions_used INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      start_date TEXT NOT NULL,
      end_date TEXT,
      activated INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_client_packages_client
      ON client_packages(client_id);
    CREATE INDEX IF NOT EXISTS idx_client_packages_package
      ON client_packages(package_id);

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      phone TEXT,
      title TEXT,
      pay_type TEXT NOT NULL DEFAULT 'per_session',
      pay_rate_cents INTEGER NOT NULL DEFAULT 0,
      is_approved INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS nutrition_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New Nutrition Plan',
      type TEXT NOT NULL,
      macro_mode TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      tags TEXT,
      notes TEXT,
      upload_filename TEXT,
      upload_original_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS nutrition_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Day 1',
      position INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      protein REAL NOT NULL DEFAULT 0,
      carbs REAL NOT NULL DEFAULT 0,
      fat REAL NOT NULL DEFAULT 0,
      calories REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_nutrition_days_plan ON nutrition_days(plan_id);

    CREATE TABLE IF NOT EXISTS nutrition_meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL REFERENCES nutrition_days(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Meal',
      position INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      protein REAL NOT NULL DEFAULT 0,
      carbs REAL NOT NULL DEFAULT 0,
      fat REAL NOT NULL DEFAULT 0,
      calories REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_nutrition_meals_day ON nutrition_meals(day_id);

    CREATE TABLE IF NOT EXISTS nutrition_foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meal_id INTEGER NOT NULL REFERENCES nutrition_meals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT,
      protein REAL NOT NULL DEFAULT 0,
      carbs REAL NOT NULL DEFAULT 0,
      fat REAL NOT NULL DEFAULT 0,
      calories REAL NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_nutrition_foods_meal ON nutrition_foods(meal_id);

    CREATE TABLE IF NOT EXISTS food_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      serving_size REAL NOT NULL DEFAULT 100,
      serving_unit TEXT NOT NULL DEFAULT 'g',
      protein REAL NOT NULL DEFAULT 0,
      carbs REAL NOT NULL DEFAULT 0,
      fat REAL NOT NULL DEFAULT 0,
      calories REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS meal_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'New Meal',
      category TEXT,
      notes TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS meal_template_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meal_id INTEGER NOT NULL REFERENCES meal_templates(id) ON DELETE CASCADE,
      food_id INTEGER REFERENCES food_library(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT,
      protein REAL NOT NULL DEFAULT 0,
      carbs REAL NOT NULL DEFAULT 0,
      fat REAL NOT NULL DEFAULT 0,
      calories REAL NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_meal_items_meal ON meal_template_items(meal_id);

    CREATE TABLE IF NOT EXISTS exercise_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT,
      muscle_groups TEXT,
      equipment TEXT,
      video_url TEXT,
      image_url TEXT,
      instructions TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS workout_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New Program',
      type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      tags TEXT,
      summary TEXT,
      content TEXT,
      upload_filename TEXT,
      upload_original_name TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS workout_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      program_id INTEGER NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Day 1',
      position INTEGER NOT NULL DEFAULT 0,
      instructions TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_workout_days_program ON workout_days(program_id);

    CREATE TABLE IF NOT EXISTS workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
      section TEXT NOT NULL DEFAULT 'workout',
      exercise_id INTEGER REFERENCES exercise_library(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      sets INTEGER NOT NULL DEFAULT 0,
      reps TEXT,
      rest_seconds INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      muscle_groups TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_workout_exercises_day ON workout_exercises(day_id);

    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'New Workout',
      tags TEXT,
      instructions TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS workout_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      section TEXT NOT NULL DEFAULT 'workout',
      exercise_id INTEGER REFERENCES exercise_library(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      sets INTEGER NOT NULL DEFAULT 0,
      reps TEXT,
      rest_seconds INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      muscle_groups TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_workout_items_workout ON workout_items(workout_id);

    CREATE TABLE IF NOT EXISTS circuits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT 'New Circuit',
      tags TEXT,
      rounds INTEGER NOT NULL DEFAULT 3,
      rest_between_seconds INTEGER NOT NULL DEFAULT 0,
      instructions TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS circuit_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      circuit_id INTEGER NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
      exercise_id INTEGER REFERENCES exercise_library(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      sets INTEGER NOT NULL DEFAULT 0,
      reps TEXT,
      rest_seconds INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      muscle_groups TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_circuit_items_circuit ON circuit_items(circuit_id);

    CREATE TABLE IF NOT EXISTS automation_triggers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 0,
      external_enabled INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS automation_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_key TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'chat',
      subject TEXT,
      template TEXT,
      attachment_filename TEXT,
      attachment_original TEXT,
      delay_value INTEGER NOT NULL DEFAULT 0,
      delay_unit TEXT NOT NULL DEFAULT 'minutes',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_automation_messages_trigger ON automation_messages(trigger_key);

    CREATE TABLE IF NOT EXISTS automation_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trigger_key TEXT NOT NULL,
      trigger_name TEXT NOT NULL,
      channel TEXT NOT NULL,
      subject TEXT,
      sent_to TEXT,
      status TEXT NOT NULL DEFAULT 'sent',
      sent_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 1,
      trigger_status INTEGER NOT NULL DEFAULT 0,
      content TEXT,
      share_slug TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_forms_type ON forms(type);

    CREATE TABLE IF NOT EXISTS form_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      section TEXT NOT NULL DEFAULT 'main',
      label TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'short',
      options TEXT,
      required INTEGER NOT NULL DEFAULT 0,
      is_metric INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_form_questions_form ON form_questions(form_id);

    -- Public submissions to a contact form (Batch 4c, improvement-plan-2026-08.md
    -- Theme D5). tenant_id is a logical stamp (server-resolved at submit time,
    -- never client input) — see schema.ts's formSubmissions comment.
    CREATE TABLE IF NOT EXISTS form_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id INTEGER NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
      tenant_id INTEGER NOT NULL,
      submitter_name TEXT,
      submitter_email TEXT,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions(form_id);

    CREATE TABLE IF NOT EXISTS client_nutrition_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES nutrition_plans(id) ON DELETE CASCADE,
      assigned_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_nutrition_uniq ON client_nutrition_plans(client_id, plan_id);
    CREATE INDEX IF NOT EXISTS idx_client_nutrition_client ON client_nutrition_plans(client_id);

    CREATE TABLE IF NOT EXISTS client_workout_programs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      program_id INTEGER NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
      assigned_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_client_workout_uniq ON client_workout_programs(client_id, program_id);
    CREATE INDEX IF NOT EXISTS idx_client_workout_client ON client_workout_programs(client_id);

    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL DEFAULT 'manual',
      source_lead_id TEXT,
      campaign TEXT,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone TEXT,
      therapy_interest TEXT,
      notes TEXT,
      raw_payload TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      client_id INTEGER REFERENCES clients(id),
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_source_dedup ON leads(source, source_lead_id);

    CREATE TABLE IF NOT EXISTS lead_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      channel TEXT,
      content TEXT NOT NULL,
      ai_generated INTEGER NOT NULL DEFAULT 0,
      sent_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_lead_messages_lead ON lead_messages(lead_id);

    CREATE TABLE IF NOT EXISTS video_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      target_seconds INTEGER NOT NULL DEFAULT 45,
      tone_notes TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      transcript_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS video_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES video_projects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      duration_seconds REAL,
      width INTEGER,
      height INTEGER,
      rotation INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_video_assets_project ON video_assets(project_id);

    CREATE TABLE IF NOT EXISTS blog_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      input_mode TEXT NOT NULL,
      source_video_project_id INTEGER REFERENCES video_projects(id) ON DELETE SET NULL,
      source_therapy_id INTEGER REFERENCES therapies(id) ON DELETE SET NULL,
      prompt TEXT,
      tone TEXT,
      target_words INTEGER NOT NULL DEFAULT 700,
      content TEXT,
      status TEXT NOT NULL DEFAULT 'generating',
      error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_blog_posts_created ON blog_posts(created_at);

    CREATE TABLE IF NOT EXISTS image_library_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'image',
      size_bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      label TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS image_designs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      template_id TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      heading_text TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      tagline TEXT,
      accent_color TEXT NOT NULL DEFAULT '#2c6ce0',
      background_asset_id INTEGER REFERENCES image_library_assets(id) ON DELETE SET NULL,
      background_fit TEXT NOT NULL DEFAULT 'cover',
      background_offset_x REAL NOT NULL DEFAULT 0.5,
      background_offset_y REAL NOT NULL DEFAULT 0.5,
      background_zoom REAL NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_image_designs_created ON image_designs(created_at);

    CREATE TABLE IF NOT EXISTS carousel_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS carousel_slides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carousel_set_id INTEGER NOT NULL REFERENCES carousel_sets(id) ON DELETE CASCADE,
      slot_key TEXT NOT NULL DEFAULT 'default',
      slide_order INTEGER NOT NULL DEFAULT 0,
      template_id TEXT NOT NULL,
      aspect_ratio TEXT NOT NULL,
      heading_text TEXT NOT NULL DEFAULT '',
      body_text TEXT NOT NULL DEFAULT '',
      tagline TEXT,
      caption TEXT NOT NULL DEFAULT '',
      heading_font TEXT,
      body_font TEXT,
      accent_color TEXT NOT NULL DEFAULT '#2c6ce0',
      background_color TEXT,
      background_asset_id INTEGER REFERENCES image_library_assets(id) ON DELETE SET NULL,
      background_fit TEXT NOT NULL DEFAULT 'cover',
      background_offset_x REAL NOT NULL DEFAULT 0.5,
      background_offset_y REAL NOT NULL DEFAULT 0.5,
      background_zoom REAL NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_carousel_slides_set ON carousel_slides(carousel_set_id, slide_order);

    -- ============ CMS (multi-site) ============
    -- A first-class website managed by the agency. Content below is scoped by
    -- site_id. A site optionally links to a CRM clinic tenant (informational).
    CREATE TABLE IF NOT EXISTS sites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      linked_tenant_slug TEXT,
      primary_host TEXT,
      default_locale TEXT NOT NULL DEFAULT 'en',
      theme_json TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Site-scoped media library (modeled on image_library_assets).
    CREATE TABLE IF NOT EXISTS media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      alt TEXT,
      label TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_media_assets_site ON media_assets(site_id);

    -- One row per coded page-template instance per site. Drives SEO + block
    -- scoping + sitemap. template_id maps to the in-code template registry.
    CREATE TABLE IF NOT EXISTS pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      page_key TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT,
      template_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      published_at INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      show_in_sitemap INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(site_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_pages_site ON pages(site_id);

    -- Named editable slots a coded template reads. page_id NULL = site-global
    -- block (e.g. header/footer/contact line).
    CREATE TABLE IF NOT EXISTS content_blocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      page_id INTEGER REFERENCES pages(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'richtext',
      value TEXT,
      media_asset_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
      updated_by INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(site_id, page_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_content_blocks_lookup ON content_blocks(site_id, page_id, name);
    -- SQLite treats NULLs as distinct in UNIQUE, so enforce global-block
    -- uniqueness (page_id IS NULL) with a partial index.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_content_blocks_global ON content_blocks(site_id, name) WHERE page_id IS NULL;

    -- Per-page SEO metadata (1:1 with pages). Blog-post SEO lives on blog_posts.
    CREATE TABLE IF NOT EXISTS seo_meta (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      seo_title TEXT,
      seo_description TEXT,
      canonical_url TEXT,
      og_image_asset_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL,
      robots TEXT NOT NULL DEFAULT 'index,follow',
      json_ld TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(site_id, page_id)
    );

    -- "Request a new website" submissions. A request does NOT create a site;
    -- the agency reviews and fulfils it (which provisions the site).
    CREATE TABLE IF NOT EXISTS site_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_name TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      meta TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_appointments_date ON appointments(date);
    CREATE INDEX IF NOT EXISTS idx_appointments_client ON appointments(client_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_client ON sessions(client_id);
    CREATE INDEX IF NOT EXISTS idx_packages_client ON packages(client_id);
    CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id);

    -- ── Agentic OS: agent registry ──────────────────────────────────────────
    -- One row per role-based agent this tenant can run. 'instructions' is a
    -- tenant-editable custom layer over that agent's built-in system prompt;
    -- 'status' gates whether it's actually invoked (later tasks wire this up).
    CREATE TABLE IF NOT EXISTS agents (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      key           TEXT NOT NULL UNIQUE,     -- 'orchestrator'|'sales'|'seo'|'marketing'|'operations'|'finance'
      name          TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'dormant', -- 'active'|'dormant'
      instructions  TEXT NOT NULL DEFAULT '',  -- tenant-editable custom layer
      model         TEXT NOT NULL DEFAULT 'claude-sonnet-5',
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_agents_key ON agents(key);

    -- ── Agentic OS: durable runs (DR1) ───────────────────────────────────────
    -- One row per agent run on the specialist chat route
    -- (/api/agents/[key]/chat). Persists progress + the final result/pending
    -- writes so a run survives a client disconnect (refresh/navigate/close) —
    -- see src/lib/agents/runStore.ts.
    CREATE TABLE IF NOT EXISTS agent_runs (
      id              TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      agent_key       TEXT NOT NULL,
      model           TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'running',  -- 'running'|'awaiting_approval'|'done'|'error'
      text            TEXT NOT NULL DEFAULT '',
      pending         TEXT,        -- JSON PendingWrite[]
      artifacts       TEXT,        -- JSON ToolArtifact[]
      error           TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_convo ON agent_runs(conversation_id, created_at);
  `);

  // Column-add migrations for older DBs. Each runs once; PRAGMA tells us if the
  // column is already there. Wrapped in try/catch in case of weirdness. These
  // are carried over verbatim from the single-tenant schema (minus the
  // users tenancy-cols migration, which is control-plane only now).

  // Pipeline journey stage: a single mutually-exclusive funnel stage per lead.
  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(leads)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "pipeline_stage")) {
      sqlite.exec(
        "ALTER TABLE leads ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'new_lead'",
      );
      sqlite.exec(
        `UPDATE leads SET pipeline_stage = CASE status
           WHEN 'replied' THEN 'hot_lead'
           WHEN 'booked' THEN 'consultation_booked'
           WHEN 'lost' THEN 'lost'
           ELSE 'new_lead' END`,
      );
    }
  } catch (err) {
    console.error("[db] leads pipeline_stage migration failed:", err);
  }

  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(gift_vouchers)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "balance_eur")) {
      sqlite.exec(
        "ALTER TABLE gift_vouchers ADD COLUMN balance_eur REAL NOT NULL DEFAULT 0",
      );
      sqlite.exec(
        "UPDATE gift_vouchers SET balance_eur = CASE WHEN is_redeemed = 1 THEN 0 ELSE value_eur END",
      );
    }
  } catch (err) {
    console.error("[db] balance_eur migration failed:", err);
  }

  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(block_outs)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "days_of_week")) {
      sqlite.exec("ALTER TABLE block_outs ADD COLUMN days_of_week TEXT");
      sqlite.exec(
        "UPDATE block_outs SET days_of_week = CAST(day_of_week AS TEXT) WHERE type = 'recurring' AND day_of_week IS NOT NULL AND days_of_week IS NULL",
      );
    }
  } catch (err) {
    console.error("[db] days_of_week migration failed:", err);
  }

  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(gift_vouchers)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "purchaser_client_id")) {
      sqlite.exec(
        "ALTER TABLE gift_vouchers ADD COLUMN purchaser_client_id INTEGER REFERENCES clients(id)",
      );
    }
    if (!cols.find((c) => c.name === "recipient_client_id")) {
      sqlite.exec(
        "ALTER TABLE gift_vouchers ADD COLUMN recipient_client_id INTEGER REFERENCES clients(id)",
      );
    }
  } catch (err) {
    console.error("[db] gift_vouchers client-link migration failed:", err);
  }

  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(image_designs)")
      .all() as Array<{ name: string }>;
    if (cols.length > 0 && !cols.find((c) => c.name === "tagline")) {
      sqlite.exec("ALTER TABLE image_designs ADD COLUMN tagline TEXT");
    }
  } catch (err) {
    console.error("[db] image_designs tagline migration failed:", err);
  }

  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(video_assets)")
      .all() as Array<{ name: string }>;
    if (cols.length > 0 && !cols.find((c) => c.name === "rotation")) {
      sqlite.exec(
        "ALTER TABLE video_assets ADD COLUMN rotation INTEGER NOT NULL DEFAULT 0",
      );
    }
  } catch (err) {
    console.error("[db] video_assets rotation migration failed:", err);
  }

  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(carousel_slides)")
      .all() as Array<{ name: string }>;
    if (cols.length > 0 && !cols.find((c) => c.name === "caption")) {
      sqlite.exec(
        "ALTER TABLE carousel_slides ADD COLUMN caption TEXT NOT NULL DEFAULT ''",
      );
    }
    if (cols.length > 0 && !cols.find((c) => c.name === "heading_font")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN heading_font TEXT");
    }
    if (cols.length > 0 && !cols.find((c) => c.name === "body_font")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN body_font TEXT");
    }
    if (cols.length > 0 && !cols.find((c) => c.name === "background_color")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN background_color TEXT");
    }
  } catch (err) {
    console.error("[db] carousel_slides caption migration failed:", err);
  }

  // image_library_assets predates the unified media library; add the kind
  // discriminator ('image' | 'video') on older DBs (PRAGMA-guarded).
  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(image_library_assets)")
      .all() as Array<{ name: string }>;
    if (cols.length > 0 && !cols.find((c) => c.name === "kind")) {
      sqlite.exec(
        "ALTER TABLE image_library_assets ADD COLUMN kind TEXT NOT NULL DEFAULT 'image'",
      );
    }
  } catch (err) {
    console.error("[db] image_library_assets kind migration failed:", err);
  }

  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(carousel_slides)")
      .all() as Array<{ name: string }>;
    if (cols.length > 0 && !cols.find((c) => c.name === "slot_key")) {
      sqlite.exec(
        "ALTER TABLE carousel_slides ADD COLUMN slot_key TEXT NOT NULL DEFAULT 'default'",
      );
      sqlite.exec(`
        UPDATE carousel_slides
        SET slot_key = COALESCE(
          (
            SELECT template_id FROM carousel_slides AS cs
            WHERE cs.carousel_set_id = carousel_slides.carousel_set_id
            ORDER BY slide_order ASC, id ASC
            LIMIT 1
          ),
          'default'
        )
        WHERE slot_key = 'default';
      `);
    }
  } catch (err) {
    console.error("[db] carousel_slides slot_key migration failed:", err);
  }

  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(video_projects)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "plan_json")) {
      sqlite.exec("ALTER TABLE video_projects ADD COLUMN plan_json TEXT");
    }
    if (!cols.find((c) => c.name === "output_filename")) {
      sqlite.exec("ALTER TABLE video_projects ADD COLUMN output_filename TEXT");
    }
    if (!cols.find((c) => c.name === "caption_font")) {
      sqlite.exec(
        "ALTER TABLE video_projects ADD COLUMN caption_font TEXT NOT NULL DEFAULT 'Arial Black'",
      );
    }
    if (!cols.find((c) => c.name === "music_filename")) {
      sqlite.exec("ALTER TABLE video_projects ADD COLUMN music_filename TEXT");
    }
    if (!cols.find((c) => c.name === "music_volume")) {
      sqlite.exec(
        "ALTER TABLE video_projects ADD COLUMN music_volume REAL NOT NULL DEFAULT 0.2",
      );
    }
    if (!cols.find((c) => c.name === "auto_trim_silence")) {
      sqlite.exec(
        "ALTER TABLE video_projects ADD COLUMN auto_trim_silence INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!cols.find((c) => c.name === "show_intro_outro")) {
      sqlite.exec(
        "ALTER TABLE video_projects ADD COLUMN show_intro_outro INTEGER NOT NULL DEFAULT 0",
      );
    }
    if (!cols.find((c) => c.name === "intro_duration_sec")) {
      sqlite.exec(
        "ALTER TABLE video_projects ADD COLUMN intro_duration_sec REAL NOT NULL DEFAULT 1.6",
      );
    }
    if (!cols.find((c) => c.name === "timeline_json")) {
      sqlite.exec("ALTER TABLE video_projects ADD COLUMN timeline_json TEXT");
    }
  } catch (err) {
    console.error("[db] video_projects render-cols migration failed:", err);
  }

  // Venue-neutral: service capacity (1 = 1:1, >1 = class).
  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(therapies)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "capacity")) {
      sqlite.exec(
        "ALTER TABLE therapies ADD COLUMN capacity INTEGER NOT NULL DEFAULT 1",
      );
    }
  } catch (err) {
    console.error("[db] therapies capacity migration failed:", err);
  }

  // WhatsApp bridge: provider id + delivery status on lead_messages.
  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(lead_messages)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "provider_message_id")) {
      sqlite.exec(
        "ALTER TABLE lead_messages ADD COLUMN provider_message_id TEXT",
      );
    }
    if (!cols.find((c) => c.name === "status")) {
      sqlite.exec("ALTER TABLE lead_messages ADD COLUMN status TEXT");
    }
  } catch (err) {
    console.error("[db] lead_messages whatsapp-cols migration failed:", err);
  }

  // Conversation messages for clients (mirrors lead_messages).
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS client_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      direction TEXT NOT NULL,
      channel TEXT,
      content TEXT NOT NULL,
      ai_generated INTEGER NOT NULL DEFAULT 0,
      provider_message_id TEXT,
      status TEXT,
      sent_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_client_messages_client ON client_messages(client_id);
  `);

  // AI inbox: tag vocabulary + conversation tag links.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      color TEXT,
      is_core INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE IF NOT EXISTS conversation_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_type TEXT NOT NULL,
      owner_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      added_by TEXT NOT NULL DEFAULT 'ai',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      UNIQUE(owner_type, owner_id, tag_id)
    );
    CREATE INDEX IF NOT EXISTS idx_conversation_tags_owner ON conversation_tags(owner_type, owner_id);
  `);

  // AI inbox: triage columns on both message tables (added once; PRAGMA-guarded).
  for (const table of ["lead_messages", "client_messages"]) {
    try {
      const cols = sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{ name: string }>;
      const addCol = (name: string, ddl: string) => {
        if (cols.length > 0 && !cols.find((c) => c.name === name)) {
          sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
        }
      };
      addCol("ai_category", "ai_category TEXT");
      addCol("ai_priority", "ai_priority TEXT");
      addCol("ai_summary", "ai_summary TEXT");
      addCol("ai_confidence", "ai_confidence REAL");
      addCol("ai_sensitive", "ai_sensitive INTEGER");
      addCol("ai_triaged_at", "ai_triaged_at INTEGER");
      addCol(
        "auto_reply_status",
        "auto_reply_status TEXT NOT NULL DEFAULT 'none'",
      );
      addCol("ai_suggested_reply", "ai_suggested_reply TEXT");
    } catch (err) {
      console.error(`[db] ${table} triage-cols migration failed:`, err);
    }
  }

  // Venue-neutral: plan type + recurring fields on packages and templates.
  for (const table of ["packages", "package_templates"]) {
    try {
      const cols = sqlite
        .prepare(`PRAGMA table_info(${table})`)
        .all() as Array<{ name: string }>;
      if (!cols.find((c) => c.name === "plan_type")) {
        sqlite.exec(
          `ALTER TABLE ${table} ADD COLUMN plan_type TEXT NOT NULL DEFAULT 'prepaid_sessions'`,
        );
      }
      if (!cols.find((c) => c.name === "billing_interval_months")) {
        sqlite.exec(
          `ALTER TABLE ${table} ADD COLUMN billing_interval_months INTEGER`,
        );
      }
      if (!cols.find((c) => c.name === "recurring_price_eur")) {
        sqlite.exec(`ALTER TABLE ${table} ADD COLUMN recurring_price_eur REAL`);
      }
    } catch (err) {
      console.error(`[db] ${table} plan-cols migration failed:`, err);
    }
  }

  // CMS: blog_posts gains site scoping, slug/SEO, and a publish lifecycle.
  // publish_state is SEPARATE from the existing generation `status`
  // (generating|ready|failed) that runBlogGeneration writes — do not overload it.
  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(blog_posts)")
      .all() as Array<{ name: string }>;
    const addCol = (name: string, ddl: string) => {
      if (cols.length > 0 && !cols.find((c) => c.name === name)) {
        sqlite.exec(`ALTER TABLE blog_posts ADD COLUMN ${ddl}`);
      }
    };
    addCol("site_id", "site_id INTEGER REFERENCES sites(id) ON DELETE CASCADE");
    addCol("slug", "slug TEXT");
    addCol("excerpt", "excerpt TEXT");
    addCol("cover_image_url", "cover_image_url TEXT");
    addCol("cover_aspect", "cover_aspect TEXT");
    addCol("cover_position", "cover_position TEXT");
    addCol("seo_title", "seo_title TEXT");
    addCol("seo_description", "seo_description TEXT");
    addCol(
      "og_image_asset_id",
      "og_image_asset_id INTEGER REFERENCES media_assets(id) ON DELETE SET NULL",
    );
    addCol("publish_state", "publish_state TEXT NOT NULL DEFAULT 'draft'");
    addCol("published_at", "published_at INTEGER");
    addCol("scheduled_for", "scheduled_for INTEGER");
    sqlite.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_blog_posts_site_slug ON blog_posts(site_id, slug)",
    );
    sqlite.exec(
      "CREATE INDEX IF NOT EXISTS idx_blog_posts_site_status ON blog_posts(site_id, publish_state, published_at)",
    );
  } catch (err) {
    console.error("[db] blog_posts cms-cols migration failed:", err);
  }

  // Email marketing (Task 2 — contacts + suppressions + CSV import; Task 1
  // built the money side, lib/email/credits.ts). `contacts` is the tenant's
  // mailing list; `suppressions` is a hard do-not-email gate (unsubscribe/
  // bounce/complaint/manual) that import — and later, sending — must always
  // consult. Both keyed by lower(email) so case-insensitive matches can't
  // create duplicate rows. Drizzle mirror in schema.ts — same index names,
  // kept in sync.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      name TEXT, phone TEXT,
      tags TEXT,                       -- JSON string[]
      status TEXT NOT NULL DEFAULT 'subscribed', -- subscribed|unsubscribed|bounced|complained|cleaned
      source TEXT,
      subscribed_at INTEGER, unsubscribed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_email ON contacts(lower(email));
    CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);

    CREATE TABLE IF NOT EXISTS suppressions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      reason TEXT NOT NULL,            -- unsubscribe|bounce|complaint|manual
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_suppressions_email ON suppressions(lower(email));
  `);

  // Email marketing (Task 3 — CampaignSender adapter + Mailgun + sending-
  // domain connect; see lib/marketing/sender/ + lib/marketing/domains.ts).
  // One row = the tenant's one active sending domain — "one per tenant" is
  // enforced at the application layer (domains.ts's connectDomain: update-
  // if-exists, else insert), not a DB constraint: this table has no
  // tenant_id column at all (it lives inside the tenant's OWN db file, so
  // the file itself is already the tenant scope, unlike the control-plane
  // gmail_connections/imap_connections tables). Drizzle mirror in
  // schema.ts — same shape, kept in sync.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS sending_domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      mailgun_domain_id TEXT,
      state TEXT NOT NULL DEFAULT 'unverified', -- unverified|verified|failed
      dns_records TEXT,                          -- JSON {type,name,value}[]
      verified_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  // Batch 6b (improvement-plan-2026-08.md Theme E1): tracking table for the
  // versioned migration runner (./migrations) — separate from everything
  // above, which is the additive bootstrap. Created here too (in addition to
  // runMigrations() creating it defensively) so it exists alongside every
  // other tenant table from the very first open, even before the first
  // runMigrations() call.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
}
