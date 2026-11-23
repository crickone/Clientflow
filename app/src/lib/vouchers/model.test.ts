// Run: npm test -- src/lib/vouchers/model.test.ts
import assert from "node:assert/strict";

import {
  DEFAULT_STORE_SETTINGS,
  addMonths,
  balanceFrom,
  balanceLabel,
  checkAmount,
  codePrefix,
  colourways,
  contrast,
  deliveryStatus,
  deliveryTime,
  dublinDate,
  dublinTimeToUtc,
  expiryDate,
  findColourway,
  formatCode,
  formatEuro,
  formatLongDate,
  isDeliveryDue,
  latestDeliveryDate,
  normaliseCode,
  parseAmountList,
  parseColourway,
  parseOrderDraft,
  parseStoreSettings,
  splitPayment,
  validateOrder,
  validateStoreSettings,
  voucherState,
  voucherTitle,
  type OrderDraft,
  type VoucherStoreSettings,
} from "./model";

// ── settings: the 5-year floor and the amount bounds ──────────────────────
const base: VoucherStoreSettings = { ...DEFAULT_STORE_SETTINGS, enabled: true, amounts: [50, 25, 100, 50], therapyIds: [3] };
const saved = validateStoreSettings(base);
assert.ok(saved.ok);
assert.deepEqual(saved.ok && saved.value.amounts, [25, 50, 100], "sorted, no repeats");
for (const years of [0, 1, 4]) {
  const r = validateStoreSettings({ ...base, expiryYears: years });
  assert.ok(!r.ok && /at least 5 years/.test(r.error), `${years} years is refused`);
}
assert.ok(validateStoreSettings({ ...base, expiryYears: 5 }).ok, "5 years is the floor");
assert.ok(!validateStoreSettings({ ...base, expiryYears: 4.5 }).ok, "whole years only");
assert.equal(parseStoreSettings({ expiryYears: 2 }).expiryYears, 5, "a stored value under the floor reads back as 5");
assert.equal(parseStoreSettings({ expiryYears: 7 }).expiryYears, 7);
assert.equal(parseStoreSettings(null).enabled, false, "unset means off");
assert.deepEqual(parseStoreSettings({ amounts: [10, "x", 3, 10, 5000] }).amounts, [10], "junk amounts are dropped");
assert.ok(!validateStoreSettings({ ...base, amounts: [25.5] }).ok, "whole euros");
assert.ok(!validateStoreSettings({ ...base, amounts: [1] }).ok, "not under EUR 5");
assert.ok(!validateStoreSettings({ ...base, customMin: 100, customMax: 50 }).ok, "max under min");
assert.ok(!validateStoreSettings({ ...base, intro: "x".repeat(201) }).ok, "intro is capped");
assert.ok(!validateStoreSettings({ ...base, bookUrl: "javascript:alert(1)" }).ok, "booking link must be http(s)");
assert.ok(!validateStoreSettings({ ...base, amounts: [], allowCustom: false, therapyIds: [] }).ok, "nothing for sale cannot be switched on");
assert.ok(validateStoreSettings({ ...base, enabled: false, amounts: [], allowCustom: false, therapyIds: [] }).ok, "but can be saved switched off");
for (const bad of [
  { amounts: "x" as unknown as number[] },
  { therapyIds: "y" as unknown as number[] },
  { intro: 5 as unknown as string },
  { bookUrl: 7 as unknown as string },
  { amounts: null as unknown as number[], intro: undefined as unknown as string },
]) {
  assert.doesNotThrow(() => validateStoreSettings({ ...base, ...bad }), "malformed settings never throw");
  assert.equal(validateStoreSettings({ ...base, ...bad }).ok, false, "malformed settings are an error result");
}
assert.deepEqual(parseAmountList("25, 50 €100"), [25, 50, 100]);
assert.equal(parseAmountList("25, fifty"), null);

