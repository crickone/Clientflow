import "server-only";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientMemberships, clientPackages, clients, leads, packages, pipelineStages, type Campaign } from "@/lib/db/schema";
import { findClientByPhone } from "@/lib/clientMessages";
import { countLeadsByCampaign } from "@/lib/leads";
import { WON_ROLES, type StageRole } from "@/lib/pipeline/roles";
import { normalizePhone } from "@/lib/whatsapp/phone";
import { computeCampaignScoreboard, type Scoreboard } from "./scoreboard";

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
  // MRR = current recurring run-rate: active memberships only.
  const activeMonthly = input.memberships.filter((m) => m.status === "active").map((m) => m.priceCents);
  const mrrCents = sum(activeMonthly);
  // Upfront first-month cash was already collected for any membership that
  // isn't cancelled — active AND expired (lapsed card, non-renewal, admin
  // close-out) both took a first payment; only a cancelled/refunded
  // membership gives that cash back. Mirrors clientPackages below, which
  // already counts `status !== "cancelled"` rather than active-only.
  const membershipFirstMonth = input.memberships.filter((m) => m.status !== "cancelled").map((m) => m.priceCents);
  const membershipFirstMonthCents = sum(membershipFirstMonth);
  const paidPackages = input.packages.filter((p) => p.status !== "cancelled").map((p) => p.priceCents);
  const upfrontCashCents = membershipFirstMonthCents + sum(paidPackages) + sum(input.clinicPackagesCents);
  return { upfrontCashCents, mrrCents };
}

/**
 * Pure: does a membership/package that started on `recordStartDate` count
 * toward a campaign whose paid run began on `campaignStartsOn`? This is the
 * testable core of the campaign-launch date-window fix (deferred from the
 * Slice-5 final review): without it, `gatherCampaignRevenue` summed a
 * convert's CURRENT memberships/packages with no time relation to the
 * campaign at all, so a client who was already a paying member for a year
 * and later re-converts on a brand-new campaign had their pre-existing
 * membership's revenue over-attributed to that new campaign. Scoping to
 * "started on/after the campaign launched" excludes that pre-existing
 * revenue while still counting a genuinely-new convert's membership.
 *
 * Null handling (both params are nullable — pick one behavior, document it):
 * - `campaignStartsOn == null` (campaign has no launch date recorded) →
 *   `true`, i.e. no window to scope against, so every record counts — this
 *   is the pre-fix behavior, preserved when there's nothing to scope to.
 * - `recordStartDate == null` → `false`. In practice `clientMemberships`/
 *   `clientPackages`.`startDate` and clinic `packages`.`purchaseDate` are all
 *   NOT NULL columns, so this branch shouldn't fire from real rows — it's a
 *   defensive fallback for the nullable type. Given the bug this fixes is
 *   OVER-attribution, the safe default when the record's start can't be
 *   confirmed is to EXCLUDE it, not include it.
 * - Both present → compare only the first 10 chars (`YYYY-MM-DD`) of each
 *   side rather than the raw strings. Every write path for these three date
 *   columns stores a bare `YYYY-MM-DD` today (confirmed by reading
 *   `lib/memberships.ts`, `lib/sessionPackages.ts`, `lib/packages.ts`, the
 *   assistant tool writers, and the CSV importer — see the Task report), so
 *   plain lexical `>=` would already work. The slice(0, 10) is a defensive
 *   guard against a future write path drifting to include a time component
 *   or a non-bare format on either side, which would otherwise corrupt a
 *   plain lexical compare.
 */
