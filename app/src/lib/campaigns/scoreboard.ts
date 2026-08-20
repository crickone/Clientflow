export interface ScoreboardInput {
  leads: number; converts: number; adSpendCents: number;
  aiBuildCents: number; upfrontCashCents: number; mrrCents: number;
}
export interface Scoreboard {
  leads: number; converts: number; conversionRatePct: number | null;
  adSpendCents: number; aiBuildCents: number; cacCents: number | null;
  upfrontCashCents: number; mrrCents: number;
  cfaCovered: boolean; roas: number | null;
}

export function computeCampaignScoreboard(i: ScoreboardInput): Scoreboard {
  const hasSpend = i.adSpendCents > 0;
  return {
    leads: i.leads,
    converts: i.converts,
    conversionRatePct: i.leads > 0 ? (i.converts / i.leads) * 100 : null,
    adSpendCents: i.adSpendCents,
    aiBuildCents: i.aiBuildCents,
    cacCents: hasSpend && i.converts > 0 ? Math.round(i.adSpendCents / i.converts) : null,
    upfrontCashCents: i.upfrontCashCents,
    mrrCents: i.mrrCents,
    cfaCovered: hasSpend && i.upfrontCashCents >= i.adSpendCents,
    roas: hasSpend ? i.upfrontCashCents / i.adSpendCents : null,
  };
}
