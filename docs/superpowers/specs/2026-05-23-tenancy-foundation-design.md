# Tenancy Foundation (DB-per-tenant)

**Date:** 2026-05-23
**Status:** Design approved — spec under review
**Sub-project 2 of the ClientFlow initiative.** Turns the single-clinic app into a
multi-tenant base where each business has fully isolated data.

## Context

The app runs as one SQLite file (`data/clinic.db`) with `users`, `auth_sessions`,
`settings`, and ~22 business tables all together; ~40 files import a singleton
`db`; queries carry no tenant concept. We make it multi-tenant with the least
risk and the smallest query-layer change.

Approved decisions:
- **Isolation = DB-per-tenant** — one SQLite file per business; bulletproof
  isolation, fits SQLite, near-zero changes to existing queries.
- **Routing = login-based** — a user belongs to one business; their request opens
  that business's DB. No subdomains (later).
- Keep `clinic.db`'s data as **Renova's tenant** (no business-data migration).

## Architecture

### 1. Two databases

**Control DB** — `data/control.db`, a single fixed connection (`controlDb`). The
global registry + identity:
- `tenants`: `id`, `slug` (unique), `name`, `db_file` (path to the tenant's
  SQLite file), `is_active`, `created_at`.
- `users` (moved here — global): `id`, `email` (unique), `name`, `password_hash`,
  `role` (`admin`|`staff`), `tenant_id` (FK→tenants), `is_platform_admin`
  (boolean — super-admin), `must_change_password`, `is_active`, `last_login_at`,
  `created_at`, `updated_at`.
- `auth_sessions` (moved here — global): `id`, `user_id` (FK→users), `expires_at`,
  `created_at`.

