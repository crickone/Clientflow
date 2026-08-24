// Pure: classifies the "what changed" feed (Market Research P1.1, UI
// refinement B) as either its slim, forward-looking empty state (nothing
// has actually changed yet — the initial discovery is just a seed) or the
// real per-event feed. No I/O, no DB, no network — and deliberately no
// import of anything from ./store either (not even a type-only one): this
// stays a standalone, zero-dependency pure file so it's safely importable
// from a "use client" component (ChangedFeed.tsx) without dragging in
// store.ts's `server-only` tag. Structural typing (`{type: string}`) is
// enough — a real `EventRow` satisfies it with no cast needed.
//
// On a first scan, the ONLY events on hand are `new_competitor` — the
// initial discovery, not a "change" yet. Showing that wall of near-identical
// rows (or even a big "N discovered" summary) as the feed's whole content
// reads as redundant on day one. But a `new_competitor` that arrives on a
// LATER scan (a gym genuinely opened nearby) is still worth surfacing
// prominently — only the very first bulk discovery is the seed.

/**
 * Rule: forward-looking (the slim empty state) IFF every event on hand is a
 * `new_competitor` discovery AND no tracked competitor has more than one
 * metric capture yet (`hasSubsequentScan` is false).
 *
 * The second clause is what actually distinguishes "the initial batch" from
 * "a gym that appeared on a later scan" — plain "are all events
 * new_competitor" alone can't: a later scan that finds one new gym but no
 * rating/review has moved enough yet to raise its own event would ALSO have
 * an all-new_competitor event set, and that new gym is still real news.
 *
 * `hasSubsequentScan` is why: `refreshTenant` (see refresh.ts) snapshots
 * EVERY tracked competitor's metrics on every cycle, including the very
 * first one — so after scan #1, every competitor (freshly-discovered ones
 * included) has exactly one metric capture. Only once a SECOND cycle has
 * run does any competitor accumulate a second capture. A `new_competitor`
 * event raised while that's still false is definitionally part of the seed;
 * one raised after is a later scan's real discovery and belongs in the real
 * feed. The caller computes this from data it already has in hand (e.g.
 * ResearchView's `historyById`) — `Object.values(historyById).some((h) =>
 * h.length > 1)` — no extra query needed.
 *
 * No events at all -> forward-looking too (nothing to show either way;
 * vacuously "every event is new_competitor" over an empty list).
 */
export function isForwardLookingFeed(
  events: ReadonlyArray<{ type: string }>,
  hasSubsequentScan: boolean,
): boolean {
  if (events.length === 0) return true;
  return !hasSubsequentScan && events.every((e) => e.type === "new_competitor");
}
