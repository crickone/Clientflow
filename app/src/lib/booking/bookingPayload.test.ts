// Run: npm test -- src/lib/booking/bookingPayload.test.ts
//
// The body POST /api/appointments takes, for every path the old BookingForm
// sent. Field names and presence are the contract: a missing packageMode
// books a package sign-up as a plain package payment, a missing
// secondaryPaymentMethod leaves a split voucher payment short.
import assert from "node:assert/strict";

import { EMPTY_NEW_PACKAGE, bookingEntries, bookingFormData, bookingProblem, readyToBook, type BookingDraft } from "./bookingPayload";

const VOCAB = { service: "Therapy", member: "Client" };

const draft = (over: Partial<BookingDraft> = {}): BookingDraft => ({
  clientMode: "existing",
  clientId: 5,
  walkIn: { firstName: "", lastName: "", email: "", phone: "" },
  therapyIds: [17],
  date: "2030-01-07",
  startTime: "12:45",
  durationMinutes: 60,
  priceEur: 80,
  paymentMethod: "cash",
  packageMode: "existing",
  packageId: null,
  newPackage: EMPTY_NEW_PACKAGE,
  voucherCode: "",
  secondaryPaymentMethod: null,
  notes: "",
  ...over,
});

const asObject = (d: BookingDraft) => Object.fromEntries(bookingEntries(d));

// ------------------------------------------------------------ existing client, cash
assert.deepEqual(bookingEntries(draft()), [
  ["therapyIds", "17"],
  ["clientId", "5"],
  ["date", "2030-01-07"],
  ["startTime", "12:45"],
  ["durationMinutes", "60"],
  ["totalPriceEur", "80"],
  ["paymentMethod", "cash"],
  ["notes", ""],
  ["status", "scheduled"],
]);

// ------------------------------------------------------------ walk-in
const walkIn = asObject(
  draft({ clientMode: "walk_in", clientId: 5, walkIn: { firstName: " Sam ", lastName: " Test ", email: " sam@example.com ", phone: " 0800 000 000 " } }),
);
assert.equal(walkIn.clientId, undefined, "a walk-in never sends a client id, even one left over from the other tab");
assert.deepEqual(
  [walkIn.walkInFirstName, walkIn.walkInLastName, walkIn.walkInEmail, walkIn.walkInPhone],
  ["Sam", "Test", "sam@example.com", "0800 000 000"],
  "walk-in fields are trimmed",
);

// ------------------------------------------------------------ several treatments
assert.deepEqual(
  bookingEntries(draft({ therapyIds: [1, 2] })).filter(([k]) => k === "therapyIds"),
  [
    ["therapyIds", "1"],
    ["therapyIds", "2"],
  ],
);

// ------------------------------------------------------------ existing package
const pkg = asObject(draft({ paymentMethod: "package", packageId: 7, priceEur: 64 }));
assert.deepEqual([pkg.paymentMethod, pkg.packageMode, pkg.packageId, pkg.totalPriceEur], ["package", "existing", "7", "64"]);

// ------------------------------------------------------------ new package from a template
const tpl = asObject(
  draft({ paymentMethod: "package", packageMode: "new", newPackage: { ...EMPTY_NEW_PACKAGE, templateId: 3, paymentMethod: "cash" } }),
);
assert.equal(tpl.totalPriceEur, "0", "the session is covered by the new package");
assert.deepEqual([tpl.packageMode, tpl.newPackageTemplateId, tpl.newPackagePaymentMethod], ["new", "3", "cash"]);
assert.equal(tpl.newPackageName, undefined, "a template sends no custom fields");
assert.equal(tpl.packageId, undefined);

// ------------------------------------------------------------ new custom package
const custom = asObject(
  draft({
    paymentMethod: "package",
    packageMode: "new",
    newPackage: { templateId: null, name: " Ten pack ", sessions: 10, priceEur: 600, expiry: "2031-01-01", paymentMethod: "bank_transfer" },
  }),
);
assert.deepEqual(
  [custom.newPackageName, custom.newPackageSessions, custom.newPackagePriceEur, custom.newPackageExpiry, custom.newPackagePaymentMethod],
  ["Ten pack", "10", "600", "2031-01-01", "bank_transfer"],
);
assert.equal(custom.newPackageTemplateId, undefined);

// ------------------------------------------------------------ voucher, whole and split
const whole = asObject(draft({ paymentMethod: "voucher", voucherCode: "GIFT-ABC" }));
assert.deepEqual([whole.voucherCode, whole.secondaryPaymentMethod], ["GIFT-ABC", undefined]);
const split = asObject(draft({ paymentMethod: "voucher", voucherCode: "GIFT-ABC", secondaryPaymentMethod: "card" }));
assert.equal(split.secondaryPaymentMethod, "card");
const paper = asObject(draft({ paymentMethod: "voucher", voucherCode: "" }));
assert.equal(paper.voucherCode, undefined, "a paper voucher with no code sends no code (the old desk path)");
assert.equal(asObject(draft({ paymentMethod: "card", voucherCode: "GIFT-ABC" })).voucherCode, undefined, "a code typed then abandoned is not sent");

// ------------------------------------------------------------ notes + FormData
assert.equal(asObject(draft({ notes: "Allergic to nuts" })).notes, "Allergic to nuts");
const fd = bookingFormData(draft({ therapyIds: [1, 2] }));
assert.deepEqual(fd.getAll("therapyIds"), ["1", "2"]);
assert.equal(fd.get("status"), "scheduled");

// ------------------------------------------------------------ problems
assert.equal(bookingProblem(draft(), VOCAB), null);
assert.equal(bookingProblem(draft({ therapyIds: [] }), VOCAB), "Pick a therapy.");
assert.equal(bookingProblem(draft({ durationMinutes: 0 }), VOCAB), "Pick a therapy.");
assert.equal(bookingProblem(draft({ clientId: null }), VOCAB), "Pick a client.");
assert.equal(bookingProblem(draft({ clientMode: "walk_in" }), VOCAB), "Enter the walk-in client's first name.");
assert.equal(bookingProblem(draft({ startTime: "" }), VOCAB), "Pick a start time.");
assert.equal(
  bookingProblem(draft({ paymentMethod: "package", packageMode: "new", newPackage: { ...EMPTY_NEW_PACKAGE, name: "Ten pack", sessions: 10 } }), VOCAB),
  "Pick a package template or fill in the custom package details.",
  "a custom package needs an expiry",
);
assert.equal(bookingProblem(draft({ paymentMethod: "package", packageMode: "new", newPackage: { ...EMPTY_NEW_PACKAGE, templateId: 3 } }), VOCAB), null);
assert.equal(bookingProblem(draft({ clientId: null }), { service: "Class", member: "Member" }), "Pick a member.", "venue words");

assert.equal(readyToBook(draft()), true);
assert.equal(readyToBook(draft({ clientId: null })), false);
assert.equal(readyToBook(draft({ clientMode: "walk_in", walkIn: { firstName: "Sam", lastName: "", email: "", phone: "" } })), true);
assert.equal(readyToBook(draft({ therapyIds: [] })), false);
assert.equal(readyToBook(draft({ startTime: "" })), false);

console.log("booking bookingPayload: all checks passed.");
