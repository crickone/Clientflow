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
 * Thrown when the request-scoped `db` proxy is touched with no resolvable
 * tenant. This is the FAIL-CLOSED replacement for the old default-tenant
 * fallback, which silently pointed unresolved requests at the original
 * (renova) tenant's live DB — any handler that forgot its auth guard exposed
 * one business's data to another. Now such a request throws instead.
 */
export class TenantResolutionError extends Error {
  constructor(message = "[tenant] no tenant resolved for this request") {
    super(message);
    this.name = "TenantResolutionError";
  }
}

/**
 * Resolve + AUTHORIZE the active tenant for a coach session: auto-resolves a
 * session that never picked a tenant when the user has exactly one active
 * membership (0 or >1 → null), then validates a LIVE membership in the target
 * tenant (revoked access → null, even if session.active_tenant_id still points
 * there). The single shared implementation behind BOTH getCurrentMembership
 * (lib/auth) and the db-proxy resolution below — previously duplicated, and
 * any drift between the two meant requireUser() could pass as tenant B while
 * the proxy resolved a different tenant.
 */
export function resolveSessionTenant(
  userId: number,
  activeTenantId: number | null,
): { tenantId: number; role: "admin" | "staff" } | null {
  let tid = activeTenantId;
  if (tid == null) {
    const ms = controlDb
      .select({ tenantId: schema.memberships.tenantId })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.userId, userId),
          eq(schema.memberships.isActive, true),
        ),
      )
      .all();
    if (ms.length !== 1) return null;
    tid = ms[0].tenantId;
  }
  const m = controlDb
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.userId, userId),
        eq(schema.memberships.tenantId, tid),
        eq(schema.memberships.isActive, true),
      ),
    )
    .get();
  if (!m) return null;
  return { tenantId: tid, role: m.role };
}

/**
 * The current request's tenant, or NULL when none is resolvable — never a
 * default. Resolution order: runWithTenant context → coach session (with live
 * membership + tenant.isActive validation) → client-app session (with
 * tenant.isActive validation). Chrome that legitimately renders without a
 * tenant (login, select-account, invite pages) uses this and branches on null;
 * data paths use getCurrentTenant() below, which throws instead.
 */
export const resolveCurrentTenant = cache((): schema.Tenant | null => {
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
    // tenant context. Fail loud rather than silently writing to another
    // tenant's DB. `next build` static generation also runs outside a request —
    // let it resolve to null (getCurrentTenant substitutes a build-only stub).
    if (process.env.NEXT_PHASE !== "phase-production-build") {
      throw new Error(
        "[tenant] the request-scoped `db` was accessed outside a request " +
          "without a tenant context. A background job must run inside " +
          "runWithTenant(tenantId, …) or use getTenantDbById(id).",
      );
    }
    return null;
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
      const resolved = resolveSessionTenant(row.userId, row.activeTenantId);
      if (resolved) {
        const t = getTenantById(resolved.tenantId);
        // Deactivated tenant fails closed here too — matching
        // getCurrentMembership, which already refused it for authorization.
        if (t && t.isActive) return t;
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
      if (t && t.isActive) return t;
    }
  }

  return null;
});

/**
 * The current request's tenant — THROWS (TenantResolutionError) when none is
 * resolvable. There is deliberately no default-tenant fallback: an unresolved
 * or forged session must never be routed to a real tenant's data. Public
 * server-to-server entry points (webhooks, cron, public sites, unsubscribe)
 * never rely on this — they bind their tenant explicitly via
 * runWithTenant/getTenantDbById after their own verification.
 */
