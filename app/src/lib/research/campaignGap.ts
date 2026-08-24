import { parseStoredThemes } from "./themesJson";

/**
 * Builds the campaign-seed content (seedName + angle) for "Build a campaign
 * from this gap" (Market Research P1, Task 11) — the same seed contract
 * Campaign Engine Slice 3's seasonal calendar already feeds into the
 * Marketing agent's chat (see components/marketing/buildCampaignSeed.ts's
 * `CampaignSeed` + `buildCampaignSeedHref`). This module only decides WHAT
 * to put in the seed's `seedName`/`angle` fields from a competitor's cached
 * data; turning that into a URL is `buildCampaignSeedHref`'s job (called by
 * the server action, not here) — kept separate so this stays a plain, pure,
 * zero-Next-import function testable with literals (see campaignGap.test.ts).
 *
 * HOUSE RULE (no fabrication, same constraint lib/research/summary.ts's two
 * AI helpers enforce on the model): every fact used here — rating, review
 * count, theme — comes straight from the competitor's own CACHED data. A
 * competitor with no rating/reviews/themes yet still gets a seed, just a
 * more generic one; nothing is invented, guessed, or rounded to fill a gap.
 */

export interface CompetitorGapInput {
  name: string;
  /** From latestMetric(id).ratingMilli / 1000, or null if never captured. */
  ratingStars: number | null;
  /** From latestMetric(id).reviewCount, or null if never captured. */
  reviewCount: number | null;
  /** The competitor's raw `themesJson` column value, or null. */
  themesJson: string | null;
}

export interface CompetitorGapSeed {
  seedName: string;
  angle: string;
}

/** "★4.3, 128 reviews" / "★4.3" / "128 reviews" / "" — only the facts actually on hand. */
function formatStatsLabel(ratingStars: number | null, reviewCount: number | null): string {
  const stats: string[] = [];
  if (ratingStars != null) stats.push(`★${ratingStars.toFixed(1)}`);
  if (reviewCount != null) stats.push(`${reviewCount} review${reviewCount === 1 ? "" : "s"}`);
  return stats.length > 0 ? ` (${stats.join(", ")})` : "";
}

export function buildCompetitorGapSeed(input: CompetitorGapInput): CompetitorGapSeed {
  const statsLabel = formatStatsLabel(input.ratingStars, input.reviewCount);
  const parsedThemes = parseStoredThemes(input.themesJson);
  const theme = parsedThemes?.themes[0] ?? null;

  const angle = theme
    ? `A nearby competitor, ${input.name}${statsLabel}, has reviews calling out: "${theme}". Position us as the better choice on exactly that gap and win their members over.`
    : `A nearby competitor, ${input.name}${statsLabel}, is on our radar. Highlight what makes us the stronger choice nearby.`;

  return { seedName: `Win over ${input.name}'s members`, angle };
}
