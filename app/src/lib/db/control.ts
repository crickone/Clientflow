import "server-only";

import Database from "better-sqlite3";
import type { Database as BetterSqlite3 } from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";

import * as schema from "./schema";
import { CONTROL_MIGRATIONS, runMigrations } from "./migrations";
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
  // Batch 6b (improvement-plan-2026-08.md Theme E1): versioned migrations for
  // schema EVOLUTION (non-additive changes), run after the additive
  // bootstrap above. See migrations/index.ts for the division of labour.
  runMigrations(sqlite, CONTROL_MIGRATIONS);
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
      -- Domain-ownership verification (P0 security sprint): a tenant admin must
      -- prove control of a hostname (DNS TXT record carrying verify_token)
      -- before public rendering honours the mapping. Unverified rows are
      -- ignored by resolveHost. verified_at IS NULL = pending.
      verify_token TEXT,
      verified_at INTEGER,
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

    -- Global Exercise Library (Task 1 — see
    -- docs/superpowers/specs/2026-08-24-global-exercise-library-design.md).
    -- Mirrors cms_library_assets' nullable-tenant_id pattern directly above:
    -- tenant_id IS NULL = GLOBAL (every tenant sees it — read via
    -- WHERE tenant_id = ? OR tenant_id IS NULL, a later task); a set
    -- tenant_id = that tenant's own private custom exercise. Same columns as
    -- the per-tenant exercise_library (schema.ts) it supersedes as the
    -- read/write surface — bootstrap-populated by the
    -- "0002-exercise-library-bootstrap" CONTROL_MIGRATIONS entry
    -- (./migrations/exerciseLibraryBootstrap.ts), which imports the Inspire
    -- tenant's curated exercises as globals + every other tenant's existing
    -- rows as their own customs. The per-tenant tables are left in place,
    -- unused, post-bootstrap (not dropped).
    CREATE TABLE IF NOT EXISTS exercise_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id),
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
    CREATE INDEX IF NOT EXISTS idx_exercise_library_tenant ON exercise_library(tenant_id);

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

    -- A tenant's connected IMAP/SMTP mailbox (generic, non-Gmail). Password
    -- stored ENCRYPTED. Parallels gmail_connections above for businesses on a
    -- non-Google mailbox (e.g. Microsoft 365, cPanel/Hostinger hosted email).
    CREATE TABLE IF NOT EXISTS imap_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      imap_host TEXT NOT NULL,
      imap_port INTEGER NOT NULL,
      imap_secure INTEGER NOT NULL DEFAULT 1,
      smtp_host TEXT NOT NULL,
      smtp_port INTEGER NOT NULL,
      smtp_secure INTEGER NOT NULL DEFAULT 1,
      username TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      from_name TEXT,
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

    -- One-time, short-lived, single-use token for the platform "Open business"
    -- login handoff (console → app — different origins, no shared cookie). Bound
    -- to a specific (user_id, tenant_id): the app's /open route trusts ONLY a
    -- valid token, never a query userId/tenantId directly. used_at is set
    -- atomically by the same UPDATE that validates the token (see
    -- consumeOpenToken in lib/platform/openToken.ts), so a token can never be
    -- replayed. Rows are opportunistically pruned once expired.
    CREATE TABLE IF NOT EXISTS platform_open_tokens (
      token      TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      used_at    INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_platform_open_tokens_expires ON platform_open_tokens(expires_at);

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

    -- Per-tenant Facebook Pages connected for the native Meta lead-gen
    -- integration (Phase 1). Control-plane, NOT the tenant DB: the leadgen
    -- webhook is a server-to-server call with no session, so it must resolve the
    -- owning tenant + Page token from the incoming page_id — exactly how api_keys
    -- routes an inbound-leads POST. One row per connected Page (page_id unique);
    -- page_access_token is a long-lived Page token (a secret — never returned to
    -- the UI or logged).
    CREATE TABLE IF NOT EXISTS facebook_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL UNIQUE,
      page_name TEXT,
      page_access_token TEXT NOT NULL,
      connected_by_user_id INTEGER,
      subscribed_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()*1000),
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_facebook_pages_page ON facebook_pages(page_id);

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

    -- Staff (operator) password resets: the users-table analogue of
    -- client_password_resets above. A single-use, expiring token bound to a
    -- users row, powering the signed-out "Forgot password?" flow on /login.
    -- Cascades away with the user.
    CREATE TABLE IF NOT EXISTS user_password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_user_password_resets_user ON user_password_resets(user_id);

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

    -- ── AI credits (prepaid overflow beyond the monthly free tranche) ─────────
    -- The €25/month free allowance (tenant_ai_cap.cap_cents, default
    -- MONTHLY_CAP_CENTS) is absorbed by the operator; usage BEYOND it is billed
    -- to this prepaid balance at raw provider cost + a small margin
    -- (getAiMarginBp). Structurally a clone of email_credits (same sparse
    -- one-row-per-tenant shape, same single-transaction balance+ledger
    -- mutation) — a tenant with no row reads as balance 0, and a €0 balance
    -- makes the whole thing behave EXACTLY like the old hard cap (over the
    -- tranche + no credits = blocked), so this ships inert until credits are
    -- granted/topped up. See @/lib/ai/creditsLedger + assertAiAllowed/
    -- meterAndCharge in @/lib/ai/usage. ai_suspended is a platform-admin kill
    -- switch independent of balance (parity with email's marketing_suspended).
    CREATE TABLE IF NOT EXISTS ai_credits (
      tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      auto_topup_enabled INTEGER NOT NULL DEFAULT 0,
      auto_topup_threshold_cents INTEGER NOT NULL DEFAULT 0,
      auto_topup_amount_cents INTEGER NOT NULL DEFAULT 0,
      ai_suspended INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Append-only audit trail of every ai_credits.balance_cents change — one
    -- row per grant/top-up/usage-debit, carrying the authoritative
    -- balance_after_cents (mirrors email_credit_ledger; no FK for the same
    -- reason — the ledger must survive tenant deletion for reconciliation).
    CREATE TABLE IF NOT EXISTS ai_credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      delta_cents INTEGER NOT NULL,
      reason TEXT NOT NULL,          -- 'topup'|'usage'|'adjustment'|'refund'|'auto_topup'
      balance_after_cents INTEGER NOT NULL,
      note TEXT,                     -- actor (grants) or context (usage: agentKey)
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_ai_credit_ledger_tenant ON ai_credit_ledger(tenant_id, created_at);

    -- ── Research spend metering (Market Research P1, Task 3) ──────────────────
    -- Per-tenant monthly spend on external data calls (Google Places/Geocoding
    -- — see @/lib/research/spend.ts), metered the same CONTROL-PLANE + month-key
    -- + cap-check contract as ai_usage above, but a SEPARATE table/ledger/cap —
    -- research spend has its own budget and must never share ai_usage's monthly
    -- total. Unlike ai_usage's insert-a-row-per-call + SUM-on-read shape, this
    -- is ONE row per (tenant, month): recordResearchSpend upserts straight into
    -- it (spent_cents += the clamped amount) — there's no per-call breakdown
    -- requirement yet (unlike ai_usage's per-agent/per-model rollups), so a
    -- single accumulator row is the simplest thing that satisfies the same
    -- "spend resets every new month" behaviour (a new yyyymm has no row -> 0).
    CREATE TABLE IF NOT EXISTS research_usage (
      tenant_id   INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      yyyymm      TEXT NOT NULL,           -- billing bucket, e.g. '2026-08'
      spent_cents INTEGER NOT NULL DEFAULT 0,
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (tenant_id, yyyymm)
    );

    -- Per-tenant override of the monthly research-spend cap — deliberately
    -- sparse, the same shape as tenant_ai_cap above: a tenant that has never
    -- customized it has NO row here and falls back to the DEFAULT
    -- (DEFAULT_RESEARCH_CAP_CENTS, €10) — see getResearchCapCents in
    -- @/lib/research/spend.ts. The setter/admin UI to write a per-tenant
    -- override is a LATER task; this table exists now purely so
    -- getResearchCapCents' read-through has somewhere to read from.
    CREATE TABLE IF NOT EXISTS tenant_research_cap (
      tenant_id  INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      cap_cents  INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- ── Email marketing credits (GHL-style add-on, Task 1: ledger + pricing) ──
    -- One sparse row per tenant that has ever had a balance or auto-topup
    -- config touched (mirrors tenant_ai_cap's sparse-override shape): a tenant
    -- with no row yet reads as balance 0 / auto-topup disabled — see
    -- getEmailBalanceCents/getAutoTopup in @/lib/email/credits. Every write to
    -- balance_cents happens inside a controlSqlite.transaction() alongside the
    -- matching email_credit_ledger row (grantCredits/recordCreditSpend) so the
    -- two can never drift apart, even under concurrent sends.
    -- marketing_suspended (Task 8): a platform-admin kill switch, independent
    -- of balance/auto-topup — set via the admin console's Suspend/Resume
    -- marketing buttons, enforced fail-closed by precheckCampaign
    -- (@/lib/marketing/send.ts) before a campaign can be sent. Column is safe
    -- to declare straight in this CREATE — nothing has been deployed to
    -- PRODUCTION yet — but any dev/test control.db that already ran
    -- ensureControlTables() under Tasks 1-7 has this table WITHOUT the
    -- column, since CREATE TABLE IF NOT EXISTS is then a no-op; see the
    -- PRAGMA-guarded ALTER TABLE further down (mirroring the other
    -- column-add migrations in this function) that backfills those.
    CREATE TABLE IF NOT EXISTS email_credits (
      tenant_id INTEGER PRIMARY KEY,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      auto_topup_enabled INTEGER NOT NULL DEFAULT 0,
      auto_topup_threshold_cents INTEGER NOT NULL DEFAULT 0,
      auto_topup_amount_cents INTEGER NOT NULL DEFAULT 0,
      marketing_suspended INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Append-only audit trail of every email_credits.balance_cents change —
    -- see the Drizzle def (emailCreditLedger) in ./schema.ts for the fuller
    -- rationale (why no FK, why balance_after_cents is authoritative).
    CREATE TABLE IF NOT EXISTS email_credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      delta_cents INTEGER NOT NULL,
      reason TEXT NOT NULL,          -- 'topup'|'send'|'adjustment'|'refund'|'auto_topup'
      campaign_id INTEGER,
      balance_after_cents INTEGER NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_email_credit_ledger_tenant ON email_credit_ledger(tenant_id, created_at);

    -- ── Paid add-ons (Voice Agent and whatever follows) ───────────────────────
    -- The platform sells ONE base plan (billing/settings.ts monthly_price_cents)
    -- plus zero or more per-tenant add-ons. Deliberately NOT a "plan"/"tier"
    -- column: tiers are a packaging decision that can be expressed later as a
    -- named bundle of these rows, whereas an entitlement (does THIS tenant have
    -- voice?) is what the runtime actually has to answer on every call.
    --
    -- status is the whole state machine:
    --   'trial'     — entitled, NOT invoiced (the free-minutes evaluation)
    --   'active'    — entitled AND invoiced at price_cents every renewal
    --   'cancelled' — not entitled, not invoiced (row kept for history)
    -- See @/lib/billing/addons: isAddonEnabled() = trial|active (the runtime
    -- gate), billableAddons() = active only (what ensureInvoice charges for).
    --
    -- price_cents is FROZEN per tenant at activation time (copied from
    -- ADDON_CATALOG's default, admin-overridable) rather than read live from a
    -- global setting: a price change must never silently re-price the tenants
    -- already on the add-on, the same reason billing_invoices stores its own
    -- vat_rate_bp instead of re-reading it.
    CREATE TABLE IF NOT EXISTS tenant_addons (
      tenant_id    INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      addon_key    TEXT NOT NULL,           -- 'voice' (see ADDON_CATALOG)
      status       TEXT NOT NULL DEFAULT 'active',  -- 'trial'|'active'|'cancelled'
      price_cents  INTEGER NOT NULL,
      activated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      cancelled_at INTEGER,
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (tenant_id, addon_key)
    );

    -- Per-invoice breakdown: one row per charged component (base plan + each
    -- active add-on). Written ONCE, by ensureInvoice, and only when it actually
    -- inserted the invoice — an invoice's composition is a historical record and
    -- must not shift because an add-on was activated later in the period.
    -- Invoices raised BEFORE this table existed have no lines at all; readers
    -- (the console, the invoice email) fall back to the invoice's own net_cents
    -- as a single implicit base line — see listInvoiceLines in billing/engine.
    -- addon_key is '' (not NULL) for the base line purely so the UNIQUE index
    -- below works without a COALESCE expression index.
    CREATE TABLE IF NOT EXISTS billing_invoice_lines (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id  INTEGER NOT NULL,
      kind        TEXT NOT NULL,           -- 'base' | 'addon'
      addon_key   TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      net_cents   INTEGER NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_lines_unique
      ON billing_invoice_lines(invoice_id, kind, addon_key);
    CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice ON billing_invoice_lines(invoice_id);

    -- ── Email: monthly included sends (the free tranche) ──────────────────────
    -- The base plan includes N recipient-sends per month (EMAIL_INCLUDED_KEY,
    -- default 5000) absorbed by the operator; only sends BEYOND that hit the
    -- prepaid email_credits balance. Structurally research_usage's shape (ONE
    -- accumulator row per tenant+month, upserted) rather than ai_usage's
    -- row-per-call + SUM-on-read: a campaign send has no per-call breakdown
    -- requirement, and "the allowance resets every month" falls out of a new
    -- yyyymm simply having no row yet.
    CREATE TABLE IF NOT EXISTS email_usage (
      tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      yyyymm     TEXT NOT NULL,            -- billing bucket, e.g. '2026-09'
      sent_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (tenant_id, yyyymm)
    );

    -- Sparse per-tenant override of the monthly included-sends allowance —
    -- same shape and reasoning as tenant_ai_cap: no row = the global default.
    CREATE TABLE IF NOT EXISTS tenant_email_included (
      tenant_id      INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      included_sends INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- ── Voice agent: usage, cap, prepaid credits ──────────────────────────────
    -- Billed per MINUTE (billed_minutes, each call rounded up — see
    -- @/lib/voice/pricing), so the monthly included-minutes tranche and the
    -- credit debit both work off billed_minutes; seconds is carried purely for
    -- honest reporting ("you talked for 4m12s" vs "you were billed 5 minutes").
    CREATE TABLE IF NOT EXISTS voice_usage (
      tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      yyyymm        TEXT NOT NULL,
      seconds       INTEGER NOT NULL DEFAULT 0,
      billed_minutes INTEGER NOT NULL DEFAULT 0,
      cost_cents    INTEGER NOT NULL DEFAULT 0,
      calls         INTEGER NOT NULL DEFAULT 0,
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (tenant_id, yyyymm)
    );

    -- Sparse per-tenant override of the monthly voice SPEND cap (default
    -- DEFAULT_VOICE_CAP_CENTS, €150) — the runaway-dialler backstop, same
    -- sparse shape as tenant_ai_cap / tenant_research_cap.
    CREATE TABLE IF NOT EXISTS tenant_voice_cap (
      tenant_id  INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      cap_cents  INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    -- Prepaid voice credits — the third instance of the email_credits /
    -- ai_credits shape, and the reason the read-compute-write-in-one-
    -- transaction invariant now lives in ONE place (@/lib/billing/prepaidLedger)
    -- that all three delegate to instead of a third hand-rolled copy.
    -- trial_seconds_used tracks the one-off free evaluation minutes (they do
    -- NOT reset monthly, unlike the included-minutes tranche) and is the only
    -- column here with no counterpart in the other two tables.
    CREATE TABLE IF NOT EXISTS voice_credits (
      tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      balance_cents INTEGER NOT NULL DEFAULT 0,
      auto_topup_enabled INTEGER NOT NULL DEFAULT 0,
      auto_topup_threshold_cents INTEGER NOT NULL DEFAULT 0,
      auto_topup_amount_cents INTEGER NOT NULL DEFAULT 0,
      voice_suspended INTEGER NOT NULL DEFAULT 0,
      trial_seconds_used INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS voice_credit_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL,
      delta_cents INTEGER NOT NULL,
      reason TEXT NOT NULL,          -- 'topup'|'usage'|'adjustment'|'refund'|'auto_topup'
      balance_after_cents INTEGER NOT NULL,
      note TEXT,                     -- actor (grants) or context (usage: call ref)
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_voice_credit_ledger_tenant ON voice_credit_ledger(tenant_id, created_at);

    -- Maps a provider conversation id -> the tenant (and call row) that owns
    -- it. The post-call webhook is a server-to-server callback with NO session
    -- cookie, so the tenant CANNOT be resolved from the request; without this
    -- index the only alternative is opening every tenant DB and guessing,
    -- which is exactly the fail-open tenant resolution the 2026-08 hardening
    -- pass removed. Written at dial time, inside the same request that creates
    -- the call row. An unknown conversation id is ignored (never a default
    -- tenant), which is what makes the webhook fail CLOSED.
    CREATE TABLE IF NOT EXISTS voice_call_index (
      provider_call_id TEXT PRIMARY KEY,
      tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      call_id    INTEGER NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);

  // Existing control DBs predate site_domains.verify_token/verified_at. The
  // CREATE above only applies to fresh installs, so add them once on older DBs
  // (PRAGMA-guarded). Rows that already exist were mapped by the operator
  // before verification existed — grandfather them as verified AT MIGRATION
  // TIME ONLY (inside this branch), so live client sites don't drop offline;
  // every row added after this migration starts unverified.
  try {
    const cols = controlSqlite
      .prepare("PRAGMA table_info(site_domains)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "verified_at")) {
      controlSqlite.exec("ALTER TABLE site_domains ADD COLUMN verify_token TEXT");
      controlSqlite.exec("ALTER TABLE site_domains ADD COLUMN verified_at INTEGER");
      controlSqlite
        .prepare("UPDATE site_domains SET verified_at = ? WHERE verified_at IS NULL")
        .run(Date.now());
    }
  } catch (err) {
    console.error("[control] site_domains verification migration failed:", err);
  }

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

  // Existing control DBs may predate email_credits.marketing_suspended (Task
  // 8 — added after Tasks 1-7 already shipped email_credits without it, so
  // any DB that ran ensureControlTables before this change has the table but
  // not the column). The CREATE above only applies to fresh installs, so add
  // it once on older DBs (PRAGMA-guarded, mirroring the migrations above).
  try {
    const cols = controlSqlite
      .prepare("PRAGMA table_info(email_credits)")
      .all() as Array<{ name: string }>;
    if (!cols.find((c) => c.name === "marketing_suspended")) {
      controlSqlite.exec(
        "ALTER TABLE email_credits ADD COLUMN marketing_suspended INTEGER NOT NULL DEFAULT 0",
      );
    }
  } catch (err) {
    console.error(
      "[control] email_credits marketing_suspended migration failed:",
      err,
    );
  }

  // Batch 6b (improvement-plan-2026-08.md Theme E1): tracking table for the
  // versioned migration runner (./migrations) — separate from everything
  // above, which is the additive bootstrap. Created here too (in addition to
  // runMigrations() creating it defensively) so it exists alongside every
  // other control table from the very first open, even before the first
  // runMigrations() call.
  controlSqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pure decision helper for a WEEKLY (rather than shouldRunToday's daily)
 * cron_state guard: given the ISO timestamp a job last completed for some
 * key — or `null` if it never has — is a new run due (>= 7 days elapsed)?
 * Introduced for Task 9 of Market Research P1 (the weekly per-tenant
 * competitor refresh, lib/automations/scheduler.ts), but kept free of any
 * research-specific naming/DB access so it's a generic weekly-cadence
 * counterpart to shouldRunToday — trivially unit-testable (isWeeklyDue.test.ts)
 * and safe to reuse for any future weekly (rather than daily) scheduled task.
 *
 * ISO timestamps rather than shouldRunToday's YYYY-MM-DD calendar date,
 * because a weekly gate needs true elapsed time, not a calendar-day
 * comparison: two date-strings 7 calendar days apart are always >= 7 days
 * apart, but a job that last ran at 23:59 one Monday and ticks again at
 * 00:01 the following Monday has NOT actually waited 7 days.
 *
 * An unparsable `lastRunIso` (corrupt/legacy value) fails OPEN — returns
 * true — same "never permanently wedge a background job" philosophy as
 * this file's other guards; a job that can't tell how long it's been
 * waiting should run rather than silently stay stuck forever.
 */
export function isWeeklyDue(lastRunIso: string | null, nowIso: string): boolean {
  if (!lastRunIso) return true;
  const last = Date.parse(lastRunIso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(last) || Number.isNaN(now)) return true;
  return now - last >= WEEK_MS;
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
