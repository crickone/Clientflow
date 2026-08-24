/**
 * Pure recency guard for `rescanNowAction`'s manual-path cost guard (Market
 * Research P1, Task 11) — the debounce that stops a "Rescan now" click from
 * re-spending Places/AI budget when the watchlist was refreshed only
 * moments ago (a double-click, or an operator mashing the button while a
 * previous scan is still settling). No I/O: takes the already-loaded
 * watchlist (or just the timestamp) and "now" as plain arguments, same shape
 * as this module's siblings distance.ts/changeDetect.ts, so it's testable
 * with plain literals — see debounce.test.ts.
 *
 * Deliberately duck-typed (no import of `CompetitorRow` from ./store): the
 * only field either function touches is `lastRefreshedAt`, so a minimal
 * structural type keeps this module at zero imports.
 */

/** The manual-rescan debounce window: ~5 minutes. */
export const RESCAN_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * The most recent `lastRefreshedAt` (ISO string) across a set of
 * competitors, or null if none has ever been refreshed. A malformed/
 * unparseable timestamp is ignored — never chosen as "most recent", never
 * thrown on — so one bad row can't poison the whole check.
 */
export function mostRecentRefreshAt(
  competitors: readonly { lastRefreshedAt: string | null }[],
): string | null {
  let latest: string | null = null;
  let latestMs = -Infinity;
  for (const c of competitors) {
    if (!c.lastRefreshedAt) continue;
    const ms = new Date(c.lastRefreshedAt).getTime();
    if (Number.isFinite(ms) && ms > latestMs) {
      latestMs = ms;
      latest = c.lastRefreshedAt;
    }
  }
  return latest;
}

/**
 * True when `lastRefreshedAt` (ISO, or null for "never refreshed") falls
 * strictly within `windowMs` of `now` — i.e. elapsed < windowMs, so a
 * capture exactly AT the boundary (elapsed === windowMs) is treated as no
 * longer recent and a rescan is allowed through. A null or unparseable
 * timestamp is never "just scanned" (returns false) — only a genuinely
 * recent, valid capture debounces a rescan.
 */
export function wasRecentlyScanned(
  lastRefreshedAt: string | null,
  now: Date = new Date(),
  windowMs: number = RESCAN_DEBOUNCE_MS,
): boolean {
  if (!lastRefreshedAt) return false;
  const ms = new Date(lastRefreshedAt).getTime();
  if (!Number.isFinite(ms)) return false;
  return now.getTime() - ms < windowMs;
}