**Tenant DBs** — `data/tenants/<slug>.db` (Renova's is the existing `clinic.db`).
Everything else: clients, therapies, appointments, sessions, packages,
package_templates, gift_vouchers, payments, **settings**, block_outs, leads,
lead_messages, client_messages, video_projects, video_assets, image_library_assets,
image_designs, carousel_sets, carousel_slides, blog_posts, activity_log. Because
`settings` lives here, per-business config (`venue_type`, `business_profile`,
`whatsapp_config`, branding logo filename) is automatically per-tenant. Branding
logo files also become per-tenant (see §7).

### 2. The `db` resolver (minimal refactor)

`src/lib/db/index.ts` is restructured:
- `controlDb` — a normal fixed better-sqlite3 + drizzle connection; control tables
  created on boot.
- `db` — exported as a **request-scoped Proxy** over drizzle. Each property access
  (`db.select`, `db.insert`, `db.run`, …) resolves the *current tenant's* drizzle
  instance and forwards. Resolution: read the session cookie → `controlDb`
  (session → user → `tenant_id`) → look up the tenant's `db_file` → return a
  cached connection. Resolution is memoised per request via React `cache()` so
  it's cheap. **All existing `import { db }` callers keep working unchanged** — no
  find/replace, no per-query `tenant_id` filters.
- `getTenantDb(tenantId)` / a `Map<tenantId, connection>` cache (better-sqlite3
  connections are cheap to keep open). `ensureTenantTables(conn)` runs the
  business-table DDL + additive migrations (the current `ensureTables` body minus
  the control tables) the first time a tenant DB is opened.
- A clear error if `db` is used with no resolvable tenant (e.g. an unauthenticated
  context) — those paths should use `controlDb` or not touch tenant data.

`schema.ts` splits conceptually into control tables (tenants, users, authSessions)
and tenant tables (the rest); both can stay in one file with the connection
deciding which apply.

### 3. Auth (now control-plane backed)

`src/lib/auth.ts` + the auth routes use `controlDb`:
- `getSessionUser()` joins `auth_sessions`→`users` in controlDb; the returned user
  includes `tenantId` + `isPlatformAdmin`.
- `createSession`/`destroySession`/login/change-password operate on controlDb.
- Page guards (`requireUserPage`, `requireAdminPage`) unchanged in behaviour.
- **Cookie rename**: `renova_session` → `clientflow_session` (constant in auth.ts +
  the check in `middleware.ts`). One-time effect: existing sessions invalidate, so
  a single re-login. No old-cookie fallback (only one user).

### 4. Tenant provisioning

`src/lib/tenants.ts`:
- `createTenant({ name, adminEmail, adminName, password })`:
  1. derive a unique `slug`,
  2. create `data/tenants/<slug>.db` + `ensureTenantTables` + seed defaults
     (the current `ensureSeed` therapy/settings seed, parameterised by connection),
  3. insert the `tenants` row,
  4. create the first admin user in controlDb (`tenant_id`, `must_change_password=1`).
- This is the primitive the **platform-admin UI (later)** will call; for now it's
  exercised via a seed/dev script. (No public route in this sub-project.)
- `listTenants()`, `getTenant(slug|id)` helpers.

### 5. Renova migration (one-time, idempotent, on boot)

In a boot routine: if `control.db` has no tenants and a legacy `clinic.db` exists:
1. create `control.db` + control tables,
2. register a `renova` tenant whose `db_file` is the existing `clinic.db` (no
   movement of business tables),
3. copy `users` + `auth_sessions` rows out of `clinic.db` into `controlDb`,
   stamping `tenant_id = renova`; set the owner (`christopher.walshe1994@…`)
   `is_platform_admin = 1`,
4. the now-unused `users`/`auth_sessions` tables inside `clinic.db` are left in
   place (harmless) — `ensureTenantTables` simply won't manage them.

Guarded so it runs exactly once.

### 6. ClientFlow rename

Cookie → `clientflow_session`. Remove residual hardcoded "Renova" **platform**
strings (the business identity is already per-tenant via the Business Profile;
the chrome wordmark is already ClientFlow). Audit for any remaining literal
platform-level "Renova".

### 7. Branding files per tenant

The branding logo currently lives at `data/branding/logo.png` (global). Move to
`data/tenants/<slug>/branding/` (or namespace the filename by tenant) so each
business's logo is isolated; `resolveLogoPath`/the upload route + `/api/branding/logo`
resolve under the current tenant. (Chrome currently shows the ClientFlow wordmark
regardless, so this mainly affects Content Studio cards — but it must be
per-tenant to avoid cross-business logo bleed.)

## Out of scope (later sub-projects)
- Platform/super-admin UI (manage, create, switch tenants), self-serve signup.
- Subdomains (needs hosting + wildcard DNS), billing, the Communication tab/email.
- A user belonging to more than one business.
- Hosting/deployment itself.

## Risks & mitigations
- **Request-scoped `db` proxy correctness**: must resolve in every Next context
  (server components, route handlers, server actions) — all have `cookies()`
  access, so resolution works; memoise with React `cache()`. Verified by booting
  and exercising representative pages/actions for two tenants.
- **Auth/data ordering**: control-plane queries (login, session) must never go
  through the tenant proxy (chicken-and-egg) — they use `controlDb` explicitly.
- **Migration safety**: idempotent + guarded; back up `clinic.db` before first
  run; the business tables are not moved, only re-pointed.
- **Connection lifecycle**: cache tenant connections; cap/evict if it ever grows
  (fine for the handful of tenants in this phase).
- **Forgotten control vs tenant**: a checklist — anything touching
  users/sessions/tenants = controlDb; everything else = `db` (tenant).

## Verification
- Renova logs in (after one re-login from the cookie rename) and **all existing
  data is intact** (it's the migrated tenant).
- `createTenant` a second test business via script → its DB is a separate file;
  logging in as its admin shows seeded/empty data, **never Renova's**; creating a
  client there does not appear in Renova and vice-versa.
- Switching the logged-in user switches the underlying DB automatically.
- Control-plane paths (login) work before any tenant is resolved.
- `npm run build` / `tsc --noEmit` clean.

## Notes
- Repo is not under git; spec saved, not committed.
- This is the data/identity layer; the platform-admin UI and onboarding flow build
  on top of `createTenant`/`listTenants` in their own sub-projects.
