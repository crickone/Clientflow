// Run: npm test -- src/lib/remindersModel.test.ts
import assert from "node:assert/strict";

import { checkinNudge, classReminderDue, dublinHour, dublinToMs, habitNudge, quietHours } from "./remindersModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

// 15 Oct 2026 is Irish summer time (UTC+1); 15 Dec is winter (UTC+0).
check("summer: 18:00 Irish is 17:00 UTC", dublinToMs("2026-10-15", "18:00") === Date.parse("2026-10-15T17:00:00Z"));
check("winter: 18:00 Irish is 18:00 UTC", dublinToMs("2026-12-15", "18:00") === Date.parse("2026-12-15T18:00:00Z"));
check("Irish hour reads the clock", dublinHour(Date.parse("2026-10-15T08:30:00Z")) === 9);
check("quiet from 9pm to 8am", quietHours(Date.parse("2026-10-15T20:30:00Z")) && quietHours(Date.parse("2026-10-15T06:30:00Z")) && !quietHours(Date.parse("2026-10-15T11:00:00Z")));

const start = dublinToMs("2026-10-15", "18:00");
check("2 hours before: due", classReminderDue(start, start - 120 * 60_000));
check("3 hours before: not yet", !classReminderDue(start, start - 180 * 60_000));
check("10 minutes before: too late to bother", !classReminderDue(start, start - 10 * 60_000));

const nine = Date.parse("2026-10-15T08:05:00Z"); // 09:05 Irish
const eight = Date.parse("2026-10-15T07:05:00Z"); // 08:05 Irish
check("check-in day from 9am: due", checkinNudge({ due: true, since: "2026-10-15", daysLate: 0 }, nine)?.key === "checkin:2026-10-15");
check("before 9am: wait", checkinNudge({ due: true, since: "2026-10-15", daysLate: 0 }, eight) === null);
check("two days late: one nudge", checkinNudge({ due: true, since: "2026-10-13", daysLate: 2 }, nine)?.kind === "missed");
check("one day late: nothing", checkinNudge({ due: true, since: "2026-10-14", daysLate: 1 }, nine) === null);
check("sent: nothing", checkinNudge({ due: false, since: "2026-10-15", daysLate: 0 }, nine) === null);

const seven = Date.parse("2026-10-15T18:10:00Z"); // 19:10 Irish
check("habits from 7pm when not done", habitNudge("2026-10-15", 1, 3, seven) === "habits:2026-10-15");
check("habits all done: nothing", habitNudge("2026-10-15", 3, 3, seven) === null);
check("habits in the afternoon: wait", habitNudge("2026-10-15", 0, 3, nine) === null);
check("no habits: nothing", habitNudge("2026-10-15", 0, 0, seven) === null);

console.log(`remindersModel: ${passed} checks passed`);