export const getCurrentTenant = cache(() => {
  const t = resolveCurrentTenant();
  if (t) return t;

  // `next build` static generation runs outside any request; give it an inert
  // stub so build-time module evaluation that touches `db` doesn't explode.
  // Never reachable at runtime (NEXT_PHASE is only set during the build).
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return {
      id: 0,
      slug: DEFAULT_TENANT_SLUG,
      name: "Default",
      dbFile: "clinic.db",
      isActive: true,
      createdAt: new Date(),
    };
  }

  throw new TenantResolutionError();
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

    -- exercise_id on workout_exercises/workout_items/circuit_items below is a
    -- plain nullable INTEGER, deliberately with NO FK — it's a SOFT reference
    -- into the CONTROL-plane exercise_library (global + per-tenant customs;
    -- see control.ts), not this tenant DB's own (legacy) exercise_library
    -- table above. A cross-DB FK isn't expressible in SQLite anyway, and it's
    -- already soft in practice: items denormalize name/muscle_groups and
    -- render never re-queries the library. Existing tenants get this via the
    -- "0003-drop-exercise-id-fk" TENANT_MIGRATIONS entry (./migrations);
    -- fresh tenants get it directly, right here [GEL T4].
    CREATE TABLE IF NOT EXISTS workout_exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL REFERENCES workout_days(id) ON DELETE CASCADE,
      section TEXT NOT NULL DEFAULT 'workout',
      exercise_id INTEGER,
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

    -- exercise_id: soft cross-DB reference, no FK — see workout_exercises above.
    CREATE TABLE IF NOT EXISTS workout_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
      section TEXT NOT NULL DEFAULT 'workout',
      exercise_id INTEGER,
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

    -- exercise_id: soft cross-DB reference, no FK — see workout_exercises above.
    CREATE TABLE IF NOT EXISTS circuit_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      circuit_id INTEGER NOT NULL REFERENCES circuits(id) ON DELETE CASCADE,
      exercise_id INTEGER,
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

    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      colour TEXT NOT NULL,
      position INTEGER NOT NULL,
      role TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_role ON pipeline_stages(role);

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
      show_logo INTEGER NOT NULL DEFAULT 1,
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
      image_status TEXT,
      image_prompt TEXT,
      image_error TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_carousel_slides_set ON carousel_slides(carousel_set_id, slide_order);

    -- ── Campaign Engine (Slice 1) ────────────────────────────────────────────
    -- Seasonal campaign kit the Marketing agent builds one artifact at a time.
    -- campaigns is the kit container; campaign_assets is one row per artifact
    -- (offer/blog/social/email/ad_copy/video_script), ordered by sort_order.
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      season TEXT,
      starts_on TEXT,
      ends_on TEXT,
      offer TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'building',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS campaign_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      external_kind TEXT,
      external_id INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_campaign_assets_campaign ON campaign_assets(campaign_id, sort_order);

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
    const cols = sqlite.prepare("PRAGMA table_info(leads)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "stage_id")) {
      sqlite.exec("ALTER TABLE leads ADD COLUMN stage_id INTEGER REFERENCES pipeline_stages(id)");
    }
  } catch (err) {
    console.error("[db] leads stage_id migration failed:", err);
  }

  // Campaign Engine (Slice 5): manual ad-spend input the CFA/ROAS scoreboard
  // computes from. Additive/idempotent like every guard in this block.
  try {
    const campCols = sqlite
      .prepare("PRAGMA table_info(campaigns)")
      .all() as Array<{ name: string }>;
    if (!campCols.some((c) => c.name === "ad_spend_cents")) {
      sqlite.exec("ALTER TABLE campaigns ADD COLUMN ad_spend_cents INTEGER NOT NULL DEFAULT 0");
    }
  } catch (err) {
    console.error("[db] campaigns ad_spend_cents migration failed:", err);
  }

  // Campaign Engine (this task): landing-page view counter, bumped by the
  // public campaign landing route once per genuinely-served render. Additive/
  // idempotent like every guard in this block.
  try {
    const campViewCols = sqlite
      .prepare("PRAGMA table_info(campaigns)")
      .all() as Array<{ name: string }>;
    if (!campViewCols.some((c) => c.name === "landing_views")) {
      sqlite.exec("ALTER TABLE campaigns ADD COLUMN landing_views INTEGER NOT NULL DEFAULT 0");
    }
  } catch (err) {
    console.error("[db] campaigns landing_views migration failed:", err);
  }

  // Agent tool-access toggles: a JSON array of tool names the agent may NOT use
  // (the disabled set). Null = nothing disabled = every tool on. Additive/
  // idempotent like every guard in this block. See agents.disabledTools
  // (schema.ts) + parseDisabledTools (@/lib/agents/registry).
  try {
    const agentCols = sqlite
      .prepare("PRAGMA table_info(agents)")
      .all() as Array<{ name: string }>;
    if (!agentCols.some((c) => c.name === "disabled_tools")) {
      sqlite.exec("ALTER TABLE agents ADD COLUMN disabled_tools TEXT");
    }
  } catch (err) {
    console.error("[db] agents disabled_tools migration failed:", err);
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

  // Carousel AI-imagery + logo columns (2026-08-17): additive, nullable/defaulted.
  try {
    const cols = sqlite
      .prepare("PRAGMA table_info(carousel_slides)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "image_status")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN image_status TEXT");
    }
    if (!cols.find((c) => c.name === "image_prompt")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN image_prompt TEXT");
    }
    if (!cols.find((c) => c.name === "image_error")) {
      sqlite.exec("ALTER TABLE carousel_slides ADD COLUMN image_error TEXT");
    }
    const setCols = sqlite
      .prepare("PRAGMA table_info(carousel_sets)")
      .all() as Array<{ name: string }>;
    if (!setCols.find((c) => c.name === "show_logo")) {
      sqlite.exec(
        "ALTER TABLE carousel_sets ADD COLUMN show_logo INTEGER NOT NULL DEFAULT 1",
      );
    }
  } catch (err) {
    console.error("[db] carousel imagery migration failed:", err);
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

  // Email marketing (Task 4 — campaign model + builder + AI draft; see
  // lib/marketing/campaigns.ts + lib/ai/draftCampaign.ts). email_campaigns is
  // one row per campaign; body_html stores the RAW body (plain text/light
  // markup) — the later throttled-send task (Task 5+) is what wraps it via
  // textToParagraphs -> renderEmailShell at send time, so it stays editable
  // here. `cursor` is that later task's resume offset and `stats` its JSON
  // counts blob — both inert until then. Draft-only editing is enforced at
  // the application layer (campaigns.ts's updateCampaign), not a DB
  // constraint. campaign_sends is the per-recipient send record that same
  // later task will populate; provider_message_id is how Task 7's webhook
  // resolves an inbound Mailgun event back to a row (hence the index).
  // Neither table declares a foreign key on campaign_id/contact_id/
  // created_by — kept verbatim to the brief's DDL rather than "fixing" it
  // (created_by points at a control-plane users.id, which can't be a real
  // FK from this tenant-plane file anyway; same "follow the literal DDL"
  // precedent Task 1 documented for its own ledger tables). Drizzle mirror
  // in schema.ts — same shape + index names, kept in sync.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS email_campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL, subject TEXT NOT NULL, preheader TEXT,
      from_name TEXT NOT NULL, from_email TEXT NOT NULL,
      body_html TEXT NOT NULL,
      audience TEXT NOT NULL,           -- JSON {kind:'all_subscribed'} | {kind:'tag', tag:'...'}
      status TEXT NOT NULL DEFAULT 'draft', -- draft|sending|sent|paused|failed
      cursor INTEGER NOT NULL DEFAULT 0, -- resume offset for throttled send
      stats TEXT,                        -- JSON counts
      scheduled_at INTEGER, sent_at INTEGER,
      created_by INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE TABLE IF NOT EXISTS campaign_sends (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL, contact_id INTEGER, email TEXT NOT NULL,
      provider_message_id TEXT,
      status TEXT NOT NULL DEFAULT 'queued', -- queued|sent|delivered|bounced|complained|opened|clicked|unsubscribed|failed
      error TEXT, updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_sends_campaign ON campaign_sends(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_campaign_sends_msgid ON campaign_sends(provider_message_id);
    -- Review fix (Task 5): guards against a racing double-send (two
    -- overlapping runCampaignSend invocations) writing two campaign_sends
    -- rows — and so double-charging — for the same recipient. send.ts's
    -- insert uses onConflictDoNothing() against this. Same index name as
    -- schema.ts's Drizzle mirror — kept in sync.
    CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_sends_unique ON campaign_sends(campaign_id, contact_id);
  `);

  // Market Research P1 (Task 4 — competitor watchlist + weekly metrics +
  // review sample + change feed; see lib/research/store.ts). `competitors`
  // is tenant-wide for now (site_id reserved, always null in P1 — multi-site
  // scoping is a later task). `place_id` is unique per tenant so a refresh
  // upserts the same row instead of duplicating it (store.ts's
  // upsertCompetitor). The three detail tables hang off competitors.id by
  // plain integer, no enforced FK — same "follow the literal DDL" precedent
  // as campaign_sends/email_campaigns above. Timestamp columns are ISO TEXT
  // (not this function's usual integer ms) to match the research module's
  // own convention (places.ts's ReviewLite.publishedAt is Google's raw ISO
  // string) — see schema.ts's Drizzle mirror for the full rationale. Ratings
  // are `rating_milli` (rating * 1000, INTEGER) so they sort/compare exactly
  // instead of drifting through float rounding. Drizzle mirror in
  // schema.ts — same shape + index names, kept in sync.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS competitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      site_id INTEGER,
      place_id TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      distance_km REAL NOT NULL,
      source TEXT NOT NULL DEFAULT 'google',
      tracked INTEGER NOT NULL DEFAULT 1,
      muted INTEGER NOT NULL DEFAULT 0,
      themes_json TEXT,
      themes_at TEXT,
      added_by TEXT NOT NULL DEFAULT 'auto',
      first_seen_at TEXT NOT NULL,
      last_refreshed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_competitors_place_id ON competitors(place_id);
    CREATE INDEX IF NOT EXISTS idx_competitors_distance ON competitors(distance_km);

    CREATE TABLE IF NOT EXISTS competitor_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competitor_id INTEGER NOT NULL,
      captured_at TEXT NOT NULL,
      rating_milli INTEGER,
      review_count INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_competitor_metrics_competitor ON competitor_metrics(competitor_id, captured_at);

    CREATE TABLE IF NOT EXISTS competitor_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competitor_id INTEGER NOT NULL,
      external_review_id TEXT NOT NULL,
      author TEXT NOT NULL,
      rating_milli INTEGER,
      text TEXT NOT NULL,
      published_at TEXT,
      captured_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_competitor_reviews_competitor ON competitor_reviews(competitor_id);

    CREATE TABLE IF NOT EXISTS competitor_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competitor_id INTEGER,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail_json TEXT,
      occurred_at TEXT NOT NULL,
      seen INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_competitor_events_occurred ON competitor_events(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_competitor_events_seen ON competitor_events(seen);
  `);

  // Market Research P1.1: `is_self` flags the tenant's OWN gym among its
  // discovered competitors (see lib/research/discovery.ts's isSameBusiness)
  // so it can be excluded from competitor ranking/highlights and shown
  // separately as a "Your gym" reference. Column-add migration, PRAGMA-
  // guarded + idempotent like every other one in this function — runs once;
  // a rerun sees the column already there and no-ops. Drizzle mirror in
  // schema.ts.
  try {
    const cols = sqlite.prepare("PRAGMA table_info(competitors)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "is_self")) {
      sqlite.exec("ALTER TABLE competitors ADD COLUMN is_self INTEGER NOT NULL DEFAULT 0");
    }
  } catch (err) {
    console.error("[db] competitors is_self migration failed:", err);
  }

  // Market Research P2 (Task 3 — competitor ads; see lib/research/store.ts's
  // upsertAd/listAds/activeAdIds/markAdsStopped). `ad_id` (Meta's
  // ads_archive id) is unique PER COMPETITOR — the composite unique index
  // below, not a unique column on ad_id alone — so a refresh upserts the
  // same row instead of duplicating it. No enforced FK on competitor_id,
  // same "follow the literal DDL" precedent as the P1 tables above.
  // Timestamp columns are ISO TEXT to match the P1 research tables'
  // convention. Drizzle mirror in schema.ts — same shape + index names, kept
  // in sync.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS competitor_ads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competitor_id INTEGER NOT NULL,
      ad_id TEXT NOT NULL,
      bodies TEXT NOT NULL DEFAULT '[]',
      link_title TEXT,
      link_caption TEXT,
      platforms TEXT NOT NULL DEFAULT '[]',
      snapshot_url TEXT NOT NULL,
      started_at TEXT,
      stopped_at TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      image_url TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_competitor_ads_competitor_ad ON competitor_ads(competitor_id, ad_id);
    CREATE INDEX IF NOT EXISTS idx_competitor_ads_competitor ON competitor_ads(competitor_id);
  `);

  // Market Research P2 (Task 3, for Task 5): `ad_angle_json`/`ad_angle_at`
  // cache the AI-derived ad-angle summary on the owning competitor row —
  // same role as themes_json/themes_at above, for ads instead of reviews.
  // Column-add migration, PRAGMA-guarded + idempotent like is_self above;
  // runs once, a rerun sees both columns already there and no-ops. Drizzle
  // mirror in schema.ts.
  try {
    const cols = sqlite.prepare("PRAGMA table_info(competitors)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("ad_angle_json")) {
      sqlite.exec("ALTER TABLE competitors ADD COLUMN ad_angle_json TEXT");
    }
    if (!colNames.has("ad_angle_at")) {
      sqlite.exec("ALTER TABLE competitors ADD COLUMN ad_angle_at TEXT");
    }
  } catch (err) {
    console.error("[db] competitors ad_angle migration failed:", err);
  }

  // Advertiser-page-match fix: `page_name`/`page_id` on competitor_ads are
  // the advertiser Meta actually attributes each ad to (ads_archive's
  // page_name/page_id fields) — see lib/research/adPageMatch.ts's module doc
  // for the bug this closes (search_terms matches ad COPY, not the
  // advertiser, so an unrelated business's ad could ride along on a shared
  // word). Column-add migration, PRAGMA-guarded + idempotent like is_self/
  // ad_angle_json above; runs once, a rerun sees both columns already there
  // and no-ops. Additive + nullable: a pre-existing competitor_ads row
  // (written before this migration ran) reads back with page_name/page_id
  // NULL, which lib/research/store.ts's toStoredAd defaults to "" — it just
  // won't pass adPageMatchesCompetitor's filter until the next rescan
  // re-upserts it with a real page_name, same as any other stale cache would
  // be. Drizzle mirror in schema.ts.
  try {
    const cols = sqlite.prepare("PRAGMA table_info(competitor_ads)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("page_name")) {
      sqlite.exec("ALTER TABLE competitor_ads ADD COLUMN page_name TEXT");
      // One-time cleanup: every competitor_ads row that existed BEFORE this
      // column was added predates the advertiser-page-match filter, i.e. was
      // stored by the old search_terms-matches-ad-COPY path that let unrelated
      // advertisers' ads ride along (the Fitbit/Garmin/Taekwon-Do false
      // positives). They all read back with page_name NULL and would otherwise
      // linger (as dimmed "stopped" ads after the next rescan diffs them out).
      // Purge them so the gallery, the "Advertising" pill count, and the AI
      // ad-angle all rebuild clean from the next rescan — competitor_ads is
      // refetchable cache (a free Ad Library re-fetch repopulates it, now
      // page-matched). No incoming FK references this table, so this is safe.
      // Guarded by the page_name-absence check, so it runs exactly once.
      sqlite.exec("DELETE FROM competitor_ads WHERE page_name IS NULL");
    }
    if (!colNames.has("page_id")) {
      sqlite.exec("ALTER TABLE competitor_ads ADD COLUMN page_id TEXT");
    }
  } catch (err) {
    console.error("[db] competitor_ads page_name/page_id migration failed:", err);
  }

  // Exact Page-ID ad matching (Task 1): `facebook_page_id`/`facebook_page_name`
  // on `competitors` let an operator link a competitor to a specific Meta
  // Page (Task 2's admin UI sets these via lib/research/store.ts's
  // setCompetitorFacebookPage/clearCompetitorFacebookPage). When set,
  // refresh.ts fetches that competitor's ads via searchCompetitorAdsByPageId
  // (search_page_ids — exact, no name-text matching) instead of the
  // search_terms + adPageMatchesCompetitor filter path. Column-add
  // migration, PRAGMA-guarded + idempotent like is_self/ad_angle_json
  // above; runs once, a rerun sees both columns already there and no-ops.
  // Additive + nullable: every pre-existing competitor reads back
  // NULL/NULL (unlinked) and behaves exactly as it did before this task.
  // Drizzle mirror in schema.ts.
  try {
    const cols = sqlite.prepare("PRAGMA table_info(competitors)").all() as Array<{ name: string }>;
    const colNames = new Set(cols.map((c) => c.name));
    if (!colNames.has("facebook_page_id")) {
      sqlite.exec("ALTER TABLE competitors ADD COLUMN facebook_page_id TEXT");
    }
    if (!colNames.has("facebook_page_name")) {
      sqlite.exec("ALTER TABLE competitors ADD COLUMN facebook_page_name TEXT");
    }
  } catch (err) {
    console.error("[db] competitors facebook_page migration failed:", err);
  }

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
