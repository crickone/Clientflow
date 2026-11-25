// Run: npm test -- src/lib/booking/summaryModel.test.ts
import assert from "node:assert/strict";

import { bookLabel, methodLabel, summaryMoney, whenLabel, type SummaryInput } from "./summaryModel";

const base: SummaryInput = {
  listPrice: 80,
  price: 80,
  paymentMethod: "cash",
  packageMode: "existing",
  pkg: null,
  newPackage: null,
  voucher: null,
  secondaryMethod: "card",
};

// ------------------------------------------------------------ package value
const fromPackage = summaryMoney({
  ...base,
  paymentMethod: "package",
  pkg: { packageName: "Black Friday", pricePaidEur: 64, totalSessions: 1 },
});
assert.equal(fromPackage.value, 64, "a session from a EUR 64 package is worth EUR 64, not the EUR 80 list price");
assert.equal(fromPackage.struck, 80, "the list price is struck through beside it");
assert.equal(fromPackage.paymentLabel, "Black Friday");
assert.equal(fromPackage.shortPayment, "Prepaid");
assert.equal(fromPackage.note, "Already paid. Uses 1 prepaid session from Black Friday.");
assert.equal(fromPackage.tone, "paid");

const bundle = summaryMoney({
  ...base,
  paymentMethod: "package",
  pkg: { packageName: "Five pack", pricePaidEur: 400, totalSessions: 5 },
});
assert.equal(bundle.value, 80);
assert.equal(bundle.struck, null, "nothing to strike when the package value equals the list price");

// Paying by package with no package picked is not a prepaid session.
const noPkg = summaryMoney({ ...base, paymentMethod: "package" });
assert.equal(noPkg.value, 80);
assert.equal(noPkg.tone, "due");
assert.equal(noPkg.paymentLabel, "Prepaid package");
assert.equal(summaryMoney({ ...base, paymentMethod: "package", planWord: "membership" }).paymentLabel, "Prepaid membership", "the venue's word");

// ------------------------------------------------------------ new package
const signUp = summaryMoney({ ...base, paymentMethod: "package", packageMode: "new", newPackage: { name: "Ten pack", priceEur: 600 } });
assert.equal(signUp.value, 600, "the package sale is what is taken");
assert.equal(signUp.paymentLabel, "New: Ten pack");
assert.equal(summaryMoney({ ...base, paymentMethod: "package", packageMode: "new", newPackage: { name: " ", priceEur: 0 } }).paymentLabel, "New: New package");

// ------------------------------------------------------------ voucher
const full = summaryMoney({ ...base, paymentMethod: "voucher", voucher: { valid: true, covers: 80, wrongTreatment: false, noPrice: false, needsSplit: false } });
assert.deepEqual([full.paymentLabel, full.note, full.tone], ["Gift voucher", "Paid by gift voucher.", "paid"]);
const split = summaryMoney({
  ...base,
  paymentMethod: "voucher",
  secondaryMethod: "bank_transfer",
  voucher: { valid: true, covers: 30, wrongTreatment: false, noPrice: false, needsSplit: true },
});
assert.equal(split.paymentLabel, "Gift voucher and bank transfer");
assert.equal(split.note, "Voucher pays €30. €50 to pay by bank transfer.");
assert.equal(split.value, 80);
const wrong = summaryMoney({ ...base, paymentMethod: "voucher", voucher: { valid: true, covers: 0, wrongTreatment: true, noPrice: false, needsSplit: false } });
assert.deepEqual([wrong.paymentLabel, wrong.note, wrong.tone], ["Gift voucher", "To pay on the day.", "due"]);
const noCode = summaryMoney({ ...base, paymentMethod: "voucher" });
assert.equal(noCode.note, "To pay on the day.");

// ------------------------------------------------------------ plain methods
const card = summaryMoney({ ...base, paymentMethod: "card", price: 70 });
assert.deepEqual([card.value, card.struck, card.paymentLabel, card.shortPayment, card.note, card.tone], [70, null, "Card", "Card", "To pay on the day.", "due"]);
assert.equal(summaryMoney({ ...base, paymentMethod: "bank_transfer" }).paymentLabel, "Bank transfer");
assert.equal(methodLabel("cash"), "Cash");

// ------------------------------------------------------------ when + button
assert.equal(whenLabel("2026-11-26", "12:45", 60), "Thu 26 Nov, 12:45 to 13:45");
assert.equal(whenLabel("2026-11-26", "", 60), "Thu 26 Nov", "no time yet");
assert.equal(whenLabel("2026-11-26", "12:45", 0), "Thu 26 Nov, 12:45", "no length yet");
assert.equal(whenLabel("", "12:45", 60), "");

assert.equal(bookLabel("Mary", "Book appointment"), "Book Mary in");
assert.equal(bookLabel("  ", "Book appointment"), "Book appointment");

console.log("booking summaryModel: all checks passed.");
