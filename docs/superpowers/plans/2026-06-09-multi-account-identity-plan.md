# Implementation Plan — Multi-Account Identity

**Spec:** `docs/superpowers/specs/2026-06-09-multi-account-identity-design.md`
**Approach:** split **identity** (`users`) from **membership** (new `memberships`
table: user × tenant × role); the session records the **active** clinic
(`auth_sessions.active_tenant_id`). A new `getCurrentMembership()` resolver
becomes the per-request source of truth; `getCurrentTenant()` reads the session's
active tenant instead of `user.tenant_id`. Login branches on membership count
(0/1/≥2) → error / dashboard / account selector. The per-clinic Users page manages
memberships. Provisioning attaches a membership to an existing identity rather
than failing on the UNIQUE email.

**Sequencing principle:** land the schema + idempotent boot migration *behind* the
app first — single-clinic users (everyone today) see **zero behaviour change**
because the backfill gives each user exactly one membership and each live session
an `active_tenant_id`. Then rewire the resolver, then the login/selector/switcher
UX, then the Users page, then provisioning. **Back up `data/control.db` before the
first migrated boot.** After each phase: app boots, Renova login works with all
data intact, `tsc --noEmit` clean.

**Project is not under git** → back up `control.db` (and ideally `clinic.db`) and
verify per-phase before moving on.

---

## Phase 0 — Schema + boot migration (no behaviour change)

**Objective:** add the `memberships` table and `auth_sessions.active_tenant_id`,
and backfill from the legacy `users.tenant_id` / `users.role`, so the data model
is in place while the app still resolves tenants the old way.

**Files:**
- `src/lib/db/schema.ts`: add the `memberships` Drizzle table
  (`id, userId, tenantId, role, isActive, createdAt`, `UNIQUE(userId, tenantId)`);
  add `activeTenantId` (nullable FK → tenants) to the `authSessions` table.
- `src/lib/db/control.ts`: extend `ensureControlTables()` with the `memberships`
  DDL + `idx_memberships_user` / `idx_memberships_tenant`, and a PRAGMA-guarded
  `ALTER TABLE auth_sessions ADD COLUMN active_tenant_id INTEGER REFERENCES
  tenants(id)` (mirrors the existing column-add guards).
- `src/lib/db/migrate.ts`: extend `runBootMigration()` (idempotent):
  1. ensure the table/column exist (call the control DDL).
  2. **Backfill memberships:** for each `users` row with non-null `tenant_id`,
     `INSERT OR IGNORE` a membership `(user_id, tenant_id, role, is_active =
     user.is_active)`.
  3. **Backfill sessions:** `UPDATE auth_sessions SET active_tenant_id =
     (SELECT tenant_id FROM users WHERE users.id = auth_sessions.user_id)
     WHERE active_tenant_id IS NULL`.
  4. Leave `users.tenant_id` / `users.role` untouched (legacy; rollback safety).

**Verify:** **back up `control.db` first.** Boot → migration runs once;
`memberships` has one row per existing user (the owner = admin of Renova);
every live `auth_sessions` row has `active_tenant_id` set; re-running boot is a
no-op. Renova login + data unchanged (resolver still on the old path). `tsc`.

---

## Phase 1 — Membership resolver + rewire auth/tenant helpers

**Objective:** make `getCurrentMembership()` the per-request source of truth and
point the existing guards + tenant resolution at it. This is the behavioural flip;
single-clinic users still see no difference because their one membership always
matches their backfilled `active_tenant_id`.

**Files:**
- `src/lib/auth.ts`:
  - Add `getCurrentMembership()` — `cookie → auth_sessions {userId,
    activeTenantId} → memberships WHERE user_id & tenant_id & is_active → {user,
    tenant, role}`; memoise with React `cache()`.
  - `requireUser()`: authenticated **and** has an active membership in
    `active_tenant_id`; otherwise throw (callers/page guards redirect).
  - `requireAdmin()`: check the **active membership's** role, not `user.role`.
  - `requireUserPage()` / `requireAdminPage()`: on missing membership / null
    active tenant → `redirect("/select-account")` (not `/login`, since identity
    is valid); keep the `must_change_password` → `/change-password` redirect.
  - `getSessionUser()`: return the `User` plus `{ activeTenantId, role }` (role
    from the active membership) so `layout.tsx` / Sidebar can render the chip.
  - Add `setActiveTenant(tenantId)` — validates a live membership for the session
    user, then `UPDATE auth_sessions SET active_tenant_id`. Returns ok/err.
  - `requirePlatformAdmin()`: unchanged (identity-level).
