// Run: npm test -- src/lib/research/feedState.test.ts
//
// Market Research P1.1, UI refinement B: TDD for isForwardLookingFeed, the
// pure rule deciding whether ChangedFeed shows its slim "watching for
// changes" empty state or the real per-event feed. Plain literals only — no
// shim, no tenant, no network (same style as distance.test.ts).
import assert from "node:assert/strict";

import { isForwardLookingFeed } from "./feedState";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const discovery = (n = 1) => Array.from({ length: n }, () => ({ type: "new_competitor" }));

// No events at all -> forward-looking regardless of hasSubsequentScan.
check("isForwardLookingFeed: no events, no subsequent scan -> true", isForwardLookingFeed([], false) === true);
check("isForwardLookingFeed: no events, EVEN with a subsequent scan -> true (nothing to show either way)", isForwardLookingFeed([], true) === true);

// All new_competitor, still within the first scan (no subsequent scan yet) -> forward-looking.
check(
  "isForwardLookingFeed: all new_competitor, one seed batch, no subsequent scan -> true",
  isForwardLookingFeed(discovery(1), false) === true,
);
check(
  "isForwardLookingFeed: all new_competitor, a LARGE seed batch (20), no subsequent scan -> true (count doesn't matter, only recency does)",
  isForwardLookingFeed(discovery(20), false) === true,
);

// All new_competitor, but a subsequent scan HAS happened -> a later gym is real news, not forward-looking.
check(
  "isForwardLookingFeed: all new_competitor, but a subsequent scan has run -> false (a later-scan new gym is real)",
  isForwardLookingFeed(discovery(1), true) === false,
);
check(
  "isForwardLookingFeed: several new_competitor events after a subsequent scan -> still false",
  isForwardLookingFeed(discovery(3), true) === false,
);

// Any real change event -> never forward-looking, regardless of hasSubsequentScan.
check(
  "isForwardLookingFeed: a mix including one real change event, no subsequent scan -> false",
  isForwardLookingFeed([...discovery(2), { type: "rating_up" }], false) === false,
);
check(
  "isForwardLookingFeed: a mix including one real change event, WITH a subsequent scan -> false",
  isForwardLookingFeed([...discovery(2), { type: "review_spike" }], true) === false,
);
check(
  "isForwardLookingFeed: only real change events, no discovery at all -> false",
  isForwardLookingFeed([{ type: "rating_down" }], true) === false,
);
check(
  "isForwardLookingFeed: only real change events, no discovery, no subsequent scan flag -> still false (a real change event always wins)",
  isForwardLookingFeed([{ type: "review_spike" }], false) === false,
);

console.log(`\nfeedState: ${passed} checks passed.`);
