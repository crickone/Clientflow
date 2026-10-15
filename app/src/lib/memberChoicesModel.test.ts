// Run: npm test -- src/lib/memberChoicesModel.test.ts
//
// News-and-offers consent and the weekly check-in clock.
import assert from "node:assert/strict";

import { checkinState, consentStatement, currentConsent, isPhotoName, photoNames, weekdayOf } from "./memberChoicesModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

check("the statement names the business", consentStatement("email", "Inspire").includes("from Inspire") && consentStatement("sms", "Inspire").includes("WhatsApp"));
const c = currentConsent([
  { channel: "email", granted: true, at: 1 },
  { channel: "email", granted: false, at: 5 },
  { channel: "sms", granted: true, at: 3 },
]);
check("the latest answer per channel wins", c.email?.granted === false && c.email.at === 5 && c.sms?.granted === true);
check("never asked is null", currentConsent([]).email === null);

check("15 Oct 2026 is a Thursday", weekdayOf("2026-10-15") === 4);
check("a Sunday is 7", weekdayOf("2026-10-18") === 7);

// Check-in day Monday (1). Today Thursday 15 Oct.
const s = checkinState(1, "2026-10-15", null);
check("never sent: due since Monday", s.due && s.since === "2026-10-12" && s.next === "2026-10-19" && s.daysLate === 3);
check("sent on Monday: done", !checkinState(1, "2026-10-15", "2026-10-12").due);
check("sent last week: due again", checkinState(1, "2026-10-15", "2026-10-11").due);
check("check-in day is today: due today", checkinState(4, "2026-10-15", "2026-10-09").daysLate === 0 && checkinState(4, "2026-10-15", "2026-10-09").due);
check("check-in day tomorrow: counts from last week's", checkinState(5, "2026-10-15", null).since === "2026-10-09");

const uuid = "0f8fad5b-d9cb-469f-a165-70867728950e";
check("a stored photo name is recognised", isPhotoName(`${uuid}.jpg`) && !isPhotoName("../etc/passwd") && !isPhotoName(`${uuid}.exe`));
check("photo answers keep up to three good names", photoNames(`${uuid}.jpg|bad|${uuid}.png|${uuid}.webp|${uuid}.jpg`).length === 3);

console.log(`memberChoicesModel: ${passed} checks passed`);
