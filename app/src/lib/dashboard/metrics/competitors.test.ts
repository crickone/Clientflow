// Run: npm test -- src/lib/dashboard/metrics/competitors.test.ts
import assert from "node:assert/strict";
import {
  averageCount,
  eventsInRange,
  mergeRatingSeries,
  newestReviews,
  reviewsGained,
  starsLabel,
} from "./competitors";

// averageCount ignores nulls, null when nothing to average
assert.equal(averageCount([10, null, 20]), 15);
assert.equal(averageCount([null]), null);
assert.equal(averageCount([]), null);

// starsLabel
assert.equal(starsLabel(4000), "4 stars");
assert.equal(starsLabel(1000), "1 star");
assert.equal(starsLabel(4500), "4.5 stars");
assert.equal(starsLabel(null), "");

// eventsInRange: type + ISO range, [from, to)
const evs = [
  { type: "new_ad", occurredAt: "2026-10-01T10:00:00.000Z" },
  { type: "new_ad", occurredAt: "2026-09-01T10:00:00.000Z" },
  { type: "rating_up", occurredAt: "2026-10-01T10:00:00.000Z" },
  { type: "new_ad", occurredAt: "not a date" },
];
assert.equal(eventsInRange(evs, "new_ad", Date.parse("2026-09-30T00:00:00Z"), Date.parse("2026-10-02T00:00:00Z")), 1);

// reviewsGained: latest at/before end minus latest at/before start; null when a bound is missing
const hist = [
  { capturedAt: "2026-09-01T00:00:00.000Z", reviewCount: 100 },
  { capturedAt: "2026-09-15T00:00:00.000Z", reviewCount: 110 },
  { capturedAt: "2026-09-29T00:00:00.000Z", reviewCount: 125 },
  { capturedAt: "2026-09-29T00:00:00.000Z", reviewCount: null },
];
assert.equal(reviewsGained(hist, Date.parse("2026-09-16T00:00:00Z"), Date.parse("2026-09-30T00:00:00Z")), 15);
assert.equal(reviewsGained(hist, Date.parse("2026-08-01T00:00:00Z"), Date.parse("2026-09-30T00:00:00Z")), null, "no point before start");
assert.equal(reviewsGained([], 0, 1), null);

// mergeRatingSeries: weekly merge, ascending, self first, other names kept
const merged = mergeRatingSeries([
  { name: "You", points: [{ capturedAt: "2026-09-29T09:00:00.000Z", rating: 4.6 }, { capturedAt: "2026-09-22T09:00:00.000Z", rating: 4.5 }] },
  { name: "Rival", points: [{ capturedAt: "2026-09-30T09:00:00.000Z", rating: 4.2 }] },
]);
assert.equal(merged.data.length, 2);
assert.deepEqual(merged.data.map((r) => r.week), ["2026-09-21", "2026-09-28"]);
assert.equal(merged.data[1]["You"], 4.6);
assert.equal(merged.data[1]["Rival"], 4.2);
assert.equal(merged.data[0]["Rival"], undefined);
assert.deepEqual(merged.names, ["You", "Rival"]);
// duplicate names disambiguated
assert.deepEqual(mergeRatingSeries([{ name: "A", points: [] }, { name: "A", points: [] }]).names, ["A", "A (2)"]);

// newestReviews: newest first, nulls last, limited
const revs = [
  { author: "a", publishedAt: "2026-09-01T00:00:00.000Z" },
  { author: "b", publishedAt: null },
  { author: "c", publishedAt: "2026-09-20T00:00:00.000Z" },
];
assert.deepEqual(newestReviews(revs, 2).map((r) => r.author), ["c", "a"]);
console.log("competitors.test.ts: ok");
