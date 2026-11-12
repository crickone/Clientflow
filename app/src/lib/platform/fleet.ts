import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getVenueTypeForTenant } from "@/lib/settings";
import { getSetupSummaryForTenant } from "@/lib/setup/steps";
import { churnRisk, riskFacts } from "./churnRisk";
import { getTenantMeta } from "./tenantMeta";

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
  setup: { requiredDone: number; requiredTotal: number };
  risk: { score: number; level: "low" | "medium" | "high" };
  stage: string | null;
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
    ...enrich(r.id, r.archived_at !== null, r.billing_status, Boolean(r.billing_exempt)),
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

// ─── Per-business setup, risk and stage ──────────────────────────────────────

type Enrichment = Pick<FleetTenantRow, "setup" | "risk" | "stage">;
const ENRICH_TTL_MS = 5 * 60 * 1000;
const enrichCache = new Map<number, { at: number; key: string; value: Enrichment }>();

/** Drop one business's cached setup/risk/stage so the next list read recomputes it. */
export function invalidateFleetEnrichment(tenantId: number): void {
  enrichCache.delete(tenantId);
}

/**
 * Setup + risk + stage open the business's own database, so they are cached
 * in-process for five minutes (keyed also on the facts that come from the
 * registry, so an archive or billing change shows at once). One business
 * that cannot be read gets blanks and never breaks the list.
 */
function enrich(id: number, archived: boolean, billingStatus: string | null, exempt: boolean): Enrichment {
  const key = `${archived}|${billingStatus}|${exempt}`;
  const hit = enrichCache.get(id);
  const now = Date.now();
  if (hit && hit.key === key && now - hit.at < ENRICH_TTL_MS) return hit.value;
  let setup = { requiredDone: 0, requiredTotal: 0 };
  let risk: Enrichment["risk"] = { score: 0, level: "low" };
  let stage: string | null = null;
  let failed = false;
  try {
    const s = getSetupSummaryForTenant(id);
    setup = { requiredDone: s.requiredDone, requiredTotal: s.requiredTotal };
    const rk = churnRisk(riskFacts(id, setup));
    risk = { score: rk.score, level: rk.level };
    const m = getTenantMeta(id, { archived, billingStatus, exempt, setupRequiredDone: setup.requiredDone, setupRequiredTotal: setup.requiredTotal, riskScore: rk.score });
    stage = m.stage ?? m.stageAuto;
  } catch {
    // keep the row; the console shows blanks, and the blanks are not cached
    failed = true;
  }
  const value = { setup, risk, stage };
  if (!failed) enrichCache.set(id, { at: now, key, value });
  return value;
}