const s = parseStoreSettings({ amounts: [25, 50], allowCustom: true, customMin: 30, customMax: 300 });
assert.equal(checkAmount(s, 25), null, "a preset is fine even under the custom minimum");
assert.equal(checkAmount(s, 30), null);
assert.equal(checkAmount(s, 300), null);
assert.match(checkAmount(s, 29) ?? "", /lowest amount is €30/);
assert.match(checkAmount(s, 301) ?? "", /highest amount is €300/);
assert.match(checkAmount(s, 40.5) ?? "", /whole euros/);
assert.match(checkAmount({ ...s, allowCustom: false }, 40) ?? "", /one of the amounts/);
assert.match(checkAmount(s, null) ?? "", /Choose an amount/);

// ── dates ─────────────────────────────────────────────────────────────────
assert.equal(expiryDate("2026-11-23", 5), "2031-11-23");
assert.equal(expiryDate("2026-11-23", 2), "2031-11-23", "never under 5 years");
assert.equal(expiryDate("2028-02-29", 5), "2033-03-01", "29 February rolls forward to 1 March, never short of 5 years");
assert.equal(expiryDate("2028-02-29", 8), "2036-02-29", "a leap year keeps the 29th");
assert.equal(expiryDate("2026-11-23", Number.NaN), "2031-11-23", "NaN years counts as 5");
assert.equal(expiryDate("2026-11-23", Infinity), "2031-11-23", "non-finite years counts as 5");
assert.equal(expiryDate("2026-11-23", 1e9), "2046-11-23", "huge years clamp to the 20-year maximum");
assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
assert.equal(latestDeliveryDate("2026-11-23"), "2027-11-23");
assert.equal(formatLongDate("2031-11-23"), "23 November 2031");
assert.equal(dublinDate(Date.UTC(2026, 6, 1, 23, 30)), "2026-07-02", "half eleven UTC in July is past midnight in Ireland");

// 09:00 Irish time, either side of the clock changes.
assert.equal(dublinTimeToUtc("2027-01-15", 9), Date.UTC(2027, 0, 15, 9), "winter: 09:00 is 09:00 UTC");
assert.equal(dublinTimeToUtc("2027-07-15", 9), Date.UTC(2027, 6, 15, 8), "summer: 09:00 is 08:00 UTC");
assert.equal(dublinTimeToUtc("2027-03-28", 9), Date.UTC(2027, 2, 28, 8), "the morning the clocks go forward");
assert.equal(dublinTimeToUtc("2027-03-27", 9), Date.UTC(2027, 2, 27, 9), "the day before");
assert.equal(dublinTimeToUtc("2027-10-31", 9), Date.UTC(2027, 9, 31, 9), "the morning the clocks go back");
assert.equal(dublinTimeToUtc("2027-10-30", 9), Date.UTC(2027, 9, 30, 8), "the day before");
assert.equal(deliveryTime(null, 1234), 1234, "no date: at once");
assert.equal(deliveryTime("2027-07-15", 1234), Date.UTC(2027, 6, 15, 8));
assert.equal(isDeliveryDue("2027-07-15", Date.UTC(2027, 6, 15, 7, 59)), false);
assert.equal(isDeliveryDue("2027-07-15", Date.UTC(2027, 6, 15, 8)), true);
assert.equal(isDeliveryDue(null, 0), true);

// ── money: balance and the split at the desk ──────────────────────────────
assert.equal(formatEuro(50), "€50");
assert.equal(formatEuro(12.5), "€12.50");
assert.equal(balanceFrom(50, [20, 10.1]), 19.9);
assert.equal(balanceFrom(50, [60]), 0, "never below nothing");
assert.deepEqual(splitPayment({ kind: "amount", balanceEur: 50 }, 80), { voucherEur: 50, remainderEur: 30, redemptionEur: 50 }, "money voucher short of the price");
assert.deepEqual(splitPayment({ kind: "amount", balanceEur: 50 }, 30), { voucherEur: 30, remainderEur: 0, redemptionEur: 30 }, "money voucher keeps its change");
assert.deepEqual(splitPayment({ kind: "amount", balanceEur: 0.1 + 0.2 }, 0.3), { voucherEur: 0.3, remainderEur: 0, redemptionEur: 0.3 }, "cents, not floats");
assert.deepEqual(splitPayment({ kind: "treatment", balanceEur: 70 }, 80, 80), { voucherEur: 80, remainderEur: 0, redemptionEur: 70 }, "treatment at today's price, voucher used up");
assert.deepEqual(splitPayment({ kind: "treatment", balanceEur: 70 }, 110, 80), { voucherEur: 80, remainderEur: 30, redemptionEur: 70 }, "an extra on the same booking is paid separately");

