/**
 * Pure parse/validate for the `competitors.ad_angle_json` cache value written
 * by `lib/research/summary.ts`'s `adAngle` — always `JSON.stringify({angle,
 * at})` (see that function's doc comment). Mirrors `themesJson.ts`'s
 * `parseStoredThemes` one column pair over (`adAngleJson`/`adAngleAt` instead
 * of `themesJson`/`themesAt`) — same reason for a standalone, zero-dependency
 * module: summary.ts (the writer) is `server-only`, but CompetitorDetail.tsx
 * (a CLIENT component, reading this to render the cached ad-angle line) can
 * never import it — so the shared parser has to live somewhere with no such
 * restriction, importable from both a server module and a client component
 * alike. Market Research P2, Task 6.
 */

export type ParsedAdAngle = { angle: string; at: string };

/**
 * Never throws: a missing key, malformed JSON, or an unexpected shape all
 * fall back to `null` rather than crash a caller over a cache read (mirrors
 * `parseStoredThemes` / lib/research/discovery.ts's readCachedCentre() —
 * "validate the shape, never trust the generic cast" for a value this module
 * didn't itself write).
 */
export function parseStoredAdAngle(adAngleJson: string | null): ParsedAdAngle | null {
  if (!adAngleJson) return null;
  try {
    const raw = JSON.parse(adAngleJson) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const { angle, at } = raw as Record<string, unknown>;
    if (typeof angle !== "string" || typeof at !== "string" || angle.trim().length === 0) return null;
    return { angle, at };
  } catch {
    return null;
  }
}
