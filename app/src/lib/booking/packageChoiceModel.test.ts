// Run: npm test -- src/lib/booking/packageChoiceModel.test.ts
import assert from "node:assert/strict";

import {
  offerText,
  packagesFor,
  prepaidOffers,
  reconcilePackageChoice,
  sameChoice,
  type PaymentChoice,
  type UsablePackage,
} from "./packageChoiceModel";

const pkg = (id: number, therapyId: number, over: Partial<UsablePackage> = {}): UsablePackage => ({
  id,
  therapyId,
  packageName: `Package ${id}`,
  totalSessions: 1,
  sessionsUsed: 0,
  pricePaidEur: 64,
  expiryDate: "2027-03-01",
  available: 1,
  ...over,
});

const DEEP = 17;
const HBOT = 1;
const PKGS = [pkg(7, DEEP, { packageName: "Black Friday" }), pkg(8, HBOT, { available: 3, totalSessions: 5, sessionsUsed: 2 })];

const cash: PaymentChoice = { paymentMethod: "cash", packageMode: "existing", packageId: null };

// ------------------------------------------------------------ fitting packages
assert.deepEqual(packagesFor(PKGS, DEEP).map((p) => p.id), [7]);
assert.deepEqual(packagesFor(PKGS, null), [], "no treatment, no package");
assert.deepEqual(packagesFor([pkg(9, DEEP, { available: 0 })], DEEP), [], "a package with nothing left to book does not fit");

// ------------------------------------------------------------ reconcile
assert.deepEqual(
  reconcilePackageChoice(cash, PKGS, DEEP, false),
  { paymentMethod: "package", packageMode: "existing", packageId: 7 },
  "a prepaid session is used by default until staff choose a method",
);
assert.deepEqual(
  reconcilePackageChoice(cash, PKGS, DEEP, true),
  { paymentMethod: "cash", packageMode: "existing", packageId: 7 },
  "once staff chose cash, cash stays (the package is remembered for the Prepaid button)",
);
assert.deepEqual(
  reconcilePackageChoice({ paymentMethod: "package", packageMode: "existing", packageId: 7 }, PKGS, 99, true),
  { paymentMethod: "cash", packageMode: "existing", packageId: null },
  "switching to a treatment no package covers falls back to cash",
);
assert.deepEqual(
  reconcilePackageChoice({ paymentMethod: "package", packageMode: "existing", packageId: 7 }, PKGS, 99, true, "card"),
  { paymentMethod: "card", packageMode: "existing", packageId: null },
  "the fallback method can be named",
);
assert.deepEqual(
  reconcilePackageChoice({ paymentMethod: "package", packageMode: "existing", packageId: 7 }, [], DEEP, false),
  { paymentMethod: "cash", packageMode: "existing", packageId: null },
  "a date past the package's use-by date removes it, and the payment falls back",
);
const twoFit = [pkg(7, DEEP), pkg(10, DEEP)];
assert.equal(
  reconcilePackageChoice({ paymentMethod: "package", packageMode: "existing", packageId: 10 }, twoFit, DEEP, true).packageId,
  10,
  "the package staff picked is kept while it still fits",
);
const signUp: PaymentChoice = { paymentMethod: "package", packageMode: "new", packageId: null };
assert.equal(reconcilePackageChoice(signUp, PKGS, DEEP, false), signUp, "signing up for a new package is left alone");
const voucher: PaymentChoice = { paymentMethod: "voucher", packageMode: "existing", packageId: null };
assert.deepEqual(
  reconcilePackageChoice(voucher, PKGS, DEEP, true),
  { paymentMethod: "voucher", packageMode: "existing", packageId: 7 },
  "a voucher redemption (method chosen up front) is not switched to the package",
);
assert.deepEqual(reconcilePackageChoice(cash, [], null, false), cash, "nothing to reconcile");

assert.equal(sameChoice(cash, { ...cash }), true);
assert.equal(sameChoice(cash, { ...cash, packageId: 7 }), false);

// ------------------------------------------------------------ banners
const treatments = [
  { id: DEEP, name: "Deep tissue massage", defaultDurationMinutes: 60 },
  { id: HBOT, name: "HBOT", defaultDurationMinutes: 60 },
];
const offers = prepaidOffers([...PKGS, pkg(11, 404)], treatments);
assert.deepEqual(
  offers.map((o) => [o.packageId, o.therapyId, o.count, o.treatment, o.minutes]),
  [
    [7, DEEP, 1, "Deep tissue massage", 60],
    [8, HBOT, 3, "HBOT", 60],
  ],
  "one line per usable package; a package for a retired treatment is left out",
);
assert.deepEqual(offerText(offers[0], "Mary"), {
  lead: "Mary has ",
  strong: "1 prepaid Deep tissue massage",
  rest: ", 60 min, from Black Friday. Use by 1 Mar 2027.",
});
const suffixed = prepaidOffers([pkg(20, 31)], [{ id: 31, name: "Swedish massage (30 min)", defaultDurationMinutes: 30 }]);
assert.equal(suffixed[0].treatment, "Swedish massage", "the length suffix is dropped; the minutes are said once");
assert.equal(offerText(suffixed[0], "Mary").strong, "1 prepaid Swedish massage");
assert.equal(offerText(offers[0], "  ").lead, "This client has ", "no first name yet");

console.log("booking packageChoiceModel: all checks passed.");
