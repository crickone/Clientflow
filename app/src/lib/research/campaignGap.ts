import { parseStoredThemes } from "./themesJson";
import { parseStoredAdAngle } from "./adAngleJson";

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
 * count, theme, ad angle — comes straight from the competitor's own CACHED
 * data. A competitor with no rating/reviews/themes/ads yet still gets a
 * seed, just a more generic one; nothing is invented, guessed, or rounded to
 * fill a gap.
 *
 * Market Research P2, Task 7 folds in a second cached signal alongside
 * themes: the competitor's cached AI ad-angle read (`adAngleJson`, written
 * by lib/research/summary.ts's `adAngle` — Task 5). Same shape as the theme
 * handling below — parsed via the sibling `adAngleJson.ts` module's
 * `parseStoredAdAngle` (never throws, null on missing/malformed/empty) and,
 * when present, appended as its own sentence asking the agent to counter it.
 * `adAngle` only ever caches a genuine AI-generated read (it never caches its
 * own fallback text — see that function's doc comment), so a non-null parse
 * here is always real data, never a placeholder string leaking through.
 */

export interface CompetitorGapInput {
  name: string;
  /** From latestMetric(id).ratingMilli / 1000, or null if never captured. */
  ratingStars: number | null;
  /** From latestMetric(id).reviewCount, or null if never captured. */
  reviewCount: number | null;
  /** The competitor's raw `themesJson` column value, or null. */
  themesJson: string | null;
  /** The competitor's raw `adAngleJson` cache column value, or null (Market Research P2, Task 7). */
  adAngleJson: string | null;
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

/**
 * " They're currently running ads pushing: \"...\". Build a campaign that
 * counters it and wins those members to us." / "" — only when a genuine
 * cached ad-angle read is on hand (Market Research P2, Task 7); omitted
 * entirely (never a generic "they run ads" filler) when there isn't one, per
 * the module's no-fabrication house rule. Appended as its own trailing
 * sentence onto EITHER of `buildCompetitorGapSeed`'s two branches below, so
 * it composes with or without a cached theme.
 */
function formatAdAngleClause(adAngleJson: string | null): string {
  const parsedAdAngle = parseStoredAdAngle(adAngleJson);
  if (!parsedAdAngle) return "";
  return ` They're currently running ads pushing: "${parsedAdAngle.angle}". Build a campaign that counters it and wins those members to us.`;
}

export function buildCompetitorGapSeed(input: CompetitorGapInput): CompetitorGapSeed {
  const statsLabel = formatStatsLabel(input.ratingStars, input.reviewCount);
  const parsedThemes = parseStoredThemes(input.themesJson);
  const theme = parsedThemes?.themes[0] ?? null;
  const adAngleClause = formatAdAngleClause(input.adAngleJson);

  const angle = theme
    ? `A nearby competitor, ${input.name}${statsLabel}, has reviews calling out: "${theme}". Position us as the better choice on exactly that gap and win their members over.${adAngleClause}`
    : `A nearby competitor, ${input.name}${statsLabel}, is on our radar. Highlight what makes us the stronger choice nearby.${adAngleClause}`;

  return { seedName: `Win over ${input.name}'s members`, angle };
}
