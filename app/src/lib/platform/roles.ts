import "server-only";

import { controlSqlite } from "@/lib/db/control";

/**
 * Who may do what in the platform console.
 *
 * Two roles, decided 2026-09-18:
 *
 *   owner    everything, including the things that cannot be undone or that
 *            move money the wrong way: deleting a tenant, refunds, price
 *            overrides, fleet kill switches, and changing who else has
 *            console access.
 *   manager  everything else: day-to-day support. Suspend and reactivate,
 *            credits and grants, caps and allowances, venue and features,
 *            opening a tenant to look at something, notes.
 *
 * `users.is_platform_admin` is unchanged and still decides whether someone
 * may log into the console at all; this decides what they see once they are
 * in. A platform admin with no role recorded is treated as an owner, which is
 * what they were before roles existed (migration 0004 backfills the column;
 * this default covers a row the migration has not reached).
 *
 * OWNER_ONLY_ACTIONS is the single source of truth for the split. The API
 * route checks it before dispatching, so hiding a button in the console is
 * presentation, never protection.
 */

export type PlatformRole = "owner" | "manager";

export const OWNER_ONLY_ACTIONS: ReadonlySet<string> = new Set([
  // Ends the relationship and starts the 30-day purge clock.
  "offboard",
  // Money out, or money permanently not collected.
  "waive",
  "comp",
  "refund",
  "price-override",
  // Fleet-level switches and who else holds the keys.
  "kill-switch",
  "set-staff-role",
  "purge-now",
]);

/** Actions that must carry a reason: they change access, money or data. */
export const REASON_REQUIRED_ACTIONS: ReadonlySet<string> = new Set([
  "open",
  "offboard",
  "suspend",
  "waive",
  "comp",
  "purge-now",
]);

export function isOwnerOnly(action: string): boolean {
  return OWNER_ONLY_ACTIONS.has(action);
}

export function requiresReason(action: string): boolean {
  return REASON_REQUIRED_ACTIONS.has(action);
}

export function roleOf(row: { platform_role?: string | null } | null | undefined): PlatformRole {
  return row?.platform_role === "manager" ? "manager" : "owner";
}

export function getPlatformRole(userId: number): PlatformRole {
  const row = controlSqlite
    .prepare("SELECT platform_role FROM users WHERE id = ?")
    .get(userId) as { platform_role: string | null } | undefined;
  return roleOf(row);
}

export function canDo(role: PlatformRole, action: string): boolean {
  return role === "owner" || !isOwnerOnly(action);
}

export interface PlatformStaffRow {
  userId: number;
  email: string;
  name: string | null;
  role: PlatformRole;
  isActive: boolean;
  lastLoginAt: number | null;
}

export function listPlatformStaff(): PlatformStaffRow[] {
  const rows = controlSqlite
    .prepare(
      `SELECT id, email, name, platform_role, is_active, last_login_at
       FROM users WHERE is_platform_admin = 1 ORDER BY email`,
    )
    .all() as Array<{
    id: number;
    email: string;
    name: string | null;
    platform_role: string | null;
    is_active: number;
    last_login_at: number | null;
  }>;
  return rows.map((r) => ({
    userId: r.id,
    email: r.email,
    name: r.name,
    role: roleOf(r),
    isActive: Boolean(r.is_active),
    lastLoginAt: r.last_login_at,
  }));
}

export type SetRoleResult = { ok: true } | { ok: false; error: string };

/**
 * Change a staff member's role. Owner-gated by the caller.
 *
 * Two refusals, both about not locking the platform out of itself: nobody may
 * demote themselves (a lone owner demoting to manager would leave no one able
 * to promote anyone back), and the last remaining owner may not be demoted.
 */
export function setPlatformRole(targetUserId: number, role: PlatformRole, actingUserId: number): SetRoleResult {
  if (targetUserId === actingUserId && role !== "owner") {
    return { ok: false, error: "You cannot remove your own owner access. Ask another owner to do it." };
  }
  const target = controlSqlite
    .prepare("SELECT id, is_platform_admin, platform_role FROM users WHERE id = ?")
    .get(targetUserId) as { id: number; is_platform_admin: number; platform_role: string | null } | undefined;
  if (!target || !target.is_platform_admin) return { ok: false, error: "That user does not have console access." };

  if (role === "manager" && roleOf(target) === "owner") {
    const owners = (
      controlSqlite
        .prepare(
          "SELECT count(*) AS n FROM users WHERE is_platform_admin = 1 AND is_active = 1 AND (platform_role IS NULL OR platform_role = 'owner')",
        )
        .get() as { n: number }
    ).n;
    if (owners <= 1) return { ok: false, error: "This is the only owner. Promote someone else first." };
  }

  controlSqlite.prepare("UPDATE users SET platform_role = ?, updated_at = ? WHERE id = ?").run(role, Date.now(), targetUserId);
  return { ok: true };
}
