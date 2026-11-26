// Run: npm test -- src/lib/vouchers/listModel.test.ts
import assert from "node:assert/strict";
import { daysLeft, expiringSoon, filterVouchers, stateCounts, voucherFigures, voucherState, type VoucherLike } from "./listModel";

let n = 0;
const ok = (c: boolean, m: string) => {
  assert.ok(c, m);
  n++;
};

const TODAY = "2026-11-26";
const NOV = Date.parse("2026-11-10T12:00:00Z");
const OCT = Date.parse("2026-10-10T12:00:00Z");
const v = (over: Partial<VoucherLike>): VoucherLike => ({
  code: "OH-2026-AAAA",
  valueEur: 100,
  balanceEur: 100,
  expiryDate: "2027-11-26",
  cancelledAt: null,
  createdAt: NOV,
  source: "staff",
  purchaserName: "Buyer Example",
  purchaserEmail: null,
  recipientName: "Recipient Example",
  ...over,
});

const unused = v({ code: "A" });
const part = v({ code: "B", balanceEur: 50, source: "online", buyerName: "Online Buyer" });
const used = v({ code: "C", balanceEur: 0 });
const expired = v({ code: "D", expiryDate: "2026-11-01", createdAt: OCT });
const cancelled = v({ code: "E", cancelledAt: 1 });
const soon = v({ code: "F", expiryDate: "2026-12-10", createdAt: OCT, recipientName: "Soon Example" });
const all = [unused, part, used, expired, cancelled, soon];

ok(voucherState(unused, TODAY) === "unused" && voucherState(part, TODAY) === "part" && voucherState(used, TODAY) === "used", "unused, part used, used");
ok(voucherState(expired, TODAY) === "expired" && voucherState(cancelled, TODAY) === "cancelled", "expired, cancelled");
ok(voucherState(v({ balanceEur: 0, expiryDate: "2026-01-01" }), TODAY) === "used", "used up wins over expired");
ok(daysLeft(soon, TODAY) === 14 && expiringSoon(soon, TODAY) && !expiringSoon(unused, TODAY), "14 days left is expiring soon; a year is not");
ok(daysLeft(used, TODAY) === null && !expiringSoon(expired, TODAY), "used and expired ones are not counted as expiring");

const f = voucherFigures(all, { today: TODAY, month: "2026-11", monthOf: (ms) => new Date(ms).toISOString().slice(0, 7), usedThisMonthEur: 50 });
ok(f.owedEur === 250 && f.owedCount === 3, "still to be used: unused 100 + part 50 + expiring 100");
ok(f.soldCount === 3 && f.soldEur === 300, "sold this month: three made in November, the cancelled one left out");
ok(f.usedEur === 50 && f.expiringCount === 1, "used this month as given; one expiring");

ok(filterVouchers(all, { today: TODAY, state: "part" }).map((x) => x.code).join() === "B", "Part used");
ok(filterVouchers(all, { today: TODAY, source: "online" }).map((x) => x.code).join() === "B", "Online");
ok(filterVouchers(all, { today: TODAY, expiring: true }).map((x) => x.code).join() === "F", "Expiring in 30 days");
ok(filterVouchers(all, { today: TODAY, q: "online buyer" }).map((x) => x.code).join() === "B", "search finds the online buyer");
ok(filterVouchers(all, { today: TODAY, q: "soon" }).map((x) => x.code).join() === "F", "search by recipient");
const c = stateCounts(all, TODAY);
ok(c.all === 6 && c.unused === 2 && c.part === 1 && c.used === 1 && c.expired === 1 && c.cancelled === 1, "counts per status");

console.log(`voucher list: ${n} checks passed.`);
