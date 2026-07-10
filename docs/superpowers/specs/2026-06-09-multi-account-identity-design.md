# Multi-Account Identity — Design

**Date:** 2026-06-09
**Status:** Approved (pending spec review)
**Author:** Brainstormed with Christopher (platform owner)

## Problem

Today the app hard-binds one email to one clinic. The control-plane `users`
table has a `UNIQUE` email, login resolves a single user row by email, and that
row's `tenant_id` fixes which clinic the app shows. There is no way for one
person to belong to more than one clinic, pick a clinic at login, or move
between clinics in-app.

We want a person (e.g. the owner running both Renova and a new ClientFlow
clinic, or a shared consultant) to:

1. Hold **one identity** (one email, one password, one profile).
2. Belong to **multiple clinics**, with a **separate role per clinic**.
3. **Pick a clinic at login** when their email maps to more than one.
4. **Switch clinics in-app** without logging out.

## Scope decisions (locked during brainstorming)

- **Who it's for:** a general SaaS feature — *any* user can belong to many
  clinics, not just the platform admin.
- **Role model:** **per-clinic**. You can be ADMIN of one clinic and STAFF of
  another. Role lives on the membership, not the identity.
- **How memberships are created:** through the **per-clinic Users page**. Each
  clinic's admin manages its own roster in Settings → Users. Adding an email
  that already exists as an identity just grants a new membership; a brand-new
  email creates the identity too.
- **Active-account storage:** on the **session row** (`auth_sessions
  .active_tenant_id`) — single source of truth, survives reloads, slots into the
  existing `getCurrentTenant()` resolver.

### Non-goals (YAGNI)

- No cross-clinic combined views and no "all clinics" dashboard. Switching is a
  hard context swap — you are in exactly one clinic at a time. This keeps every
  existing query (`{ db }` → one tenant file) correct and untouched.
- No separate central platform-admin roster screen in this scope. Provisioning
  new clinics stays on the existing platform endpoint/script; per-clinic roster
  management flows through the per-clinic Users page.
- The legacy `users.tenant_id` / `users.role` columns are **not dropped** (SQLite
  makes that painful and they are a safe rollback). Code simply stops reading
  them.

## Architecture

Split **identity** (credentials + profile) from **membership** (access to one
clinic with a role). The session points at whichever clinic is currently active.

### Section 1 — Data model (control.db)

```
users  (existing table; semantics narrowed to "identity")
  id, email (UNIQUE), name, password_hash,
  is_platform_admin, must_change_password, is_active,   -- all identity-level
  last_login_at, created_at, updated_at
  -- tenant_id, role: KEPT as legacy columns, NO LONGER READ (see migration)

memberships  (NEW — a person's access to one clinic)
  id            INTEGER PK AUTOINCREMENT
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  role          TEXT NOT NULL DEFAULT 'staff'   -- 'admin' | 'staff' (per-clinic)
  is_active     INTEGER NOT NULL DEFAULT 1
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  UNIQUE(user_id, tenant_id)
  INDEX idx_memberships_user   ON (user_id)
  INDEX idx_memberships_tenant ON (tenant_id)

auth_sessions  (existing table; one new column)
  id, user_id, expires_at, created_at,
  active_tenant_id  INTEGER REFERENCES tenants(id)   -- NEW: which clinic this
                                                     -- session is currently in;
                                                     -- NULL = not yet chosen
```

So: one password and one profile per person (identity), a distinct role for each
clinic (membership), and the session records the active clinic.

### Section 2 — Auth resolution & request lifecycle

