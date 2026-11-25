// Run: npm test -- src/lib/leadFlows/alertText.test.ts
import assert from "node:assert/strict";

import { callBackAlertText, firstChars, hotLeadAlertText, newLeadAlertText } from "./alertText";

let n = 0;
const eq = (a: string, b: string, name: string) => {
  assert.equal(a, b, name);
  n++;
};

eq(
  newLeadAlertText({ name: "Aoife Example", source: "From the website", phone: "+353870000000", link: "http://app.test/leads/7" }),
  "New lead: Aoife Example, From the website. +353870000000. Open: http://app.test/leads/7",
  "the new-lead alert, exactly",
);
eq(newLeadAlertText({ name: "Aoife Example", source: "From a form", phone: null, link: "http://app.test/leads/7" }), "New lead: Aoife Example, From a form. No phone. Open: http://app.test/leads/7", "no phone");
eq(
  hotLeadAlertText({ name: "Aoife Example", reply: "Yes please, Tuesday works", link: "http://app.test/leads/7" }),
  'Hot lead: Aoife Example replied: "Yes please, Tuesday works". Open: http://app.test/leads/7',
  "the hot-lead alert, exactly",
);
const long = "word ".repeat(60);
eq(firstChars(long), "word ".repeat(24).trim(), "the first 120 characters, whitespace tidied");
assert.ok(hotLeadAlertText({ name: "A", reply: long, link: "L" }).length < 160);
n++;
eq(hotLeadAlertText({ name: "Aoife Example", reply: null, link: "http://app.test/leads/7" }), "Hot lead: Aoife Example replied. Open: http://app.test/leads/7", "no text: no quote");
eq(callBackAlertText({ name: "Aoife Example", phone: "+353870000000", link: "http://app.test/leads/7" }), "Call back today: Aoife Example, +353870000000. Open: http://app.test/leads/7", "the call-back reminder");

console.log(`alertText: ${n} checks passed.`);
