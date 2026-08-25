import type { CampaignStatus } from "./plan";
import type { CampaignEmailMetrics } from "./emailMetrics";

/**
 * Pure derived-metrics math for the campaign metrics panel (this task). Zero
 * imports at runtime (the two type-only imports above are erased at compile
 * time — see plan.ts's own header comment on why that keeps a module DB-free
 * for the plain-tsx test runner), same tier as ./scoreboard: no DB, no
 * server-only, safe to unit test directly with a plain static import.
 *
 * Every field is guarded independently against its OWN zero-denominator, not
 * a blanket "if anything is zero" check — e.g. `viewToLeadPct` is null only
 * when `landingViews` is 0, even if `leads` is also 0 (0 leads out of 200
 * views is a real, meaningful 0%, not an undefined value). See
 * panelMetrics.test.ts for the full guard matrix.
 */
export interface PanelMetricsInput {
  leads: number;
  converts: number;
  adSpendCents: number;
  upfrontCashCents: number;
  landingViews: number;
}

export interface PanelMetricsDerived {
  /** Ad spend / leads, in cents. Null unless there are BOTH leads and recorded spend. */
  costPerLeadCents: number | null;
  /** Upfront cash / converts, in cents. Null unless there's at least one convert. */
  revenuePerSaleCents: number | null;
  /** leads / landingViews * 100. Null only when there are 0 landing views (nothing to rate against). */
  viewToLeadPct: number | null;
  /** How much of ad spend the upfront cash covers, as a %. Null only when there's 0 ad spend. */
  cfaRatioPct: number | null;
  /** Upfront cash, cents — a pass-through of the scoreboard's own figure, labeled "cash collected" in the panel. */
  totalUpfrontCents: number;
}

export function computePanelMetrics(input: PanelMetricsInput): PanelMetricsDerived {
  const { leads, converts, adSpendCents, upfrontCashCents, landingViews } = input;
  return {
    costPerLeadCents: leads > 0 && adSpendCents > 0 ? Math.round(adSpendCents / leads) : null,
    revenuePerSaleCents: converts > 0 ? Math.round(upfrontCashCents / converts) : null,
    viewToLeadPct: landingViews > 0 ? (leads / landingViews) * 100 : null,
    cfaRatioPct: adSpendCents > 0 ? (upfrontCashCents / adSpendCents) * 100 : null,
    totalUpfrontCents: upfrontCashCents,
  };
}

/**
 * The full per-campaign payload the expandable metrics panel renders — one
 * object per campaign, computed entirely server-side (src/app/marketing/
 * campaigns/page.tsx) from the campaign row + its Scoreboard (./scoreboard +
 * ./scoreboardData) + the real Slice-4 build estimate (./costEstimate) +
 * email metrics (./emailMetrics) + this file's derived math, then passed
 * down as plain, serialisable props to the "use client" <CampaignRows>
 * (src/components/campaigns/CampaignRows.tsx), which does zero data fetching
 * of its own. `createdAt` is epoch ms (not a Date) to keep every field a
 * plain JSON-safe value across the server/client boundary.
 */
export interface CampaignMetrics extends PanelMetricsDerived {
  id: number;
  name: string;

  // campaign row
  season: string | null;
  status: CampaignStatus;
  createdAt: number; // epoch ms
  offer: string;
  startsOn: string | null;
  endsOn: string | null;
  landingViews: number;

  // Scoreboard (computeCampaignScoreboard's own field names, unchanged — this
  // stays a drop-in superset of it rather than a parallel/renamed copy).
  leads: number;
  converts: number;
  conversionRatePct: number | null;
  adSpendCents: number;
  upfrontCashCents: number;
  mrrCents: number;
  cacCents: number | null;
  cfaCovered: boolean;
  roas: number | null;

  // Build progress (today's "approved/total" column).
  assets: { approved: number; total: number };

  /** The REAL Slice-4 estimate (estimateCampaignBuildCents(assets, buildModel)) — NOT the roll-up's stubbed 0. */
  aiBuildCents: number;

  /** Null when no campaign email has been sent yet for this campaign. */
  email: CampaignEmailMetrics | null;

  /** Best-effort public landing-page URL (buildCampaignLandingUrl) — null pre-launch or with no CMS site yet. */
  landingUrl: string | null;
}