const zero = { voucherEur: 0, remainderEur: 0, redemptionEur: 0 };
assert.deepEqual(splitPayment({ kind: "treatment", balanceEur: 0 }, 80, 80), { ...zero, remainderEur: 80 }, "a used-up treatment voucher covers nothing");
assert.deepEqual(splitPayment({ kind: "treatment", balanceEur: -5 }, 80, 80), { ...zero, remainderEur: 80 }, "a negative balance covers nothing");
assert.deepEqual(splitPayment({ kind: "treatment", balanceEur: 70 }, 80), { voucherEur: 0, remainderEur: 80, redemptionEur: 70 }, "no treatment price: covers 0, never the booking price");
assert.deepEqual(splitPayment({ kind: "treatment", balanceEur: 70 }, 50, 80), { voucherEur: 50, remainderEur: 0, redemptionEur: 70 }, "never covers more than the booking price");
assert.deepEqual(splitPayment({ kind: "amount", balanceEur: 0 }, 80), { ...zero, remainderEur: 80 }, "an empty money voucher covers nothing");
for (const [bal, price] of [[20, 80], [80, 20], [50, 50], [0, 10], [Number.NaN, 30], [30, Number.NaN], [Infinity, 30]] as const) {
  const r = splitPayment({ kind: "amount", balanceEur: bal }, price);
  const cap = Math.min(Number.isFinite(bal) ? Math.max(0, bal) : 0, Number.isFinite(price) ? Math.max(0, price) : 0);
  assert.ok(r.voucherEur >= 0 && r.remainderEur >= 0 && r.redemptionEur >= 0, `no negatives: ${bal}, ${price}`);
  assert.ok(Number.isFinite(r.voucherEur) && Number.isFinite(r.remainderEur) && Number.isFinite(r.redemptionEur), `no NaN: ${bal}, ${price}`);
  assert.ok(r.voucherEur <= cap + 1e-9, `money voucher never exceeds balance or price: ${bal}, ${price}`);
}
assert.deepEqual(splitPayment({ kind: "treatment", balanceEur: Number.NaN }, Number.NaN, Number.NaN), zero, "NaN everywhere is zero");

const today = "2026-11-23";
assert.equal(voucherState({ valueEur: 50, balanceEur: 50, expiryDate: "2031-11-23", cancelledAt: null }, today), "active");
assert.equal(voucherState({ valueEur: 50, balanceEur: 20, expiryDate: "2031-11-23", cancelledAt: null }, today), "part_used");
assert.equal(voucherState({ valueEur: 50, balanceEur: 0, expiryDate: "2031-11-23", cancelledAt: null }, today), "used");
assert.equal(voucherState({ valueEur: 50, balanceEur: 50, expiryDate: "2026-11-22", cancelledAt: null }, today), "expired");
assert.equal(voucherState({ valueEur: 50, balanceEur: 50, expiryDate: "2031-11-23", cancelledAt: 1 }, today), "cancelled");
assert.equal(voucherTitle({ kind: "amount", valueEur: 50, therapyName: null }), "€50");
assert.equal(voucherTitle({ kind: "treatment", valueEur: 80, therapyName: "Swedish massage" }), "Swedish massage");
assert.equal(balanceLabel({ kind: "amount", valueEur: 50, balanceEur: 20 }), "€20 left");
assert.equal(balanceLabel({ kind: "treatment", valueEur: 80, balanceEur: 80 }), "Not used yet");
assert.equal(balanceLabel({ kind: "treatment", valueEur: 80, balanceEur: 0 }), "Used");

