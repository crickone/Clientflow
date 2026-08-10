import "server-only";

import { controlSqlite } from "@/lib/db/control";

/**
 * Idempotently grant a user an ADMIN membership in a tenant — INSERT …
 * ON CONFLICT(user_id, tenant_id) DO NOTHING, the exact pattern
 * `createTenantAdmin()` (lib/tenants.ts) already uses for a brand-new
 * tenant's first admin, keyed off the same `idx_memberships_user_tenant`
 * unique index.
 *
 * Used by the platform "Open business" handoff: the platform admin's OWN
 * identity gets a real, attributable, admin membership in the tenant they're
 * opening — never a fake/owner identity. Only ever touches the single
 * (userId, tenantId) row: if a membership already exists for that pair (any
 * role, active or not) it is left completely untouched — this grants access
 * when there is none, it never silently promotes or reactivates an existing
 * one, and it never touches this user's memberships in any OTHER tenant.
 */
export function grantAdminMembership(
  tenantId: number,
  userId: number,
): { granted: boolean } {
  const result = controlSqlite
    .prepare(
      `INSERT INTO memberships (user_id, tenant_id, role, is_active)
       VALUES (?, ?, 'admin', 1)
       ON CONFLICT(user_id, tenant_id) DO NOTHING`,
    )
    .run(userId, tenantId);
  return { granted: result.changes > 0 };
}