export function startedOnOrAfter(recordStartDate: string | null, campaignStartsOn: string | null): boolean {
  if (campaignStartsOn == null) return true;
  if (recordStartDate == null) return false;
  return recordStartDate.slice(0, 10) >= campaignStartsOn.slice(0, 10);
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
 * email, else by normalized phone (the lead carries email/phone from
 * intake). Phone reuses `findClientByPhone` (lib/clientMessages.ts), the
 * same normalize-then-compare match (`lib/whatsapp/phone.ts`'s
 * `normalizePhone`) used for inbound WhatsApp routing — raw string equality
 * would miss e.g. an ad-platform lead phone (`+353871234567`) against a
 * manually-typed client phone (`087 123 4567`).
 * Returns null when neither the lead nor a client match resolves — a won
 * lead that can't be tied to a client record is not a convert.
 */
function resolveClientId(row: { clientId: number | null; email: string | null; phone: string | null }): number | null {
  if (row.clientId != null) return row.clientId;

  const email = row.email?.trim().toLowerCase() || null;
  const phone = row.phone?.trim() || null;
  if (!email && !phone) return null;

  if (email) {
    const match = db
      .select({ id: clients.id })
      .from(clients)
      .where(eq(sql`lower(${clients.email})`, email))
      .get();
    if (match) return match.id;
  }

  if (phone) {
    const match = findClientByPhone(normalizePhone(phone));
    if (match) return match.id;
  }

  return null;
}

/**
 * A campaign's sign-ups, converts, and the revenue those converts carry —
 * the DB side of the CFA/ROAS scoreboard (Task 3 turns this into the metric
 * math; Task 4's hub page renders it). `campaignName` must be the exact
 * `campaign.name` string leads are attributed with (see countLeadsByCampaign).
 * Never throws — any unexpected failure degrades to all-zero.
 *
 * `campaignStartsOn` (the campaign's own `starts_on`, "ISO date or null" per
 * schema.ts) scopes revenue to memberships/packages that started on/after
 * the campaign launched — see `startedOnOrAfter` above for the full
 * rationale. Pass `null` for a campaign with no launch date set, which
 * disables the date window (unscoped, pre-fix behavior) rather than
 * excluding everything.
 *
 * Known remaining limitation (accepted, not fixed here): this scopes OUT a
 * pre-existing membership from a later, unrelated campaign, but it does NOT
 * give a client's membership single-campaign (first-touch) attribution. If
 * the SAME client re-converts on two different campaigns that both launched
 * before that membership's start date, that one membership's revenue is
 * still counted toward BOTH campaigns' scoreboards — there's no concept yet
 * of "this membership belongs to campaign A, not campaign B" once more than
 * one campaign's launch date is satisfied. Fixing that needs a real
 * first-touch/attribution model on the client or membership record, which is
 * a bigger design change than this date-window fix.
 */
export async function gatherCampaignRevenue(
  campaignName: string,
  campaignStartsOn: string | null,
): Promise<CampaignRevenue> {
  let leadCount = 0;
  try {
    leadCount = countLeadsByCampaign(campaignName);

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
    // Fetch each convert's memberships/packages, then date-scope them with
    // `startedOnOrAfter` against the campaign's own launch date BEFORE they
    // reach `aggregateConvertRevenue` (which stays pure {priceCents,status}
    // math — see its doc comment — so the scoping has to happen here, on the
    // raw rows, not inside it). Filtering in JS rather than a SQL `gte`
    // keeps one tested predicate as the single source of truth for all
    // three sources (gyms' clientMemberships/clientPackages AND the
    // clinic's packages below) instead of three separately-composed SQL
    // conditions, and it's cheap: this is already scoped to one campaign's
    // handful of converted client ids, not an unbounded table scan.
    const membershipRows = db
      .select({ priceCents: clientMemberships.priceCents, status: clientMemberships.status, startDate: clientMemberships.startDate })
      .from(clientMemberships)
      .where(inArray(clientMemberships.clientId, ids))
      .all();
    const memberships = membershipRows.filter((m) => startedOnOrAfter(m.startDate, campaignStartsOn));

    const clientPkgRows = db
      .select({ priceCents: clientPackages.priceCents, status: clientPackages.status, startDate: clientPackages.startDate })
      .from(clientPackages)
      .where(inArray(clientPackages.clientId, ids))
      .all();
    const clientPkgs = clientPkgRows.filter((p) => startedOnOrAfter(p.startDate, campaignStartsOn));

    // Clinic packages (schema.ts:159) have no `startDate`, but `purchaseDate`
    // (NOT NULL, written as bare YYYY-MM-DD by lib/packages.ts — see the
    // Task report) is the equivalent "when this started" field, so it's
    // scoped the same way. Gyms — the main campaign users — go through
    // clientMemberships/clientPackages above; this covers the clinic path
    // for the same accuracy fix.
    const clinicPkgRows = db
      .select({ pricePaidEur: packages.pricePaidEur, purchaseDate: packages.purchaseDate })
      .from(packages)
      .where(inArray(packages.clientId, ids))
      .all();
    const clinicPkgs = clinicPkgRows.filter((p) => startedOnOrAfter(p.purchaseDate, campaignStartsOn));

    const { upfrontCashCents, mrrCents } = aggregateConvertRevenue({
      memberships,
      packages: clientPkgs,
      clinicPackagesCents: clinicPkgs.map((p) => Math.round(p.pricePaidEur * 100)),
    });

    return { leads: leadCount, converts: clientIds.size, upfrontCashCents, mrrCents };
  } catch (err) {
    console.error("[scoreboardData] gatherCampaignRevenue failed:", err);
    return { leads: leadCount, ...ZERO_REVENUE };
  }
}

/**
 * Task 4 wrapper: `gatherCampaignRevenue` (above) + `computeCampaignScoreboard`
 * (./scoreboard, pure) composed into the one call the hub page makes.
 * `aiBuildCents` is a parameter, not computed in here, so the hub can pass in
 * the SAME figure its existing Slice-4 estimate line already computed
 * (`estimateCampaignBuildCents(assets, buildModel)`) — this avoids a second
 * `getCampaignBuildModel()` KV read and guarantees the scoreboard's "AI build
 * cost" can never disagree with the estimate line shown just above it.
 */
export async function getCampaignScoreboard(
  campaign: Pick<Campaign, "name" | "adSpendCents" | "startsOn">,
  aiBuildCents: number,
): Promise<Scoreboard> {
  const rev = await gatherCampaignRevenue(campaign.name, campaign.startsOn);
  return computeCampaignScoreboard({
    leads: rev.leads,
    converts: rev.converts,
    adSpendCents: campaign.adSpendCents,
    aiBuildCents,
    upfrontCashCents: rev.upfrontCashCents,
    mrrCents: rev.mrrCents,
  });
}