// ── codes ─────────────────────────────────────────────────────────────────
assert.equal(codePrefix("Optimal Health & Recovery at Inspire"), "OH");
assert.equal(codePrefix("Inspire Health and Fitness"), "IH");
assert.equal(codePrefix("Renova"), "RG");
assert.equal(codePrefix(""), "GV");
assert.equal(formatCode("OH", 2026, [3, 17, 0, 31]), "OH-2026-DTA9");
assert.equal(normaliseCode("  oh-2026-dta9 "), "OH-2026-DTA9");

// ── colourways: pure, deterministic, readable ────────────────────────────
const oh = ["#2f4a3a", "#f4efe6", "#c9a24c", "#1b1b1b"];
const a = colourways(oh);
assert.deepEqual(colourways(oh), a, "same palette, same cards");
assert.deepEqual(a.map((c) => c.id), ["signature", "night", "pale", "duo"], "a second colour far round the wheel adds a two-tone card");
assert.equal(colourways(["#2f4a3a"]).length, 3, "one colour: three cards");
assert.equal(colourways([]).length, 3, "no palette still gives cards");
assert.notDeepEqual(colourways(["#c0392b"])[0], colourways(["#2980b9"])[0], "every business gets its own");
for (const palette of [oh, ["#ff6a32"], ["#ffffff"], ["#000000"], ["#ffeb3b", "#00bcd4"], []]) {
  for (const c of colourways(palette)) {
    assert.ok(contrast(c.ink, c.base) >= 4.5, `${palette.join(",")} ${c.id}: text on base ${contrast(c.ink, c.base).toFixed(2)}`);
    assert.ok(contrast(c.ink, c.base2) >= 4.5, `${palette.join(",")} ${c.id}: text on base2 ${contrast(c.ink, c.base2).toFixed(2)}`);
  }
}
assert.equal(findColourway(a, "night")?.name, "Night");
assert.equal(findColourway(a, "nope"), null);
assert.deepEqual(parseColourway(JSON.stringify(a[0])), a[0]);
assert.equal(parseColourway("{\"id\":\"x\"}"), null);
assert.equal(parseColourway("not json"), null);

