// Run: npm test -- src/lib/dashboard/metrics/breakdown.test.ts
import assert from "node:assert/strict";

import { packageUsedPct, packageValueLeft, parseMoneyView, revenueLines, spendByClient, sumAmounts, type PaymentLine } from "./breakdown";

const line = (id: number, clientId: number, clientName: string, method: string, amount: number): PaymentLine => ({
  id, atMs: id, clientId, clientName, method, amount, forWhat: "",
});

assert.equal(parseMoneyView("deferred"), "deferred");
assert.equal(parseMoneyView("nope"), null);
assert.equal(parseMoneyView(undefined), null);

const lines = [
  line(1, 1, "Ann", "card", 100),
  line(2, 1, "Ann", "cash", 50.1),
  line(3, 2, "Bob", "bank_transfer", 30),
  line(4, 2, "Bob", "voucher", 80),
  line(5, 3, "Cat", "package", 40),
];
assert.deepEqual(revenueLines(lines).map((l) => l.id), [1, 2, 3], "redemptions are not money received");
assert.equal(sumAmounts(lines), 300.1);
assert.deepEqual(
  spendByClient(lines),
  [
    { clientId: 1, clientName: "Ann", payments: 2, total: 150.1 },
    { clientId: 2, clientName: "Bob", payments: 1, total: 30 },
  ],
  "per client, money received only, largest first; a client with only redemptions is left out",
);

assert.equal(packageValueLeft({ totalSessions: 5, sessionsUsed: 2, pricePaid: 300 }), 180);
assert.equal(packageValueLeft({ totalSessions: 3, sessionsUsed: 1, pricePaid: 100 }), 66.67);
assert.equal(packageValueLeft({ totalSessions: 5, sessionsUsed: 7, pricePaid: 300 }), 0, "overused is never negative");
assert.equal(packageValueLeft({ totalSessions: 0, sessionsUsed: 0, pricePaid: 300 }), 0);
assert.equal(packageUsedPct({ totalSessions: 4, sessionsUsed: 1 }), 25);
assert.equal(packageUsedPct({ totalSessions: 4, sessionsUsed: 9 }), 100);

console.log("breakdown.test.ts: ok");
