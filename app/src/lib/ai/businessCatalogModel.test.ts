// Run: npm test -- src/lib/ai/businessCatalogModel.test.ts
import assert from "node:assert/strict";
import { catalogText, type CatalogData } from "./businessCatalogModel";

const empty: CatalogData = { offers: [], bundles: [], packages: [], memberships: [], vouchers: null };
assert.equal(catalogText(empty), "", "nothing to sell, nothing said");

const text = catalogText({
  offers: [{
    title: "Black Friday: infrared + HBOT", price: "€200", usual: "€260",
    includes: ["2 x Infrared Therapy", "2 x HBOT"], description: "", useBy: "Use within 14 days of buying",
    startsOn: null, endsOn: null, left: null, url: "https://optimalhealthatinspire.ie/c/black-friday-infrared-hbot-2026",
  }],
  bundles: [{ name: "HBOT 5-pack", sessions: 5, therapy: "HBOT", price: "€350", validityMonths: 3, recurring: null, notes: "" }],
  packages: [],
  memberships: [{ name: "Recovery club", price: "€99", every: "month", joiningFee: null, sessions: "4 sessions", description: "" }],
  vouchers: { amounts: ["€50", "€100"], custom: "any amount from €25 to €500", treatments: ["Swedish massage"], validYears: 5, url: "https://optimalhealthatinspire.ie/vouchers" },
});
assert.match(text, /Black Friday: infrared \+ HBOT: €200 \(usually €260\); includes 2 x Infrared Therapy, 2 x HBOT; use within 14 days of buying; on sale now; buy online at https:\/\/optimalhealthatinspire\.ie\/c\//, "an offer with its price, contents, use-by and link");
assert.match(text, /HBOT 5-pack: 5 x HBOT for €350; valid 3 months\./, "a session bundle");
assert.match(text, /Recovery club: €99 every month; 4 sessions\./, "a membership");
assert.match(text, /Sold online at https:\/\/optimalhealthatinspire\.ie\/vouchers: amounts of €50, €100; any amount from €25 to €500; a voucher for one session of Swedish massage\. Valid 5 years\./, "gift vouchers");
assert.match(text, /Quote these prices exactly/, "the instruction closes the list");

const soldOut = catalogText({ ...empty, offers: [{ title: "Massage", price: "€64", usual: null, includes: [], description: "", useBy: "Use by 1 March 2027", startsOn: null, endsOn: "30 November 2026", left: 0, url: null }] });
assert.match(soldOut, /use by 1 March 2027; on sale until 30 November 2026; sold out\./, "end date and sold out");
console.log("businessCatalogModel: 8 checks passed.");