// ── the buyer's order ─────────────────────────────────────────────────────
const ctx = {
  settings: parseStoreSettings({ enabled: true, amounts: [25, 50], allowCustom: true, customMin: 25, customMax: 500, therapyIds: [3] }),
  treatments: [{ id: 3, name: "Swedish massage", priceEur: 80 }, { id: 4, name: "Facial", priceEur: 60 }],
  colourwayIds: a.map((c) => c.id),
  today,
};
const draft: OrderDraft = {
  kind: "amount",
  amountEur: 50,
  therapyId: null,
  toName: "  Aoife ",
  fromName: "Sean",
  message: "Happy birthday",
  colourwayId: "signature",
  deliverTo: "recipient",
  recipientEmail: "Aoife@Example.ie",
  deliverOn: "2026-12-24",
  buyerName: "Sean Walsh",
  buyerEmail: "sean@example.ie",
};
const ok = validateOrder(draft, ctx);
assert.ok(ok.ok);
if (ok.ok) {
  assert.equal(ok.order.valueCents, 5000);
  assert.equal(ok.order.toName, "Aoife");
  assert.equal(ok.order.recipientEmail, "aoife@example.ie");
  assert.equal(ok.order.deliverOn, "2026-12-24");
}
const t = validateOrder({ ...draft, kind: "treatment", amountEur: null, therapyId: 3 }, ctx);
assert.ok(t.ok && t.order.valueCents === 8000 && t.order.therapyName === "Swedish massage", "treatment at its list price");
const fail = (d: Partial<OrderDraft>) => {
  const r = validateOrder({ ...draft, ...d }, ctx);
  return r.ok ? null : r.field;
};
assert.equal(fail({ kind: "treatment", therapyId: 4 }), "therapyId", "a treatment not ticked for sale");
assert.equal(fail({ amountEur: 501 }), "amountEur");
assert.equal(fail({ toName: "   " }), "toName");
assert.equal(fail({ fromName: "" }), "fromName");
assert.equal(fail({ message: "x".repeat(201) }), "message");
assert.equal(fail({ colourwayId: "gold" }), "colourwayId");
assert.equal(fail({ recipientEmail: "aoife" }), "recipientEmail");
assert.equal(fail({ deliverOn: "2026-11-22" }), "deliverOn", "not in the past");
assert.equal(fail({ deliverOn: "2027-11-24" }), "deliverOn", "not over 12 months ahead");
assert.equal(fail({ deliverOn: "2027-11-23" }), null, "12 months ahead exactly is fine");
assert.equal(fail({ deliverOn: "2026-02-30" }), "deliverOn", "a real date");
assert.equal(fail({ buyerEmail: "x@y" }), "buyerEmail");
assert.equal(fail({ recipientEmail: "a@x.ie,b@y.ie" }), "recipientEmail", "one address only: comma");
assert.equal(fail({ recipientEmail: "a@x.ie;b@y.ie" }), "recipientEmail", "one address only: semicolon");
assert.equal(fail({ recipientEmail: "<a@x.ie>" }), "recipientEmail", "no angle brackets");
assert.equal(fail({ buyerEmail: "\"a\"@x.ie" }), "buyerEmail", "no quotes");
assert.equal(fail({ buyerEmail: "a b@x.ie" }), "buyerEmail", "no spaces");
const nanCtx = { ...ctx, treatments: [{ id: 3, name: "Swedish massage", priceEur: Number.NaN }], settings: { ...ctx.settings, therapyIds: [3] } };
const nanOrder = validateOrder({ ...draft, kind: "treatment", amountEur: null, therapyId: 3 }, nanCtx);
assert.ok(!nanOrder.ok && nanOrder.field === "therapyId", "a NaN treatment price cannot be bought");
assert.equal(fail({ buyerName: "" }), "buyerName");
const toMe = validateOrder({ ...draft, deliverTo: "buyer", recipientEmail: "", deliverOn: "2026-12-24" }, ctx);
assert.ok(toMe.ok && toMe.order.recipientEmail === null && toMe.order.deliverOn === null, "sent to me: no recipient email, no date");

const parsed = parseOrderDraft({ kind: "treatment", amountEur: "50", therapyId: 3, toName: 7, deliverTo: "elsewhere", deliverOn: "" });
assert.equal(parsed.kind, "treatment");
assert.equal(parsed.amountEur, 50, "numbers from strings");
assert.equal(parsed.toName, "", "a non-string name is empty");
assert.equal(parsed.deliverTo, "buyer", "anything else means send it to me");
assert.equal(parsed.deliverOn, null, "no date means now");
assert.deepEqual(parseOrderDraft(null).kind, "amount");

// ── delivery status for staff ─────────────────────────────────────────────
const ds = (o: Partial<Parameters<typeof deliveryStatus>[0]>) =>
  deliveryStatus({ deliverTo: "recipient", deliverOn: null, deliveredAt: null, deliveryError: null, status: "paid", ...o });
assert.deepEqual(ds({ deliveredAt: 1 }), { label: "Emailed to the recipient", tone: "green" });
assert.deepEqual(ds({ deliverTo: "buyer", deliveredAt: 1 }), { label: "Sent to the buyer", tone: "green" });
assert.deepEqual(ds({ deliverOn: "2026-12-24" }), { label: "Sends 24 December 2026 at 9am", tone: "amber" });
assert.deepEqual(ds({ deliveryError: "bounced" }), { label: "Email failed: bounced", tone: "red" });
assert.equal(ds({ status: "refunded", deliveredAt: 1 }).label, "Refunded in Stripe");
assert.equal(ds({}).label, "Not sent yet");

console.log("vouchers model: all assertions passed");
