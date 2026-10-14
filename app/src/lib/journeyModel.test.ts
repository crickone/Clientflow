// Run: npm test -- src/lib/journeyModel.test.ts
//
// The client page's Journey tab: one timeline from first contact to now.
import assert from "node:assert/strict";

import { groupByDay, isOnlinePurchasePayment, orderJourney, toMs, type JourneyEvent } from "./journeyModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

check("seconds become ms", toMs(1791993208) === 1791993208000);
check("ms stay ms", toMs(1791993208000) === 1791993208000);
check("a Date works", toMs(new Date(5000)) === 5000);
check("a plain date is read at midday", toMs("2026-10-14") === Date.parse("2026-10-14T12:00:00Z"));
check("junk is null", toMs("nope") === null && toMs(null) === null);

const t = Date.parse("2026-10-14T15:53:28Z");
const events: JourneyEvent[] = [
  { at: t, kind: "stage", title: "Moved to Sale" },
  { at: t + 3_600_000, kind: "booked", title: "Booked Swedish massage" },
  { at: t, kind: "first-contact", title: "Bought online" },
  { at: t, kind: "purchase", title: "Bought Black Friday: Swedish massage" },
];
const ordered = orderJourney(events);
check("oldest first, and at the same moment the contact comes before the stage", ordered.map((e) => e.kind).join() === "first-contact,purchase,stage,booked");

const days = groupByDay([...ordered, { at: Date.parse("2026-10-15T13:00:00Z"), kind: "treatment", title: "Had infrared" }]);
check("grouped by Irish day", days.length === 2 && days[0].events.length === 4 && days[1].day === "2026-10-15");

check("the payment row an online purchase writes is recognised", isOnlinePurchasePayment("Online: Black Friday: Swedish massage (Stripe pi_x)"));
check("a desk payment is kept", !isOnlinePurchasePayment(null) && !isOnlinePurchasePayment("Paid at reception"));

console.log(`journeyModel: ${passed} checks passed`);