New helper `getCurrentMembership()` becomes the per-request source of truth,
memoised with React `cache()` (mirrors today's `getCurrentTenant()`):

```
cookie → auth_sessions row → { userId, activeTenantId }
       → memberships row WHERE user_id = userId
                           AND tenant_id = activeTenantId
                           AND is_active = 1
       → { user, tenant, role }
```

Existing functions are rewired onto it:

| Function                | Today                          | After                                                              |
|-------------------------|--------------------------------|--------------------------------------------------------------------|
| `getCurrentTenant()`    | session → `user.tenantId`      | session → `active_tenant_id` → tenant                              |
| `requireAdmin()`        | `user.role === 'admin'`        | **active membership's** `role === 'admin'`                         |
| `requireUser()`         | session user exists            | session user exists **and** has an active membership in `active_tenant_id` |
| `requirePlatformAdmin()`| `user.isPlatformAdmin`         | unchanged (identity-level)                                         |
| `getSessionUser()`      | returns `User`                 | returns `User` + `{ activeTenantId, role }` for pages/Sidebar      |

**Safety rule — validate the active tenant on every request, not only at switch
time.** `getCurrentMembership()` must confirm a live membership row for
`(userId, activeTenantId)`. If an admin revokes a person's access to a clinic
while they are in it, their next request fails the membership check and they are
bounced to `/select-account` (or to their sole remaining clinic). The session
cookie alone can never grant access to a clinic the user has been removed from —
this is what keeps tenant isolation airtight.

Edge cases the resolver handles:

- `active_tenant_id` is NULL (multi-clinic user mid-login) → redirect to
  `/select-account`.
- `active_tenant_id` points at a clinic the user no longer belongs to (revoked)
  → clear it, redirect to `/select-account`.
- User belongs to exactly one clinic → never sees a selector anywhere.
- Webhooks / background jobs (no cookie) → still fall back to the default tenant
  via the explicit `getTenantDb*` helpers, exactly as today. **Unchanged.**

### Section 3 — Login, account selector & in-app switcher

**Login flow** (`/api/auth/login`, rewired):

```
1. find identity by email → verify password            (unchanged)
2. must_change_password checked as today (identity-level), before clinic resolution
3. load active memberships for this user
4. branch on count:
   ├─ 0  → 401 "No clinic access"
   ├─ 1  → createSession(active_tenant_id = that one) → redirect "/dashboard"
   └─ ≥2 → createSession(active_tenant_id = NULL)      → redirect "/select-account"
```

Single-clinic users (all current staff) see zero change — same login, straight
to the dashboard.

**Account selector — new page `/select-account`:**

- Server component; allowed by middleware even when `active_tenant_id` is NULL
  (the one signed-in page that does not require a resolved tenant). It must
  **not** call `requireUser()` (which now demands an active membership in the
  active tenant) — it guards only on an authenticated identity via
  `getSessionUser()`, since the whole point is to choose the tenant that does not
  yet exist on the session.
- Lists the user's active memberships as cards: clinic name + their role there.
- Picking one → server action sets `auth_sessions.active_tenant_id` (validated
  against the user's memberships) → redirect to `/dashboard`.
- Visiting it later with a tenant already active lets the user switch; it doubles
  as the switcher target.

```
┌─────────────────────────────────────┐
│  Choose an account                   │
│  Signed in as christopher.walshe…    │
│  ┌────────────────┐ ┌──────────────┐ │
│  │ Renova         │ │ ClientFlow   │ │
│  │ Cellular Health│ │              │ │
│  │ ADMIN       →  │ │ ADMIN     →  │ │
│  └────────────────┘ └──────────────┘ │
└─────────────────────────────────────┘
```

**In-app switcher — in the sidebar.** The sidebar already renders `businessName`
(top) and the user chip (bottom). The switcher becomes a dropdown on the
business-name header:

```
┌─────────────────────┐        ▼ opens
│ CLIENTFLOW        ⌄ │     ┌─────────────────────┐
│ Renova Cellular…    │     │ ✓ Renova   (ADMIN)  │
└─────────────────────┘     │   ClientFlow (ADMIN)│
                            │ ─────────────────── │
                            │   Manage accounts → │  (→ /select-account)
                            └─────────────────────┘
```

- Renders the dropdown affordance only if the user has **≥2** memberships;
  otherwise it stays the plain static brand label it is today.
- Selecting a clinic calls the same "set active tenant" server action, then
  `router.refresh()` so all server components re-resolve against the new tenant.
  No full reload required.
- The switch action **always re-validates** the target against the user's live
  memberships server-side — the dropdown is a convenience, never the authority.

### Section 4 — Users page, provisioning & platform-admin

**Per-clinic Users page (`/settings/users`)** now manages *memberships* in the
active clinic, not global users. The list query changes from "users WHERE
tenant_id = mine" to "memberships in active tenant, joined to users" — showing
each person's email, name, their role *in this clinic*, and identity-active
status.

The four server actions are reworked around membership semantics:

| Action          | New behaviour                                                                                                                                                                                                                                                  |
|-----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Add user**    | Enter email + role. If the email **already exists** as an identity → create a membership in this clinic with that role (no password field). If **new** → create the identity (name + temp password, `must_change_password`) *and* the membership. The dialog reveals name/password fields only when the email is unrecognised. |
| **Edit**        | Editing **role** / **active** operates on the *membership* (per-clinic). Name/email are identity-level and shared across clinics — the dialog shows them read-only with a note ("managed on the user's profile") so one clinic can't silently rename a person for another. |
| **Remove**      | "Remove from this clinic" deletes the **membership**, not the identity. The person keeps their other clinics and login. The identity is only deleted if it has no memberships left and is not a platform admin (offered as a follow-up, not automatic).         |
| **last-admin guard** | The existing "can't remove/demote the only active admin" check now counts **admin memberships in this tenant**, not global admin users.                                                                                                                  |

**Provisioning a new clinic** — the platform endpoint `/api/internal/tenants` +
`createTenant()` get one tweak: when given an admin email that **already exists**
as an identity, attach a new admin **membership** instead of erroring on the
UNIQUE email. `createTenantAdmin` becomes "ensure identity, then ensure
membership." Provisioning the ClientFlow clinic for the owner:

```
node scripts/provision-tenant.mjs --slug=clientflow --name="ClientFlow" \
     --admin-email=christopher.walshe1994@gmail.com
```

→ creates the ClientFlow tenant + DB and grants the existing identity an admin
membership. Next login → the account selector shows Renova + ClientFlow.

**Platform-admin** stays identity-level (`is_platform_admin`), unchanged. The
owner keeps central provisioning power; all other roster management flows through
the per-clinic Users page.

## Migration (idempotent, runs on boot)

Extends the existing tenancy boot migration. Runs before the first login, same as
the current control-plane boot.

1. Create the `memberships` table and its indexes.
2. Add the `active_tenant_id` column to `auth_sessions` (PRAGMA-guarded, like the
   other column-add migrations).
3. **Backfill memberships:** for each existing user with a non-null `tenant_id`,
   insert one membership `(user_id, tenant_id, role, is_active = user.is_active)`
   if absent. → The owner's account becomes an admin membership of Renova.
4. **Backfill live sessions:** for each existing `auth_sessions` row with a NULL
   `active_tenant_id`, set it to the owning user's legacy `tenant_id` so nobody
   currently logged in lands in a void.
5. Leave `users.tenant_id` / `users.role` in place as legacy (rollback safety).

## Components & boundaries

- **`@/lib/auth.ts`** — owns identity + session + membership resolution
  (`getCurrentMembership`, rewired `requireUser`/`requireAdmin`/`getSessionUser`,
  a `setActiveTenant(sessionId, tenantId)` action validated against memberships).
- **`@/lib/db/tenant.ts`** — `getCurrentTenant()` reads `active_tenant_id`.
- **`@/lib/db/control.ts`** — `ensureControlTables()` gains the `memberships`
  table; the boot migration gains steps 1–4 above.
- **`@/lib/db/schema.ts`** — add the `memberships` Drizzle table + `activeTenantId`
  on `authSessions`.
- **`@/lib/tenants.ts`** — `createTenantAdmin` → ensure-identity-then-membership.
- **`/select-account`** (new route) — selector page + set-active-tenant action.
- **Sidebar** — conditional account-switcher dropdown on the brand header.
- **`/settings/users` actions + `UsersManager`** — membership-based CRUD.
- **`/api/auth/login`** — count-based branch to dashboard vs selector.

## Testing

- **Migration:** boot against a copy of the live control.db → assert one
  membership per existing user, live sessions get `active_tenant_id` backfilled,
  re-running is a no-op.
- **Resolution/isolation:** a two-clinic user switches Renova → ClientFlow and
  sees only ClientFlow data; revoking a membership mid-session bounces them to the
  selector on the next request; a one-clinic user never sees a selector.
- **Login branching:** 0 / 1 / ≥2 memberships → 401 / dashboard / selector.
- **Users page:** adding an existing email grants a membership (no new identity);
  adding a new email creates both; removing a membership leaves the identity and
  other clinics intact; last-admin guard fires per-tenant.
- **Provisioning:** `provision-tenant.mjs` with an existing email adds a
  membership rather than failing on UNIQUE.
- Extend `scripts/verify-tenancy.mjs` with the multi-membership scenario.

## Roll-out

1. Ship schema + migration + resolver rewiring (no UX change yet for single-clinic
   users; everyone keeps working).
2. Ship login branch + `/select-account` + sidebar switcher.
3. Ship membership-based Users page + provisioning tweak.
4. Provision the ClientFlow clinic against the owner's email; verify the selector
   and switch end-to-end.
