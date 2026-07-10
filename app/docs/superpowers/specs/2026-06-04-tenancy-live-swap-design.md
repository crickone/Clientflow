# Tenancy Live Swap — Design (Phases 1–6)

**Date:** 2026-06-04
**Status:** proposed (rebuild of the deleted 2026-05-23 design; Phase 0 already shipped)
**Supersedes record of:** `2026-05-23-tenancy-foundation-design.md` (deleted)

## Goal

Make ClientFlow multi-tenant using **DB-per-tenant**. A `control.db` holds the tenant
registry + identity (users, auth sessions). Each business gets its own SQLite file holding
all business data. The existing Renova `clinic.db` becomes the `renova` tenant's file with
zero business-data movement. The ~52 request-scoped query files keep importing `{ db }`
unchanged — `db` becomes a request-scoped proxy that resolves the caller's tenant.

This is the **live swap** on a **production** system. Phase 0 (additive control-DB
scaffolding + `users` tenancy columns) already shipped and is verified in code.

## Architecture

### Two planes
- **Control plane** = `data/control.db` (already created on boot by `lib/db/control.ts`).
  Tables: `tenants`, `users`, `auth_sessions`. This is the auth source of truth post-swap.
- **Tenant plane** = one SQLite file per business. Renova = `data/clinic.db` (unchanged path).
  New tenants = `data/tenants/<slug>/<slug>.db`. Holds all business tables (clients,
  appointments, packages, leads, messages, content studio, etc.) — everything *except*
  users/auth_sessions.

### The `db` proxy (the core mechanism)
`lib/db/index.ts` currently exports `db = drizzle(clinicSqlite)`. After the swap it exports
a `Proxy` whose every property access resolves to **the current tenant's Drizzle instance**:

1. Read the session cookie (`cookies()` — synchronous in Next 14).
2. `controlDb`: session id → user → `user.tenant_id`.
3. `controlDb`: tenant id → `tenant.db_file`.
4. Open (or reuse from a process-level cache) the better-sqlite3 connection for that file,
   running `ensureTenantTables(sqlite)` once.
5. Return the resolved Drizzle instance's property.

Resolution is **fully synchronous** (`cookies()` and better-sqlite3 are sync), so the proxy
works with Drizzle's sync better-sqlite3 driver. Memoised per request with React `cache()`.

### No-session fallback → default tenant
Some `db` consumers have **no session cookie**: the public webhooks
(`/api/whatsapp/webhook`, `/api/leads/inbound`) are server-to-server. Middleware already
redirects every *logged-out, non-public* request to `/login`, so the only `db`-without-session
paths are these legitimately single-tenant webhooks.

**Decision:** when the proxy cannot resolve a session, it falls back to the **default tenant**
(`renova`, overridable via `DEFAULT_TENANT_SLUG`). This keeps the webhooks working unchanged
and confines real per-tenant routing to authenticated traffic. Documented limitation: true
multi-tenant webhook routing (e.g. WhatsApp number → tenant) is future work.

### Background jobs can't use the proxy
`cookies()` throws outside a request. The only timer-driven `db` consumer is the **daily
lapse recompute** (`lib/pipeline/lapse.ts`, armed by `lapseScheduler.ts`). It is refactored to
take an **explicit connection** and the scheduler iterates `listTenants()`, running the
recompute per tenant. The nightly **backup** already opens DB files by path (not the proxy),
so it needs no change for one tenant; it should eventually enumerate all tenant files (noted).

### Auth moves to controlDb
`auth.ts`, the login + change-password routes, and the settings/users management code
currently use `{ db }` against `users`/`auth_sessions`. They repoint to **`authDb`**
(= `controlDb`). The session cookie is renamed `renova_session` → `clientflow_session`
(in `auth.ts` + `middleware.ts`), which invalidates old sessions and forces **exactly one
re-login**.

### Boot migration (idempotent)
`lib/db/migrate.ts`, run once on server boot:
1. Register the `renova` tenant (`slug=renova`, `db_file=clinic.db`) if absent.
2. If `controlDb.users` is empty, copy all rows from `clinic.db.users` → `controlDb.users`,
   stamping `tenant_id = renova.id`; the owner (`christopher.walshe1994@…`) gets
   `is_platform_admin = 1`.
3. Copy any `auth_sessions` across (moot after the cookie rename, but kept clean).
Each step is existence-guarded so reboots are safe. `clinic.db.users` is **left in place**
(orphaned, not dropped) for rollback safety.

## Risks & mitigations
- **Module-load-time `db` queries** would break (no request context). Audit found none (the
  seed uses raw `sqlite`). Re-verified by a clean `build:prod`.
- **Production auth swap** — verified end-to-end locally (login, change-password, isolation
  with a 2nd tenant) *before* deploy. Backup `clinic.db.bak-20260523-235433` + nightly S3/R2
  snapshots are the safety net (repo is not under git).
- **One forced re-login** in prod — expected and communicated.
- **Default-tenant fallback** is safe only because middleware gates all logged-out app traffic;
  re-confirm that gate before deploy.

## Out of scope (this pass)
WhatsApp-number→tenant webhook routing; per-tenant backup enumeration beyond renova;
a tenant-admin UI (provisioning is a CLI script). All noted as follow-ups.
