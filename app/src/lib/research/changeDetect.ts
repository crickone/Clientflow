// Pure change-detection: diffs two consecutive weekly snapshots of a
// competitor (`Metric` rows from Task 4's store) into "what changed" events
// — rating up/down and review-count spikes. No I/O, no DB, no network
// (Market Research P1, Task 6) — this is the heart of the "living" feed.
//
// `new_competitor` events are raised by discovery (see discovery.ts) when a
// placeId is first seen, NOT here — this only ever diffs an EXISTING
// competitor's two consecutive metric captures.

import type { Metric, NewEvent } from "./store";

/** Minimum |Δrating| in milli-stars (thousandths of a star) to raise a rating_up/rating_down event. Default ±0.1 star. */
export const RATING_EVENT_THRESHOLD_MILLI = 100;

/** Minimum positive Δreview-count in one cycle to raise a review_spike event. */
export const REVIEW_SPIKE_THRESHOLD = 10;

/** milli-stars (e.g. 4300) -> a 1-decimal star string (e.g. "4.3"), for human-readable summaries. */
function formatStars(ratingMilli: number): string {
  return (ratingMilli / 1000).toFixed(1);
}

/**
 * Diffs `prev` (the previous weekly capture) against `next` (the latest) for
 * the same competitor and returns zero, one, or two events:
 *
 *  - a `rating_up` (next > prev) or `rating_down` (next < prev) event when
 *    both `ratingMilli`s are non-null and `|next - prev| >= ratingThresholdMilli`
 *    (default `RATING_EVENT_THRESHOLD_MILLI`, ±0.1 star). The summary formats
 *    the milli values back to 1-decimal stars, e.g. `"Iron Gym rating rose
 *    4.1 → 4.3"`; `detailJson` carries the raw prev/next/delta milli ints.
 *  - a `review_spike` event when both `reviewCount`s are non-null and the
 *    (strictly positive) jump `next - prev >= reviewSpikeThreshold` (default
 *    `REVIEW_SPIKE_THRESHOLD`). A drop is never a spike. `detailJson` carries
 *    the raw prev/next/delta counts.
 *
 * Both can fire from the same call (returned as a 2-element array).
 *
 * `prev === null` — the competitor's first-ever capture, no baseline to diff
 * against — always returns `[]`; the "new competitor" event for that case is
 * raised by discovery, not here. A null field on EITHER side skips only that
 * field's event (never throws, never crashes the other check); a
 * below-threshold change produces no event. `occurredAt` on every returned
 * event defaults to `next.capturedAt`.
 *
 * Integer comparisons only (`ratingMilli`, `reviewCount` are already
 * thousandths-of-a-star / whole-review integers) — no float rounding
 * surprises. Never throws.
 */
export function detectChanges(
  prev: Metric | null,
  next: Metric,
  competitorName: string,
  opts?: { ratingThresholdMilli?: number; reviewSpikeThreshold?: number },
): NewEvent[] {
  if (prev === null) return [];

  const ratingThresholdMilli = opts?.ratingThresholdMilli ?? RATING_EVENT_THRESHOLD_MILLI;
  const reviewSpikeThreshold = opts?.reviewSpikeThreshold ?? REVIEW_SPIKE_THRESHOLD;

  const events: NewEvent[] = [];

  if (prev.ratingMilli !== null && next.ratingMilli !== null) {
    const deltaMilli = next.ratingMilli - prev.ratingMilli;
    if (Math.abs(deltaMilli) >= ratingThresholdMilli) {
      const prevStars = formatStars(prev.ratingMilli);
      const nextStars = formatStars(next.ratingMilli);
      const rising = deltaMilli > 0;
      events.push({
        competitorId: next.competitorId,
        type: rising ? "rating_up" : "rating_down",
        summary: `${competitorName} rating ${rising ? "rose" : "fell"} ${prevStars} → ${nextStars}`,
        detailJson: JSON.stringify({
          prevRatingMilli: prev.ratingMilli,
          nextRatingMilli: next.ratingMilli,
          deltaMilli,
        }),
        occurredAt: next.capturedAt,
      });
    }
  }

  if (prev.reviewCount !== null && next.reviewCount !== null) {
    const delta = next.reviewCount - prev.reviewCount;
    // `delta > 0` guards a zero/negative custom threshold from turning a
    // flat or falling count into a "spike" — only a positive jump counts.
    if (delta > 0 && delta >= reviewSpikeThreshold) {
      events.push({
        competitorId: next.competitorId,
        type: "review_spike",
        summary: `${competitorName} gained ${delta} reviews since last check`,
        detailJson: JSON.stringify({
          prevReviewCount: prev.reviewCount,
          nextReviewCount: next.reviewCount,
          delta,
        }),
        occurredAt: next.capturedAt,
      });
    }
  }

  return events;
}
