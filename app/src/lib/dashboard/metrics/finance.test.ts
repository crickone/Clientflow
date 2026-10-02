// Run: npm test -- src/lib/dashboard/metrics/finance.test.ts
import assert from "node:assert/strict";
import {
  churnPct,
  gainedLostByBucket,
  isRevenueMethod,
  methodTotals,
  parseTherapyIds,
  revenueByBucket,
  revenueSummary,
  splitAcrossTherapies,
  topSpenders,
  windowEndIso,
  wasActiveAt,
  type PaymentRow,
} from "./finance";
import { seriesBuckets } from "./stats";

const DAY = 86_400_000;
const p = (clientId: number, amount: number, method: string, atMs = 0): PaymentRow => ({ clientId, amount, method, atMs });

assert.ok(isRevenueMethod("cash") && isRevenueMethod("card") && isRevenueMethod("bank_transfer"));
assert.ok(!isRevenueMethod("voucher") && !isRevenueMethod("package"));

const rows = [p(1, 50, "cash"), p(1, 30, "card"), p(2, 20.5, "bank_transfer"), p(3, 99, "voucher"), p(3, 40, "package")];
assert.deepEqual(revenueSummary(rows), { total: 100.5, count: 3, clients: 2 }, "voucher and package are not revenue");
assert.deepEqual(revenueSummary([]), { total: 0, count: 0, clients: 0 });

assert.deepEqual(topSpenders(rows, 8), [{ clientId: 1, total: 80 }, { clientId: 2, total: 20.5 }]);
assert.equal(topSpenders(rows, 1).length, 1);

assert.deepEqual(methodTotals(rows), [
  { label: "Voucher redeemed", value: 99 },
  { label: "Cash", value: 50 },
  { label: "Package credit", value: 40 },
  { label: "Card", value: 30 },
  { label: "Bank transfer", value: 20.5 },
]);

const buckets = seriesBuckets(0, 3 * DAY);
assert.deepEqual(
  revenueByBucket([p(1, 10, "cash", 1), p(1, 5, "card", DAY + 1), p(1, 99, "voucher", DAY + 2), p(1, 7, "cash", 10 * DAY)], buckets),
  [10, 5, 0],
);

assert.deepEqual(parseTherapyIds("[1,2]"), [1, 2]);
assert.deepEqual(parseTherapyIds("nope"), []);
assert.deepEqual(parseTherapyIds(null), []);
assert.deepEqual(parseTherapyIds('{"a":1}'), []);

assert.deepEqual(splitAcrossTherapies(90, [1, 2, 3]), [{ id: 1, amount: 30 }, { id: 2, amount: 30 }, { id: 3, amount: 30 }]);
const odd = splitAcrossTherapies(100, [1, 2, 3]);
assert.equal(Math.round(odd.reduce((s, x) => s + x.amount, 0) * 100), 10000, "parts sum to the total");
assert.deepEqual(odd.map((x) => x.amount), [33.34, 33.33, 33.33]);
assert.deepEqual(splitAcrossTherapies(60, []), [{ id: null, amount: 60 }]);

assert.equal(churnPct(2, 8), 25);
assert.equal(churnPct(0, 0), null, "no members at the start means no rate");

assert.ok(wasActiveAt({ createdAtMs: 5, endedAtMs: null }, 10));
assert.ok(wasActiveAt({ createdAtMs: 5, endedAtMs: 10 }, 10), "ended exactly at the start still counts");
assert.ok(!wasActiveAt({ createdAtMs: 5, endedAtMs: 9 }, 10));
assert.ok(!wasActiveAt({ createdAtMs: 10, endedAtMs: null }, 10), "created at the start is not yet a member");

const gl = gainedLostByBucket([1, DAY + 1, DAY + 2], [2 * DAY + 5], buckets);
assert.deepEqual(gl.map((r) => [r.Gained, r.Lost]), [[1, 0], [2, 0], [0, 1]]);

assert.equal(windowEndIso("2026-10-02", 14), "2026-10-15", "next 14 days inclusive of today is today + 13");
assert.equal(windowEndIso("2026-10-02", 1), "2026-10-02");

console.log("finance.test.ts: ok");
