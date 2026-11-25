// Run: npm test -- src/lib/booking/voucherModel.test.ts
import assert from "node:assert/strict";

import { voucherCoverage, voucherInfoFrom, type VoucherInfo } from "./voucherModel";

// ------------------------------------------------------------ lookup mapping
assert.deepEqual(voucherInfoFrom({ ok: false }), { state: "invalid" });
assert.deepEqual(voucherInfoFrom({ ok: true, cancelled: true, empty: true }), { state: "cancelled" }, "cancelled wins over used");
assert.deepEqual(voucherInfoFrom({ ok: true, empty: true }), { state: "empty" });
assert.deepEqual(voucherInfoFrom({ ok: true, kind: "amount", balanceEur: 30, expiryDate: "2027-01-01" }), {
  state: "valid",
  kind: "amount",
  balance: 30,
  therapyId: null,
  therapyName: null,
  recipientName: null,
  expiryDate: "2027-01-01",
  expired: false,
});
const treatmentInfo = voucherInfoFrom({ ok: true, kind: "treatment", therapyId: 17, therapyName: "Deep tissue massage", expired: true });
assert.equal(treatmentInfo.state === "valid" && treatmentInfo.kind, "treatment");
assert.equal(treatmentInfo.state === "valid" && treatmentInfo.expired, true, "an expired voucher is still valid (a warning)");

// ------------------------------------------------------------ coverage
const money = (balance: number): VoucherInfo => ({
  state: "valid",
  kind: "amount",
  balance,
  therapyId: null,
  therapyName: null,
  recipientName: null,
  expiryDate: "",
  expired: false,
});
const forTreatment = (therapyId: number): VoucherInfo => ({ ...money(0), kind: "treatment", therapyId } as VoucherInfo);

assert.deepEqual(voucherCoverage(money(100), 17, 80, 80), { covers: 80, wrongTreatment: false, noPrice: false, needsSplit: false }, "a big money voucher pays it all");
assert.deepEqual(voucherCoverage(money(30), 17, 80, 80), { covers: 30, wrongTreatment: false, noPrice: false, needsSplit: true }, "a small one pays part: split");
assert.deepEqual(voucherCoverage(forTreatment(17), 17, 80, 80), { covers: 80, wrongTreatment: false, noPrice: false, needsSplit: false });
assert.deepEqual(
  voucherCoverage(forTreatment(17), 17, 100, 80),
  { covers: 80, wrongTreatment: false, noPrice: false, needsSplit: true },
  "a treatment voucher pays up to the listed price; a dearer session is split",
);
assert.deepEqual(voucherCoverage(forTreatment(18), 17, 80, 80), { covers: 0, wrongTreatment: true, noPrice: false, needsSplit: false }, "another treatment's voucher pays nothing");
assert.deepEqual(voucherCoverage(forTreatment(17), 17, 80, 0), { covers: 0, wrongTreatment: false, noPrice: true, needsSplit: false }, "no listed price: refused, not split");
assert.deepEqual(voucherCoverage(money(30), 17, 0, 0), { covers: 0, wrongTreatment: false, noPrice: false, needsSplit: false }, "a free session needs no split");
assert.deepEqual(voucherCoverage({ state: "invalid" }, 17, 80, 80), { covers: 0, wrongTreatment: false, noPrice: false, needsSplit: false });
assert.deepEqual(voucherCoverage({ state: "idle" }, 17, 80, 80).needsSplit, false);

console.log("booking voucherModel: all checks passed.");
