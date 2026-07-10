# Implementation Plan — Tenancy Foundation (DB-per-tenant)

**Spec:** `docs/superpowers/specs/2026-05-23-tenancy-foundation-design.md`
**Approach:** control DB (tenants + users + sessions) + a SQLite file per business;
a request-scoped `db` proxy resolves the current tenant so the ~40 query files stay
untouched; login-based routing; Renova's `clinic.db` registered as its tenant (no
business-data movement).

**Sequencing principle:** build the control plane + per-tenant connection layer
*behind* the existing app first, migrate Renova so nothing breaks, flip auth to the
control DB, then verify isolation with a second tenant. **Back up `clinic.db`
before Phase 3.** After each phase: app boots, Renova data intact, `tsc` clean.

---

## Phase 0 — Split the DB layer: control vs tenant connections

**Objective:** introduce `controlDb` + per-tenant connection machinery without
changing app behaviour yet (Renova still the only DB).

**Files:**
- `src/lib/db/schema.ts`: keep all tables; mark which are **control** (tenants,
  users, authSessions) vs **tenant** (the rest). Add the new `tenants` table; add
  `tenantId` + `isPlatformAdmin` to `users`.
- `src/lib/db/control.ts` (new): open `data/control.db`, drizzle `controlDb`,
  `ensureControlTables()` (tenants/users/auth_sessions DDL).
- `src/lib/db/tenant.ts` (new): `Map<tenantId, connection>` cache;
  `openTenantDb(file)`; `ensureTenantTables(conn)` = the current business-table
  DDL + additive migrations (moved out of today's `ensureTables`).
- `src/lib/db/index.ts`: for now still export the existing single `db` so nothing
  breaks; add the new pieces alongside. (The proxy swap happens in Phase 2.)

**Verify:** boot; control.db created with empty tables; Renova app unchanged;
`tsc`.

---

## Phase 1 — Tenant registry + provisioning

**Objective:** create/list tenants and seed a fresh tenant DB.

**Files:**
- `src/lib/tenants.ts`: `createTenant({name,adminEmail,adminName,password})`
  (slug → `data/tenants/<slug>.db` → `ensureTenantTables` + `seedTenant(conn)` →
  insert `tenants` row → create admin user in controlDb); `listTenants()`,
  `getTenantById/Slug()`.
- `seedTenant(conn)`: the current `ensureSeed` therapy/settings defaults,
  parameterised by connection.
- `scripts/provision-tenant.mjs` (dev): CLI to create a test tenant.

**Verify:** run the script → a new `tenants/<slug>.db` exists, seeded; a `tenants`
row + admin user appear in controlDb. (Not wired to the app yet.) `tsc`.

---

## Phase 2 — Request-scoped `db` proxy

**Objective:** `db` resolves to the current tenant per request; callers unchanged.

**Files:**
- `src/lib/db/index.ts`: export `db` as a **Proxy** whose handler resolves the
  current tenant connection on each access. Resolution = `getCurrentTenantDb()`:
  read session cookie → `controlDb` (session→user→tenant_id) → `openTenantDb` →
  return connection; wrap in React `cache()` for per-request memoisation. Throw a
  clear error if no tenant resolvable.
- Keep `controlDb` exported for auth.

**Verify:** with Renova migrated (Phase 3 may need to run first in practice —
order note below), pages/actions read/write the correct tenant DB. Initially test
by pointing the proxy at Renova. `tsc`. *(Phases 2 and 3 are co-dependent: do the
Renova registration in 3 first if the proxy needs a tenant to resolve; build the
proxy code in 2, switch the app onto it after 3.)*

---

## Phase 3 — Migrate Renova + flip auth to control DB

**Objective:** existing data becomes Renova's tenant; auth runs on controlDb.

**Files:**
- `src/lib/db/migrate.ts` (new): idempotent boot routine — if controlDb has no
  tenants and `clinic.db` exists: `ensureControlTables`, register `renova` tenant
  (`db_file = data/clinic.db`), copy `users`+`auth_sessions` from clinic.db into
  controlDb stamped `tenant_id=renova`, set the owner `is_platform_admin=1`.
  **Back up `clinic.db` first.**
- `src/lib/auth.ts`: switch `getSessionUser`/`createSession`/`destroySession`/
  `requireUser*` to `controlDb`; user now carries `tenantId`/`isPlatformAdmin`.
- `src/app/api/auth/login/route.ts`, `change-password/route.ts`,
  `settings/users/*`: point at controlDb.
- `src/middleware.ts` + `auth.ts`: rename cookie `renova_session` →
  `clientflow_session`.
- Switch `db`/the app onto the proxy from Phase 2.

**Verify:** boot → migration runs once; **log in (one re-login), all Renova data
present**; create a client → lands in Renova's DB; `tsc`.

---

## Phase 4 — Per-tenant branding files

**Objective:** isolate uploaded logos per business.

**Files:**
- `src/lib/branding.ts` + `/api/branding/logo` + upload route: resolve under
  `data/tenants/<slug>/branding/` (derive slug from the current tenant). Migrate
  Renova's existing `data/branding/` into its tenant dir during boot migration.

**Verify:** Renova's logo still resolves (Content Studio cards); a second tenant's
logo is separate. `tsc`.

---

## Phase 5 — ClientFlow rename sweep

**Objective:** remove residual platform-level "Renova".

**Files:** grep for literal "Renova" outside per-tenant content (it's mostly gone —
business identity is in the Business Profile, chrome is the ClientFlow wordmark).
Fix any platform strings; confirm the cookie rename is consistent.

**Verify:** `tsc`; chrome reads ClientFlow + business name (unchanged from prior work).

---

## Phase 6 — Isolation verification

- Renova: logs in, all data intact, sends/reads as before.
- Provision a 2nd tenant (`scripts/provision-tenant.mjs`) → log in as its admin in
  a separate browser/profile → seeded/empty data, **never Renova's**; create a
  client there → not visible in Renova, and vice-versa.
- Switching users switches the underlying DB automatically.
- Login works before any tenant is resolved (control-plane path).
- `npm run build` / `tsc --noEmit` clean; remove temp scripts/routes if any.

---

## Risk notes
- **Proxy must never wrap control-plane queries** — login/session/tenant lookups
  use `controlDb` explicitly (chicken-and-egg).
- **Phases 2↔3 co-dependency**: build the proxy (2), but only switch the app onto
  it once Renova is registered (3) so there's always a tenant to resolve. Plan
  treats them as a pair.
- **Back up `clinic.db`** before the first migrated boot; migration is idempotent
  and re-points (doesn't move) business tables.
- **Connection cache** unbounded is fine for now (few tenants); add eviction later.
- Repo not under git → back up + verify per-phase before moving on.
