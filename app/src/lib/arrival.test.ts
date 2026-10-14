// Run: npm test -- src/lib/arrival.test.ts
//
// A client's journey says how they arrived the visit they got in touch: the
// ad or post link, or the site that sent them.
import assert from "node:assert/strict";

import { arrivalFromPage, describeArrival, parseArrival } from "./arrival";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const fbAd = arrivalFromPage("https://www.optimalhealthatinspire.ie/c/black-friday-massage-2026?utm_source=facebook&utm_medium=paid&utm_campaign=Black%20Friday%20Massage&fbclid=abc", "https://l.facebook.com/", 1);
check("a Facebook ad link is read", fbAd?.source === "facebook" && fbAd.click === "facebook" && fbAd.landing === "/c/black-friday-massage-2026");
check("it reads as a Facebook ad with its campaign", describeArrival(fbAd) === "Facebook ad (Black Friday Massage)");

const google = arrivalFromPage("https://www.optimalhealthatinspire.ie/massage", "https://www.google.com/", 1);
check("Google search with no tags", describeArrival(google) === "Google search");
check("a Google ad click", describeArrival(arrivalFromPage("https://x.ie/?gclid=1", "", 1)) === "Google ad");
check("an Instagram bio link", describeArrival(arrivalFromPage("https://x.ie/", "https://l.instagram.com/", 1)) === "Instagram");
check("a newsletter link", describeArrival(arrivalFromPage("https://x.ie/?utm_source=newsletter&utm_medium=email", "", 1)) === "Newsletter email");

const direct = arrivalFromPage("https://www.x.ie/contact", "https://www.x.ie/", 1);
check("coming from another page on the same site isn't a referrer", direct?.referrer === undefined);
check("no tags and no referrer reads as typed or saved", describeArrival(direct) === "Typed the address or used a saved link");
check("nothing recorded says so", describeArrival(null) === "No record of how they arrived");

check("junk is refused", parseArrival("not json") === null && parseArrival({ at: 5 }) === null);
check("odd characters are stripped", parseArrival({ source: "face<script>book" })?.source === "facescriptbook");
check("a JSON string parses", parseArrival(JSON.stringify({ referrer: "Google.com" }))?.referrer === "google.com");

console.log(`arrival: ${passed} checks passed`);
