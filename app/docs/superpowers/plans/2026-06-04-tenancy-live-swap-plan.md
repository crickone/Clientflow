# Tenancy Live Swap — Plan (Phases 1–6)

**Date:** 2026-06-04
**Design:** `docs/superpowers/specs/2026-06-04-tenancy-live-swap-design.md`
**Precondition:** Phase 0 shipped (control.db + `users` tenancy columns). Verified in code.

Each phase ends with `tsc` clean. The big local gate is Phase 6 (isolation proof) before any
prod deploy (Phase 7).

---

## Phase 1 — Tenant registry helpers + provisioning CLI
**Files:** `src/lib/tenants.ts` (new), `scripts/provision-tenant.mjs` (new)
- `listTenants()`, `getTenantBySlug(slug)`, `getTenantById(id)` against `controlDb`.
- `createTenant({ slug, name })` → create `data/tenants/<slug>/<slug>.db`, run
  `ensureTenantTables` + `seedTenant` (business defaults only — therapies, settings, core
  tags; **no user**), insert the `tenants` row. Returns the tenant.
- `seedTenant(sqlite)` — extracted business seed (the non-user half of today's `ensureSeed`).
- CLI: `node scripts/provision-tenant.mjs --slug=<> --name="<>"`.
- *(Depends on Phase 2's `ensureTenantTables`/`openTenantDb`; build P2 first, wire P1 after.)*

## Phase 2 — Per-tenant connections + the `db` proxy
**Files:** `src/lib/db/tenant.ts` (new), `src/lib/db/index.ts` (rewrite of `db` export)
- Extract the business DDL + column migrations from `index.ts` `ensureTables()` into
  `ensureTenantTables(sqlite)` in `tenant.ts` — **minus** `users`/`auth_sessions` (control-only).
- `openTenantDb(dbFile)` → resolve path (renova → `data/clinic.db`; else `data/tenants/...`),
  open better-sqlite3, set pragmas, `ensureTenantTables` once, drizzle, cache in a
  process-level `Map`.
- `getCurrentTenantDb()` — cookie → controlDb session → user.tenant_id → tenant.db_file →
  `openTenantDb`. Falls back to `getTenantDbBySlug(DEFAULT_TENANT_SLUG ?? 'renova')` when no
  session resolves. Memoised with React `cache()`.
- `getTenantDbBySlug(slug)` / `getTenantDbById(id)` — explicit, for jobs + provisioning.
- `index.ts`: `export const db = new Proxy({}, { get: (_, p) => getCurrentTenantDb()[p] })`.
  Keep `export { schema }`. Move the business seed out; keep control import. Keep the
  production scheduler-arm block.
- **Audit:** confirm no file runs a `db` query at module top level (build will catch it).

## Phase 3 — Auth → controlDb, cookie rename, boot migration
**Files:** `src/lib/auth.ts`, `src/app/api/auth/login/route.ts`,
`src/app/api/auth/change-password/route.ts`, `src/app/settings/users/actions.ts`,
`src/app/settings/users/page.tsx`, `src/app/settings/page.tsx`,
`src/components/settings/UsersManager.tsx` (server bits), `src/middleware.ts`,
`src/lib/db/migrate.ts` (new), `src/lib/db/index.ts` (call migrate on boot)
- Add `export const authDb = controlDb` (in `control.ts` or re-export). Repoint every
  `users`/`authSessions` query above from `db` → `authDb`.
- `SESSION_COOKIE`: `renova_session` → `clientflow_session` (auth.ts + middleware.ts).
- `migrate.ts`: idempotent boot migration (register renova tenant; copy users + sessions
  clinic.db→controlDb stamped `tenant_id=renova`, owner `is_platform_admin=1`). Call it from
  `index.ts` at runtime boot (not during `next build`).

## Phase 4 — Per-tenant branding paths
**Files:** wherever branding dir is resolved (`/api/branding/*`, branding lib)
- `brandingDir(tenant)` → renova keeps `data/branding/`; new tenants → `data/tenants/<slug>/branding/`.
- Keep light; renova path unchanged to avoid moving live files.

## Phase 5 — Background jobs + residual rename
**Files:** `src/lib/pipeline/lapse.ts`, `src/lib/pipeline/lapseScheduler.ts`, misc
- `recomputeLapsed(conn)` takes an explicit connection; scheduler iterates `listTenants()`.
- Sweep residual platform-level `Renova` strings that should read `ClientFlow` (not business
  data, not Renova's own tenant display name).

## Phase 6 — Verify isolation (LOCAL GATE)
- `tsc` + `build:prod` clean.
- Provision a throwaway 2nd tenant via the CLI; create a user in it (control-level).
- Drive system Chrome (playwright-core, `channel:'chrome'`): log in as renova user → see
  renova data; log in as tenant-2 user → see only tenant-2 data. Confirm **no cross-tenant
  leakage**. Confirm renova login + change-password + a booking still work.
- Clean up the throwaway tenant. **Do not proceed to Phase 7 unless this passes.**

## Phase 7 — Production deploy (USER-CONFIRMED, after Phase 6 green)
- Re-confirm the middleware logged-out gate (default-tenant-fallback safety).
- Fresh prod backup (trigger `POST /api/internal/backup`) before deploy.
- `railway up` from `app/` (clear `RAILWAY_API_TOKEN`/`RAILWAY_TOKEN` first; stored login).
- Boot migration runs once on prod → users copied to control.db, renova tenant registered.
- Verify: login (one re-login due to cookie rename) → dashboard renders with real data;
  change-password works; webhook still writes (default-tenant fallback). Watch logs for a
  clean boot + the migrate log line. Re-run a backup post-migrate.
- Rollback path: redeploy prior image / restore `clinic.db` from backup; old cookie + old
  auth code path is recoverable because clinic.db.users was left intact.

---

## Sequencing note
Build order is **P2 → P1 → P3 → P4 → P5 → P6 → P7** (P1's provisioning needs P2's
connection/table helpers). Verify `tsc` after each.
