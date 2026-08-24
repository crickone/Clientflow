// Run: npm test -- src/lib/research/changeDetect.test.ts
//
// Task 6 (Market Research P1) — pure change-detection tests, written FIRST
// (TDD): diffs two consecutive weekly Metric snapshots (Task 4's store) into
// "what changed" events. No I/O, no DB, no network — every case here is a
// synchronous, in-memory call.
import assert from "node:assert/strict";

import {
  detectChanges,
  RATING_EVENT_THRESHOLD_MILLI,
  REVIEW_SPIKE_THRESHOLD,
} from "./changeDetect";
import type { Metric } from "./store";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const NAME = "Iron Gym";

/** Fixture builder: a full Metric with sane defaults, overridable per field. */
function metric(over: Partial<Metric> = {}): Metric {
  return {
    id: 1,
    competitorId: 42,
    capturedAt: "2026-08-15T09:00:00.000Z",
    ratingMilli: 4200,
    reviewCount: 100,
    ...over,
  };
}

(async () => {
  // ════════════════════════════════════════════════════════════════════
  // Thresholds are the documented, exported defaults.
  // ════════════════════════════════════════════════════════════════════
  check("RATING_EVENT_THRESHOLD_MILLI is 100 (±0.1 star)", RATING_EVENT_THRESHOLD_MILLI === 100);
  check("REVIEW_SPIKE_THRESHOLD is 10", REVIEW_SPIKE_THRESHOLD === 10);

  // ════════════════════════════════════════════════════════════════════
  // 1. prev === null (first-ever snapshot) → [] — no baseline to diff.
  // ════════════════════════════════════════════════════════════════════
  {
    const events = detectChanges(null, metric(), NAME);
    check("1. prev null -> [] ", Array.isArray(events) && events.length === 0);
  }

  // ════════════════════════════════════════════════════════════════════
  // 2. rating +200 milli (4.1 → 4.3) → single rating_up.
  // ════════════════════════════════════════════════════════════════════
  {
    const prev = metric({ ratingMilli: 4100, reviewCount: 100 });
    const next = metric({ ratingMilli: 4300, reviewCount: 100 });
    const events = detectChanges(prev, next, NAME);
    check("2. rating +200 -> exactly 1 event", events.length === 1);
    check("2. rating +200 -> type rating_up", events[0].type === "rating_up");
    check(
      "2. rating +200 -> summary format",
      events[0].summary === "Iron Gym rating rose 4.1 → 4.3",
    );
    check("2. rating +200 -> competitorId from next", events[0].competitorId === next.competitorId);
    check("2. rating +200 -> occurredAt defaults to next.capturedAt", events[0].occurredAt === next.capturedAt);
    check(
      "2. rating +200 -> detailJson carries the numbers",
      JSON.stringify(JSON.parse(events[0].detailJson!)) ===
        JSON.stringify({ prevRatingMilli: 4100, nextRatingMilli: 4300, deltaMilli: 200 }),
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // 3. rating −200 milli (4.3 → 4.1) → single rating_down.
  // ════════════════════════════════════════════════════════════════════
  {
    const prev = metric({ ratingMilli: 4300, reviewCount: 100 });
    const next = metric({ ratingMilli: 4100, reviewCount: 100 });
    const events = detectChanges(prev, next, NAME);
    check("3. rating -200 -> exactly 1 event", events.length === 1);
    check("3. rating -200 -> type rating_down", events[0].type === "rating_down");
    check(
      "3. rating -200 -> summary format",
      events[0].summary === "Iron Gym rating fell 4.3 → 4.1",
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // 4. rating +50 (below the 100 threshold) → no event.
  // ════════════════════════════════════════════════════════════════════
  {
    const prev = metric({ ratingMilli: 4200, reviewCount: 100 });
    const next = metric({ ratingMilli: 4250, reviewCount: 100 });
    const events = detectChanges(prev, next, NAME);
    check("4. rating +50 (below threshold) -> []", events.length === 0);
  }

  // ════════════════════════════════════════════════════════════════════
  // 5. reviewCount +14 → single review_spike.
  // ════════════════════════════════════════════════════════════════════
  {
    const prev = metric({ ratingMilli: 4200, reviewCount: 100 });
    const next = metric({ ratingMilli: 4200, reviewCount: 114 });
    const events = detectChanges(prev, next, NAME);
    check("5. reviews +14 -> exactly 1 event", events.length === 1);
    check("5. reviews +14 -> type review_spike", events[0].type === "review_spike");
    check(
      "5. reviews +14 -> summary format",
      events[0].summary === "Iron Gym gained 14 reviews since last check",
    );
    check(
      "5. reviews +14 -> detailJson carries the numbers",
      JSON.stringify(JSON.parse(events[0].detailJson!)) ===
        JSON.stringify({ prevReviewCount: 100, nextReviewCount: 114, delta: 14 }),
    );
  }

  // ════════════════════════════════════════════════════════════════════
  // 6. reviewCount +3 (below the 10 threshold) → no event.
  // ════════════════════════════════════════════════════════════════════
  {
    const prev = metric({ ratingMilli: 4200, reviewCount: 100 });
    const next = metric({ ratingMilli: 4200, reviewCount: 103 });
    const events = detectChanges(prev, next, NAME);
    check("6. reviews +3 (below threshold) -> []", events.length === 0);
  }

  // ════════════════════════════════════════════════════════════════════
  // 7. reviewCount −5 (a drop) → no event — only positive jumps are spikes.
  // ════════════════════════════════════════════════════════════════════
  {
    const prev = metric({ ratingMilli: 4200, reviewCount: 100 });
    const next = metric({ ratingMilli: 4200, reviewCount: 95 });
    const events = detectChanges(prev, next, NAME);
    check("7. reviews -5 (a drop) -> []", events.length === 0);
  }

  // ════════════════════════════════════════════════════════════════════
  // 8. rating +200 AND reviews +20 → BOTH events, one call.
  // ════════════════════════════════════════════════════════════════════
  {
    const prev = metric({ ratingMilli: 4100, reviewCount: 100 });
    const next = metric({ ratingMilli: 4300, reviewCount: 120 });
    const events = detectChanges(prev, next, NAME);
    check("8. rating+review both fire -> exactly 2 events", events.length === 2);
    check("8. contains a rating_up event", events.some((e) => e.type === "rating_up"));
    check("8. contains a review_spike event", events.some((e) => e.type === "review_spike"));
  }

  // ════════════════════════════════════════════════════════════════════
  // 9. next.ratingMilli null → no rating event (and no crash); the review
  //    event is still evaluated independently.
  // ════════════════════════════════════════════════════════════════════
  {
    const prev = metric({ ratingMilli: 4100, reviewCount: 100 });
    const next = metric({ ratingMilli: null, reviewCount: 120 });
    let events: ReturnType<typeof detectChanges> = [];
    assert.doesNotThrow(() => {
      events = detectChanges(prev, next, NAME);
    });
    check("9. next.ratingMilli null -> no crash, only review_spike survives", events.length === 1);
    check("9. surviving event is review_spike", events[0].type === "review_spike");
  }

  // ════════════════════════════════════════════════════════════════════
  // 10. custom opts thresholds are respected (both raising and lowering).
  // ════════════════════════════════════════════════════════════════════
  {
    // rating +200 (fires under the 100 default), reviews +6 (does NOT fire
    // under the 10 default).
    const prev = metric({ ratingMilli: 4200, reviewCount: 100 });
    const next = metric({ ratingMilli: 4400, reviewCount: 106 });

    const withDefaults = detectChanges(prev, next, NAME);
    check("10. baseline: default thresholds fire rating, not review", withDefaults.length === 1 && withDefaults[0].type === "rating_up");

    // Raise the rating threshold above +200 -> suppressed. Lower the review
    // threshold to <=6 -> now fires.
    const withCustom = detectChanges(prev, next, NAME, {
      ratingThresholdMilli: 300,
      reviewSpikeThreshold: 5,
    });
    check("10. custom ratingThresholdMilli=300 suppresses a +200 change", !withCustom.some((e) => e.type === "rating_up"));
    check("10. custom reviewSpikeThreshold=5 allows a +6 change", withCustom.some((e) => e.type === "review_spike"));
  }

  // ════════════════════════════════════════════════════════════════════
  // Extra robustness/boundary coverage beyond the 10-case table above.
  // ════════════════════════════════════════════════════════════════════

  // Exactly-at-threshold is inclusive (>=), for both event types.
  {
    const prev = metric({ ratingMilli: 4200, reviewCount: 100 });
    const next = metric({ ratingMilli: 4300, reviewCount: 110 }); // exactly +100 / +10
    const events = detectChanges(prev, next, NAME);
    check("boundary: rating diff == threshold fires", events.some((e) => e.type === "rating_up"));
    check("boundary: review diff == threshold fires", events.some((e) => e.type === "review_spike"));
  }

  // One milli under threshold does not fire.
  {
    const prev = metric({ ratingMilli: 4200, reviewCount: 100 });
    const next = metric({ ratingMilli: 4299, reviewCount: 109 }); // +99 / +9
    const events = detectChanges(prev, next, NAME);
    check("boundary: rating diff == threshold-1 -> []", !events.some((e) => e.type === "rating_up"));
    check("boundary: review diff == threshold-1 -> []", !events.some((e) => e.type === "review_spike"));
  }

  // prev.ratingMilli null (next non-null) -> rating side skipped too (needs BOTH non-null).
  {
    const prev = metric({ ratingMilli: null, reviewCount: 100 });
    const next = metric({ ratingMilli: 4300, reviewCount: 100 });
    const events = detectChanges(prev, next, NAME);
    check("prev.ratingMilli null -> no rating event", events.length === 0);
  }

  // reviewCount null on either side -> review side skipped, no crash.
  {
    const prev = metric({ ratingMilli: 4200, reviewCount: null });
    const next = metric({ ratingMilli: 4200, reviewCount: 120 });
    const events = detectChanges(prev, next, NAME);
    check("prev.reviewCount null -> no review event", events.length === 0);
  }
  {
    const prev = metric({ ratingMilli: 4200, reviewCount: 100 });
    const next = metric({ ratingMilli: 4200, reviewCount: null });
    const events = detectChanges(prev, next, NAME);
    check("next.reviewCount null -> no review event", events.length === 0);
  }

  // Both fields null on both sides at once -> [], never throws.
  {
    const prev = metric({ ratingMilli: null, reviewCount: null });
    const next = metric({ ratingMilli: null, reviewCount: null });
    let events: ReturnType<typeof detectChanges> = [];
    assert.doesNotThrow(() => {
      events = detectChanges(prev, next, NAME);
    });
    check("all-null both sides -> [] (no crash)", events.length === 0);
  }

  // No change at all -> [].
  {
    const same = metric();
    const events = detectChanges(same, metric(), NAME);
    check("identical snapshots -> []", events.length === 0);
  }

  // occurredAt defaults to next.capturedAt even when next.capturedAt differs from prev's.
  {
    const prev = metric({ ratingMilli: 4100, reviewCount: 100, capturedAt: "2026-08-08T09:00:00.000Z" });
    const next = metric({ ratingMilli: 4300, reviewCount: 120, capturedAt: "2026-08-15T09:00:00.000Z" });
    const events = detectChanges(prev, next, NAME);
    check(
      "occurredAt on every event defaults to next.capturedAt, not prev's",
      events.every((e) => e.occurredAt === "2026-08-15T09:00:00.000Z"),
    );
  }

  // Never throws even with an unusual (zero/negative) custom threshold.
  {
    const prev = metric({ ratingMilli: 4200, reviewCount: 100 });
    const next = metric({ ratingMilli: 4200, reviewCount: 100 });
    assert.doesNotThrow(() => {
      detectChanges(prev, next, NAME, { ratingThresholdMilli: 0, reviewSpikeThreshold: 0 });
    });
    check("zero custom thresholds -> never throws", true);
  }

  console.log(`\nchangeDetect: ${passed} checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
