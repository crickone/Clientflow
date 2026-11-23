// Run: npm test -- src/lib/offers/useWithin.test.ts
//
// "Use within N days of buying": each buyer's expiry, its wording, and what
// the operator is allowed to save.
import assert from "node:assert/strict";

import { expiryFor, useByLabel, validateOffer, type OfferInput } from "./model";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const paid = Date.UTC(2026, 10, 27, 10); // 27 Nov 2026, 10:00 UTC (winter, Dublin = UTC)

check("no days gives the use-by date", expiryFor({ useByDate: "2027-03-01", useWithinDays: null }, paid) === "2027-03-01");
check("days left out gives the use-by date", expiryFor({ useByDate: "2027-03-01" }, paid) === "2027-03-01");
check("14 days is purchase day + 14", expiryFor({ useByDate: "2027-03-01", useWithinDays: 14 }, paid) === "2026-12-11");
check("crosses a month and year end", expiryFor({ useByDate: "2027-03-01", useWithinDays: 10 }, Date.UTC(2026, 11, 28, 9)) === "2027-01-07");

// 23:30 UTC on 10 July is 00:30 on 11 July in Dublin (IST), so the buyer's day is the 11th.
const lateSummer = Date.UTC(2026, 6, 10, 23, 30);
check("Dublin day is used, not the UTC day", expiryFor({ useByDate: "2027-03-01", useWithinDays: 14 }, lateSummer) === "2026-07-25");
// The same instant in winter is still the 10th in Dublin.
check("winter UTC night stays the same day", expiryFor({ useByDate: "2027-03-01", useWithinDays: 14 }, Date.UTC(2026, 0, 10, 23, 30)) === "2026-01-24");

check("capped at the use-by date when that is earlier", expiryFor({ useByDate: "2026-12-05", useWithinDays: 14 }, paid) === "2026-12-05");
check("equal dates give that date", expiryFor({ useByDate: "2026-12-11", useWithinDays: 14 }, paid) === "2026-12-11");

check("label with a date", useByLabel({ useByDate: "2027-03-01", useWithinDays: null }) === "Use by 1 March 2027");
check("label with days", useByLabel({ useByDate: "2027-03-01", useWithinDays: 14 }) === "Use within 14 days of buying");
check("label with one day", useByLabel({ useByDate: "2027-03-01", useWithinDays: 1 }) === "Use within 1 day of buying");

const good: OfferInput = {
  title: "2 infrared + 2 HBOT",
  description: null,
  priceCents: 20000,
  compareAtCents: null,
  items: [{ therapyId: 1, sessions: 2 }, { therapyId: 2, sessions: 2 }],
  quantityLimit: null,
  saleStartsAt: null,
  saleEndsAt: null,
  useByDate: "2027-03-01",
  terms: null,
};
const ok = validateOffer({ ...good, useWithinDays: 14 });
check("14 days passes and is kept", ok.ok && ok.value.useWithinDays === 14);
check("empty (null) passes", validateOffer({ ...good, useWithinDays: null }).ok);
check("left out passes", validateOffer(good).ok);
check("1 and 365 pass", validateOffer({ ...good, useWithinDays: 1 }).ok && validateOffer({ ...good, useWithinDays: 365 }).ok);
check("0 is rejected", !validateOffer({ ...good, useWithinDays: 0 }).ok);
check("400 is rejected", !validateOffer({ ...good, useWithinDays: 400 }).ok);
check("2.5 is rejected", !validateOffer({ ...good, useWithinDays: 2.5 }).ok);
check("NaN is rejected", !validateOffer({ ...good, useWithinDays: Number.NaN }).ok);
check("use-by date is still required", !validateOffer({ ...good, useByDate: "", useWithinDays: 14 }).ok);

console.log(`useWithin: ${passed} checks passed`);
