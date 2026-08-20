import "server-only";
import { eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientMemberships, clientPackages, clients, leads, packages, pipelineStages } from "@/lib/db/schema";
import { countLeadsByCampaign } from "@/lib/leads";
import { WON_ROLES, type StageRole } from "@/lib/pipeline/roles";

// ── pure aggregation ────────────────────────────────────────────────────
//
// No DB, no imports — kept separately exported/testable (Task 3-style),
// even though the DB gatherer below is the file's only in-repo caller.

export type MembershipRec = { priceCents: number; status: "active" | "expired" | "cancelled" };
export type PackageRec = { priceCents: number; status: "active" | "expired" | "cancelled" };

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Pure: converts' membership/package records → { upfrontCashCents, mrrCents }. */
export function aggregateConvertRevenue(input: {
  memberships: MembershipRec[];
  packages: PackageRec[];
  clinicPackagesCents: number[];
}): { upfrontCashCents: number; mrrCents: number } {
  const activeMonthly = input.memberships.filter((m) => m.status === "active").map((m) => m.priceCents);
  const mrrCents = sum(activeMonthly);
  const paidPackages = input.packages.filter((p) => p.status !== "cancelled").map((p) => p.priceCents);
  const upfrontCashCents = mrrCents /* first month of each active membership */ + sum(paidPackages) + sum(input.clinicPackagesCents);
  return { upfrontCashCents, mrrCents };
}

// ── DB gatherer (Campaign Engine Slice 5, Task 2 — integration, not unit-tested) ──
//
// Traces one campaign's revenue: campaign → its won-stage leads → their
// client → that client's memberships/packages. Everything below reads
// through the ambient, request-scoped `db` proxy (see lib/db/index.ts) —
// the current tenant's own SQLite file — so every query here is already
// structurally tenant-scoped; there is no explicit tenantId filter to add.

export type CampaignRevenue = {
  leads: number;
  converts: number;
  upfrontCashCents: number;
  mrrCents: number;
};

const ZERO_REVENUE = { converts: 0, upfrontCashCents: 0, mrrCents: 0 };

/**
 * Resolve one won lead row to a client id: the lead's own `clientId` when
 * set, else a `clients` row in this tenant's db matched by case-insensitive
 * email or exact phone equality (the lead carries email/phone from intake).
 * Returns null when neither the lead nor a client match resolves — a won
 * lead that can't be tied to a client record is not a convert.
 */
function resolveClientId(row: { clientId: number | null; email: string | null; phone: string | null }): number | null {
  if (row.clientId != null) return row.clientId;

  const email = row.email?.trim().toLowerCase() || null;
  const phone = row.phone?.trim() || null;
  if (!email && !phone) return null;

  const clauses = [];
  if (email) clauses.push(eq(sql`lower(${clients.email})`, email));
  if (phone) clauses.push(eq(clients.phone, phone));

  const match = db
    .select({ id: clients.id })
    .from(clients)
    .where(or(...clauses))
    .get();
  return match?.id ?? null;
}

/**
 * A campaign's sign-ups, converts, and the revenue those converts carry —
 * the DB side of the CFA/ROAS scoreboard (Task 3 turns this into the metric
 * math; Task 4's hub page renders it). `campaignName` must be the exact
 * `campaign.name` string leads are attributed with (see countLeadsByCampaign).
 * Never throws — any unexpected failure degrades to all-zero.
 */
export async function gatherCampaignRevenue(campaignName: string): Promise<CampaignRevenue> {
  try {
    const leadCount = countLeadsByCampaign(campaignName);

    // Won-stage leads for this campaign: left-join the (possibly absent)
    // stage, then keep only rows whose stage role is a WON_ROLES member —
    // mirrors listLeadsForBoard's join shape (lib/leads.ts) and boardMetrics'
    // `role != null && WON_ROLES.has(role)` check (lib/pipeline/boardMetrics.ts).
    const campaignLeadRows = db
      .select({
        clientId: leads.clientId,
        email: leads.email,
        phone: leads.phone,
        role: pipelineStages.role,
      })
      .from(leads)
      .leftJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
      .where(eq(leads.campaign, campaignName))
      .all();

    const wonRows = campaignLeadRows.filter(
      (r): r is typeof r & { role: StageRole } => r.role != null && WON_ROLES.has(r.role as StageRole),
    );
    if (wonRows.length === 0) return { leads: leadCount, ...ZERO_REVENUE };

    const clientIds = new Set<number>();
    for (const row of wonRows) {
      const id = resolveClientId(row);
      if (id != null) clientIds.add(id);
    }
    if (clientIds.size === 0) return { leads: leadCount, ...ZERO_REVENUE };

    const ids = [...clientIds];
    const memberships = db
      .select({ priceCents: clientMemberships.priceCents, status: clientMemberships.status })
      .from(clientMemberships)
      .where(inArray(clientMemberships.clientId, ids))
      .all();
    const clientPkgs = db
      .select({ priceCents: clientPackages.priceCents, status: clientPackages.status })
      .from(clientPackages)
      .where(inArray(clientPackages.clientId, ids))
      .all();
    const clinicPkgs = db
      .select({ pricePaidEur: packages.pricePaidEur })
      .from(packages)
      .where(inArray(packages.clientId, ids))
      .all();

    const { upfrontCashCents, mrrCents } = aggregateConvertRevenue({
      memberships,
      packages: clientPkgs,
      clinicPackagesCents: clinicPkgs.map((p) => Math.round(p.pricePaidEur * 100)),
    });

    return { leads: leadCount, converts: clientIds.size, upfrontCashCents, mrrCents };
  } catch (err) {
    console.error("[scoreboardData] gatherCampaignRevenue failed:", err);
    return { leads: 0, ...ZERO_REVENUE };
  }
}
