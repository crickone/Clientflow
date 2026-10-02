// Run: npm test -- src/lib/dashboard/metrics/marketing.test.ts
import assert from "node:assert/strict";
import { blendedTotals, cacCents, mergeUpcoming, roasRatio, sourceLabel } from "./marketing";

assert.equal(cacCents(10000, 4), 2500);
assert.equal(cacCents(10001, 3), 3334, "rounded to whole cents");
assert.equal(cacCents(10000, 0), null);
assert.equal(cacCents(0, 3), 0);

assert.equal(roasRatio(30000, 10000), 3);
assert.equal(roasRatio(32000, 10000), 3.2);
assert.equal(roasRatio(1, 0), null);
assert.equal(roasRatio(0, 5000), 0);

assert.equal(sourceLabel("facebook", "l.facebook.com"), "facebook");
assert.equal(sourceLabel("", "google.com"), "google.com");
assert.equal(sourceLabel("", ""), "Direct");
assert.equal(sourceLabel("  ", "  "), "Direct");

const posts = [
  { name: "Post B", atMs: 2000 },
  { name: "Post A", atMs: 1000 },
];
const emails = [{ name: "Mail", atMs: 1500 }];
const merged = mergeUpcoming(posts, emails, 8);
assert.deepEqual(merged.map((m) => [m.name, m.kind]), [["Post A", "post"], ["Mail", "email"], ["Post B", "post"]]);
assert.equal(mergeUpcoming(posts, emails, 2).length, 2);

// Blended totals ignore campaigns with no recorded ad spend.
const withSpend = { adSpendCents: 10_000, converts: 2, upfrontCashCents: 20_000, mrrCents: 10_000 };
const noSpend = { adSpendCents: 0, converts: 5, upfrontCashCents: 50_000, mrrCents: 5_000 };
const bt = blendedTotals([withSpend, noSpend]);
assert.deepEqual(bt, { spendCents: 10_000, converts: 2, revenueCents: 30_000, campaigns: 1 }, "no-spend campaign does not dilute");
assert.equal(cacCents(bt.spendCents, bt.converts), 5000);
assert.equal(roasRatio(bt.revenueCents, bt.spendCents), 3);
// Single-campaign set: the KPI ROAS equals that campaign's row ROAS.
const one = blendedTotals([withSpend]);
assert.equal(roasRatio(one.revenueCents, one.spendCents), roasRatio(withSpend.upfrontCashCents + withSpend.mrrCents, withSpend.adSpendCents));
assert.deepEqual(blendedTotals([noSpend]), { spendCents: 0, converts: 0, revenueCents: 0, campaigns: 0 });

console.log("marketing.test.ts: ok");