- `src/lib/db/tenant.ts`: `getCurrentTenant()` resolves
  `auth_sessions.active_tenant_id → tenant` instead of joining to
  `user.tenant_id`. Keep the no-cookie / unresolved fallback to the default
  tenant (webhooks, jobs) exactly as today.

**Verify:** Renova owner logs in, lands on dashboard, all data intact; demoting
self still blocked (guard now per-membership in this tenant); `requireAdmin`
pages still gate correctly. Background webhook path still resolves default
tenant. `tsc`.

---

## Phase 2 — Login branch + account selector

**Objective:** route multi-clinic users through a chooser; single-clinic users
go straight in.

**Files:**
- `src/app/api/auth/login/route.ts`: after password verify, load the user's
  active memberships and branch:
  - 0 → 401 `"No clinic access"`.
  - 1 → `createSession(activeTenantId = that)` → respond `{ redirect:
    "/dashboard" }` (respecting `mustChangePassword` first, as today).
  - ≥2 → `createSession(activeTenantId = null)` → `{ redirect:
    "/select-account" }`.
  - `createSession()` (auth.ts) gains an `activeTenantId` argument written onto
    the new column.
- `src/app/select-account/page.tsx` (new): server component guarded by
  `getSessionUser()` **only** (must NOT call `requireUser` — there's no active
  tenant yet). Lists the user's active memberships (clinic name + role) as cards.
- `src/app/select-account/actions.ts` (new): `"use server"` `chooseAccount
  (tenantId)` → `setActiveTenant` → `redirect("/dashboard")`.
- `src/components/layout/AppShell.tsx`: add `/select-account` to `NO_SHELL_PATHS`
  so it renders bare (no sidebar — no tenant resolved yet).
- `src/middleware.ts`: no change needed (the session cookie is already set; the
  edge gate passes; `/select-account` is a normal signed-in route).

**Verify:** a user with 2 memberships (create a throwaway second one by hand for
the test) is sent to `/select-account`, picks a clinic, lands on its dashboard; a
1-membership user never sees the selector. `tsc`.

---

## Phase 3 — In-app sidebar switcher

**Objective:** switch clinics without logging out.

**Files:**
- `src/app/layout.tsx`: fetch the session user's active memberships (clinic id +
  name + role + which is active) and pass them to `AppShell` → `Sidebar`. The
  existing `businessName` already reflects the active tenant via the `db` proxy.
- `src/components/layout/Sidebar.tsx`: when memberships ≥ 2, render the
  business-name header as a dropdown (using the existing Radix dropdown-menu)
  listing the clinics with a check on the active one + a "Manage accounts →" item
  linking to `/select-account`. When < 2, keep the plain static brand label.
- `src/components/layout/AppShell.tsx`: thread the memberships prop through.
- Reuse `chooseAccount` from Phase 2 (or a thin client wrapper that calls
  `setActiveTenant` then `router.refresh()`), so switching re-resolves all server
  components against the new tenant with no full reload. The action re-validates
  membership server-side every time.

**Verify:** owner with Renova + a test second clinic switches via the sidebar,
sees the other clinic's (empty/seeded) data, switches back; the dropdown is
absent for single-clinic users. `tsc`.

---

## Phase 4 — Membership-based Users page

**Objective:** the per-clinic Users page manages memberships in the active clinic,
not global users.

**Files:**
- `src/app/settings/users/page.tsx`: list query → memberships in the active
  tenant joined to `users` (email, name, per-clinic role, identity active,
  last-login).
