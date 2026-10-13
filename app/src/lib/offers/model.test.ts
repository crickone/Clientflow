// Run: npm test -- src/lib/offers/model.test.ts
//
// When an offer can be bought, how a price splits across bundles, and what
// the operator is allowed to save.
import assert from "node:assert/strict";

import { discountedCents, formatEur, offerState, parseEuroToCents, parseItems, remaining, savingLabel, splitPrice, validateOffer, type OfferInput } from "./model";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const now = Date.UTC(2026, 10, 27, 10);
const base = { isActive: true, saleStartsAt: null, saleEndsAt: null, quantityLimit: null };
check("switched off", offerState({ ...base, isActive: false }, 0, now) === "off");
check("live with no limits", offerState(base, 99, now) === "live");
check("before the start", offerState({ ...base, saleStartsAt: now + 1 }, 0, now) === "scheduled");
check("after the end", offerState({ ...base, saleEndsAt: now }, 0, now) === "ended");
check("ended beats sold out", offerState({ ...base, saleEndsAt: now - 1, quantityLimit: 5 }, 5, now) === "ended");
check("sold out at the limit", offerState({ ...base, quantityLimit: 5 }, 5, now) === "sold_out");
check("one left is live", offerState({ ...base, quantityLimit: 5 }, 4, now) === "live");
check("remaining never negative", remaining(5, 7) === 0 && remaining(null, 3) === null);

check("whole euros drop the cents", formatEur(4900) === "€49");
check("cents shown when present", formatEur(4950) === "€49.50");
check("saving label", savingLabel(4900, 8000) === "Save €31" && savingLabel(4900, null) === null && savingLabel(4900, 4900) === null);
check("euro parsing", parseEuroToCents("€49,50") === 4950 && parseEuroToCents("49") === 4900 && parseEuroToCents("4.999") === null && parseEuroToCents("") === null);

const split = splitPrice(9900, [2 * 60, 2 * 45]);
check("split adds up exactly", split[0] + split[1] === 9900);
check("split follows the usual value", split[0] > split[1]);
check("split of three cents", splitPrice(100, [1, 1, 1]).reduce((a, b) => a + b, 0) === 100);
check("zero weights split evenly", splitPrice(1000, [0, 0]).join() === "500,500");

check("items parse and drop junk", parseItems('[{"therapyId":3,"sessions":2},{"therapyId":"x","sessions":1},{"therapyId":4,"sessions":0}]').length === 1);
check("bad json is no items", parseItems("{").length === 0);

const good: OfferInput = {
  title: " Black Friday: 2 HBOT + 2 infrared ",
  description: null,
  priceCents: 9900,
  compareAtCents: 16000,
  items: [{ therapyId: 1, sessions: 2 }, { therapyId: 2, sessions: 2 }],
  quantityLimit: 30,
  saleStartsAt: null,
  saleEndsAt: now,
  useByDate: "2027-02-28",
  terms: null,
};
const v = validateOffer(good);
check("a good offer passes and is trimmed", v.ok && v.value.title === "Black Friday: 2 HBOT + 2 infrared");
check("usual price must be higher", !validateOffer({ ...good, compareAtCents: 9900 }).ok);
check("needs a service", !validateOffer({ ...good, items: [] }).ok);
check("no duplicate services", !validateOffer({ ...good, items: [{ therapyId: 1, sessions: 1 }, { therapyId: 1, sessions: 2 }] }).ok);
check("price floor", !validateOffer({ ...good, priceCents: 10 }).ok);
check("end after start", !validateOffer({ ...good, saleStartsAt: now, saleEndsAt: now }).ok);
check("use-by date required", !validateOffer({ ...good, useByDate: "" }).ok);

check("20% off €80 is €64", discountedCents(8000, 20) === 6400);
check("20% off €50 is €40", discountedCents(5000, 20) === 4000);
check("percent is clamped", discountedCents(1000, 150) === 50 && discountedCents(1000, 0) === 990);

console.log(`offers/model: ${passed} checks passed`);
