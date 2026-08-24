/**
 * Pure parse/validate for the `competitors.themes_json` cache value written
 * by `lib/research/summary.ts`'s `competitorThemes` — always
 * `JSON.stringify({themes, at})` (see that function's doc comment). Split
 * out into its own zero-dependency module (Task 11) rather than living only
 * inside CompetitorDetail.tsx (T10, where this exact logic first shipped as
 * a private helper) because a SECOND consumer now needs the identical
 * parsing: `lib/research/campaignGap.ts`'s "build a campaign from this gap"
 * seed builder, which reads a competitor's cached theme the same way.
 *
 * Deliberately NOT `server-only` and NOT importing anything: summary.ts
 * (the writer) has `import "server-only"`, but CompetitorDetail.tsx (a
 * CLIENT component, reading this to render the cached themes list) can never
 * import a server-only module — so the shared parser has to live somewhere
 * with no such restriction, importable from both a server module and a
 * client component alike. Same placement reasoning as
 * `components/marketing/buildCampaignSeed.ts`.
 */

export type ParsedThemes = { themes: string[]; at: string };

/**
 * Never throws: a missing key, malformed JSON, or an unexpected shape all
 * fall back to `null` rather than crash a caller over a cache read (mirrors
 * lib/research/discovery.ts's readCachedCentre() — "validate the shape,
 * never trust the cast" for a value this module didn't itself write).
 */
export function parseStoredThemes(themesJson: string | null): ParsedThemes | null {
  if (!themesJson) return null;
  try {
    const raw = JSON.parse(themesJson) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const { themes, at } = raw as Record<string, unknown>;
    if (!Array.isArray(themes) || typeof at !== "string") return null;
    const clean = themes.filter((t): t is string => typeof t === "string" && t.trim().length > 0);
    return clean.length > 0 ? { themes: clean, at } : null;
  } catch {
    return null;
  }
}