- `src/app/settings/users/actions.ts`:
  - **createUserAction(email, role, [name, password]):** look up the identity by
    email. If it exists → `INSERT OR IGNORE` a membership in the active tenant
    with the chosen role (error if already a member). If new → create the identity
    (name + temp password, `must_change_password`) **and** the membership.
  - **updateUserAction:** role / active edits target the **membership** row in the
    active tenant. Name/email become read-only here (identity-level) — return an
    error if changed, or simply ignore them (UI shows them disabled).
  - **deleteUserAction → removeFromClinicAction:** delete the **membership** in
    the active tenant, not the identity. Keep the per-tenant last-admin guard
    (count admin memberships in this tenant). Offer identity deletion only when no
    memberships remain (follow-up, not automatic).
  - All tenant-scoping switches from `me.tenantId` to the request's active tenant
    (`getCurrentMembership().tenant.id`).
- `src/components/settings/UsersManager.tsx`: Add-user dialog reveals name +
  temp-password fields only when the entered email is unrecognised (a tiny
  `checkEmailExistsAction` lookup, or reveal-on-submit error); Edit dialog shows
  name/email disabled with the note "managed on the user's profile"; "Delete" →
  "Remove from clinic" copy.

**Verify:** adding an existing email grants a membership (no second identity,
no password prompt); adding a new email creates both; removing a membership leaves
the identity + other clinics intact; last-admin guard fires per-tenant. `tsc`.

---

## Phase 5 — Provisioning tweak + create the ClientFlow clinic

**Objective:** provisioning attaches a membership to an existing identity, and the
owner gets a real second clinic.

**Files:**
- `src/lib/tenants.ts`:
  - `createTenantAdmin(tenantId, {email, password, name})` → **ensure identity,
    then ensure membership**: if the email exists, reuse the identity and
    `INSERT OR IGNORE` an admin membership; else create the identity (no
    `must_change_password` for the provisioning admin) + admin membership.
  - `createTenant()` unchanged except it now tolerates an existing admin email.
- `src/app/api/internal/tenants/route.ts`: no schema change; relies on the
  `createTenantAdmin` behaviour above (drop any "email already in use" hard-fail).
- Then run:
  ```
  node scripts/provision-tenant.mjs --slug=clientflow --name="ClientFlow" \
       --admin-email=christopher.walshe1994@gmail.com
  ```

**Verify:** the command creates `data/tenants/clientflow/clientflow.db` (seeded)
+ a `tenants` row + an admin membership for the existing owner identity. `tsc`.

---

## Phase 6 — End-to-end verification

- Owner logs in → **account selector** shows Renova + ClientFlow.
- Pick Renova → all existing data present; pick ClientFlow → seeded/empty,
  **never Renova's data**.
- Sidebar switcher flips between them without re-login; each shows only its own
  clients/leads/appointments.
- Revoke the owner's ClientFlow membership (via Renova-side script or DB) while
  active in ClientFlow → next request bounces to `/select-account`.
- Add a staff email to ClientFlow only → that person sees one clinic, no selector,
  no switcher; they cannot reach Renova.
- Single-clinic Renova staff: unchanged login → dashboard, no selector/switcher.
- Extend `scripts/verify-tenancy.mjs` with the multi-membership + switch scenario.
- `npm run build` / `tsc --noEmit` clean.

---

## Risk notes

- **Resolver must validate membership on every request, not just at switch.** A
  stale `active_tenant_id` (revoked access) must fail closed → redirect to
  `/select-account`. The session cookie alone never grants clinic access.
- **`/select-account` cannot use `requireUser`** (it demands an active membership
  that doesn't exist yet) — guard it on identity (`getSessionUser`) only, and make
  sure `requireUserPage`/`requireAdminPage` redirect there (not to `/login`) when
  the identity is valid but the tenant is unresolved, to avoid a redirect loop.
- **Webhooks / background jobs** keep using the explicit `getTenantDb*` helpers and
  the default-tenant fallback — do not route them through `getCurrentMembership`.
- **Legacy columns stay.** `users.tenant_id` / `users.role` are no longer read but
  remain for rollback; double-check no stray query still references them after
  Phase 1 (grep `\.tenantId` / `users.role`).
- **Idempotency:** the backfill uses `INSERT OR IGNORE` / guarded `UPDATE ... WHERE
  active_tenant_id IS NULL` so re-boots are safe.
- **Back up `control.db`** before the first migrated boot. No git → per-phase
  backup + manual verify.
- **Last-admin guard** semantics change from global to per-tenant — verify an
  admin can't orphan a clinic by removing the only admin membership.
