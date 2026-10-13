// Heuristic build-cost estimate for a campaign kit. PURE: reuses the metering
// layer's own estCostCents + PRICING so the estimate and the real charge share
// one price source. Token counts are documented AVERAGES, not measurements.
import { estCostCents } from "@/lib/ai/client";
import type { AssetKind } from "@/lib/campaigns/plan";

// Re-exported (not defined here anymore) so every existing caller importing
// `formatCentsEur` from this module keeps working unchanged — see
// lib/utils.ts's doc on formatCentsEur for why the real definition moved
// there (a "use client" component needs to format money without dragging in
// this module's server-only @/lib/ai/client import below).
export { formatCentsEur } from "@/lib/utils";

/** Average input/output tokens per asset kind. Input is dominated by the
 *  Marketing Brain + prompt (~2–2.5k); output is sized to the asset. Estimates. */
export const AVG_TOKENS: Record<AssetKind, { in: number; out: number }> = {
  offer: { in: 2000, out: 500 },
  landing_page: { in: 2200, out: 450 },
  blog: { in: 2500, out: 1500 },
  social: { in: 2000, out: 200 },
  email: { in: 2200, out: 450 },
  ad_copy: { in: 2000, out: 180 },
  video_script: { in: 2200, out: 800 },
};

export function estimateCampaignBuildCents(assets: { kind: AssetKind }[], model: string): number {
  return assets.reduce((sum, a) => {
    const t = AVG_TOKENS[a.kind];
    if (!t) return sum; // unknown kind contributes nothing rather than throwing
    return sum + estCostCents(model, { inputTokens: t.in, outputTokens: t.out });
  }, 0);
}

/**
 * Designing a social post costs far more than writing it: each slide's
 * layout is a model call and most slides get an AI background photo. These
 * are averages measured from metered usage (Oct 2026: a designed carousel
 * ~EUR0.50-1.50, a single image ~EUR0.25-0.50), not a price list.
 */
export const DESIGN_CENTS = { carousel: 100, single: 35 } as const;

/** Writing + designing: what a kit really costs to build, before any reworks. */
export function estimateCampaignTotalCents(assets: { kind: AssetKind; title?: string }[], model: string): number {
  const design = assets.reduce((sum, a) => {
    if (a.kind !== "social") return sum;
    return sum + (/\bsingle\b/i.test(a.title ?? "") ? DESIGN_CENTS.single : DESIGN_CENTS.carousel);
  }, 0);
  return estimateCampaignBuildCents(assets, model) + design;
}
