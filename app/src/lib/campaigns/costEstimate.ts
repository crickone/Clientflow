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
