import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getVenueTypeForTenant } from "@/lib/settings";

/**
 * The fleet list: every business, filtered, for the console's front door.
 *
 * The kill switches live in ./killSwitch, which is a leaf on purpose (see
 * its header) -- they are re-exported here so the console has one import,
 * while the spend gates keep depending only on the leaf.
 */
export { KILL_SWITCHES, isStopped, listKillSwitches, setKillSwitch } from "./killSwitch";
export type { KillSwitchKey, KillSwitchState, KillSwitchDef, FleetResult } from "./killSwitch";

// ─── The tenant list, with filters ───────────────────────────────────────────

export interface FleetFilters {
  q?: string;
  /** Billing status, or "archived" / "exempt", which are not statuses but read like them. */
  status?: string;
  venueType?: string;
}

export interface FleetTenantRow {
  id: number;
  name: string;
  slug: string;
  venueType: string | null;
  isActive: boolean;
  archivedAt: number | null;
  billingStatus: string | null;
  billingExempt: boolean;
  nextRenewalAt: string | null;
  createdAt: number;
  users: number;
}

/**
 * Every business, filtered. One query with a join rather than a lookup per
 * row: this list is the console's front door and it grows with the fleet.
 */
export function listFleet(filters: FleetFilters = {}): FleetTenantRow[] {
  const where: string[] = [];
  const args: unknown[] = [];

  if (filters.q?.trim()) {
    // Searchable by the three things support is ever given: the business's
    // name, its slug, or the email of somebody who works there.
    where.push(
      `(t.name LIKE ? OR t.slug LIKE ? OR EXISTS (
         SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = t.id AND u.email LIKE ?))`,
    );
    const like = `%${filters.q.trim()}%`;
    args.push(like, like, like);
  }
  // venueType is NOT filtered here: it lives in each tenant's own settings
  // rather than the registry, so it is applied after the rows come back.
  switch (filters.status) {
    case "archived":
      where.push("t.archived_at IS NOT NULL");
      break;
    case "exempt":
      where.push("tb.billing_exempt = 1");
      break;
    case undefined:
    case "":
      break;
    default:
      where.push("tb.status = ? AND t.archived_at IS NULL");
      args.push(filters.status);
  }

  const rows = controlSqlite
    .prepare(
      `SELECT t.id, t.name, t.slug, t.is_active, t.archived_at, t.created_at,
              tb.status AS billing_status, tb.billing_exempt, tb.next_renewal_at,
              (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.is_active = 1) AS users
       FROM tenants t
       LEFT JOIN tenant_billing tb ON tb.tenant_id = t.id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY t.archived_at IS NOT NULL, t.name`,
    )
    .all(...args) as Array<{
    id: number;
    name: string;
    slug: string;
    is_active: number;
    archived_at: number | null;
    created_at: number;
    billing_status: string | null;
    billing_exempt: number | null;
    next_renewal_at: string | null;
    users: number;
  }>;

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    // Read per row from the tenant's own settings; the registry does not
    // hold it. Cheap at this fleet size, and honest about where the value
    // actually lives.
    venueType: safeVenueType(r.id),
    isActive: Boolean(r.is_active),
    archivedAt: r.archived_at,
    billingStatus: r.billing_status,
    billingExempt: Boolean(r.billing_exempt),
    nextRenewalAt: r.next_renewal_at,
    createdAt: r.created_at,
    users: r.users,
  })).filter((r) => !filters.venueType || r.venueType === filters.venueType);
}

/** A tenant whose database cannot be opened still belongs in the list. */
function safeVenueType(tenantId: number): string | null {
  try {
    return getVenueTypeForTenant(tenantId);
  } catch {
    return null;
  }
}
