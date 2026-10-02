// Run: npm test -- src/lib/dashboard/range.test.ts
//
// Dashboard date ranges: every window is whole UTC days, toMs is exclusive,
// toIso inclusive; the previous period is the same length immediately
// before; a bad custom range falls back to 30 days rather than throwing.
import assert from "node:assert/strict";
import { deltaPct, parseRangeKey, previousRange, resolveRange } from "./range";

const now = new Date("2026-10-02T15:00:00Z");

const today = resolveRange("today", now);
assert.equal(today.fromIso, "2026-10-02");
assert.equal(today.toIso, "2026-10-02");
assert.equal(today.days, 1);
assert.equal(today.toMs - today.fromMs, 86_400_000);

const week = resolveRange("7d", now);
assert.equal(week.fromIso, "2026-09-26");
assert.equal(week.toIso, "2026-10-02");
assert.equal(week.days, 7);

assert.equal(resolveRange("30d", now).fromIso, "2026-09-03");
assert.equal(resolveRange("90d", now).days, 90);

const month = resolveRange("month", now);
assert.equal(month.fromIso, "2026-10-01");
assert.equal(month.days, 2);

const prev = previousRange(week);
assert.equal(prev.fromIso, "2026-09-19");
assert.equal(prev.toIso, "2026-09-25");
assert.equal(prev.days, 7);
assert.equal(prev.toMs, week.fromMs);

const custom = resolveRange("custom", now, { from: "2026-09-01", to: "2026-09-10" });
assert.equal(custom.fromIso, "2026-09-01");
assert.equal(custom.toIso, "2026-09-10");
assert.equal(custom.days, 10);
assert.equal(custom.label, "1 Sep - 10 Sep");

const badCustom = resolveRange("custom", now, { from: "2026-09-10", to: "2026-09-01" });
assert.equal(badCustom.key, "30d", "reversed custom range falls back to 30d");
assert.equal(resolveRange("custom", now, { from: "nope" }).key, "30d");

assert.equal(parseRangeKey("7d"), "7d");
assert.equal(parseRangeKey("custom"), "custom");
assert.equal(parseRangeKey("bogus"), null);
assert.equal(parseRangeKey(undefined), null);

assert.equal(deltaPct(12, 10), 20);
assert.equal(deltaPct(5, 10), -50);
assert.equal(deltaPct(5, 0), null, "no baseline means no percentage");
assert.equal(deltaPct(0, 0), null);

console.log("range.test.ts: ok");
