// Run: npm test -- src/lib/dashboard/metrics/frontdesk.test.ts
import assert from "node:assert/strict";
import {
  dublinLocalToMs,
  leadTimeBucket,
  LEAD_BUCKETS,
  openMinutesFor,
  upcomingBirthdays,
  utilisationByWeekday,
} from "./frontdesk";
import { shortDay } from "./stats";

const H = 3_600_000;

// dublinLocalToMs: winter is UTC, summer is UTC+1, across the spring change.
assert.equal(dublinLocalToMs("2026-01-15", "10:00"), Date.UTC(2026, 0, 15, 10));
assert.equal(dublinLocalToMs("2026-07-15", "10:00"), Date.UTC(2026, 6, 15, 9));
// 2026-03-29: clocks go forward at 01:00 UTC. 00:30 is still GMT, 02:30 is IST.
assert.equal(dublinLocalToMs("2026-03-29", "00:30"), Date.UTC(2026, 2, 29, 0, 30));
assert.equal(dublinLocalToMs("2026-03-29", "02:30"), Date.UTC(2026, 2, 29, 1, 30));
// 2026-10-25: clocks go back at 01:00 UTC. 12:00 is GMT again.
assert.equal(dublinLocalToMs("2026-10-24", "12:00"), Date.UTC(2026, 9, 24, 11));
assert.equal(dublinLocalToMs("2026-10-25", "12:00"), Date.UTC(2026, 9, 25, 12));

// leadTimeBucket
assert.equal(leadTimeBucket(-1), "After the start");
assert.equal(leadTimeBucket(0), "Under 24 hours");
assert.equal(leadTimeBucket(23 * H), "Under 24 hours");
assert.equal(leadTimeBucket(24 * H), "1 to 3 days");
assert.equal(leadTimeBucket(71 * H), "1 to 3 days");
assert.equal(leadTimeBucket(72 * H), "3 to 7 days");
assert.equal(leadTimeBucket(7 * 24 * H), "Over a week");
assert.deepEqual([...LEAD_BUCKETS], ["Under 24 hours", "1 to 3 days", "3 to 7 days", "Over a week", "After the start"]);

// upcomingBirthdays: 2026-12-28 + 7 days wraps into January.
const people = [
  { id: 1, name: "Ann", dob: "1990-12-30" },
  { id: 2, name: "Bob", dob: "1985-01-02" },
  { id: 3, name: "Cat", dob: "2000-01-05" },
  { id: 4, name: "Dan", dob: null },
  { id: 5, name: "Eve", dob: "1970-12-28" },
  { id: 6, name: "Bad", dob: "nope" },
];
assert.deepEqual(
  upcomingBirthdays(people, "2026-12-28", 7).map((b) => [b.name, b.date]),
  [["Eve", "2026-12-28"], ["Ann", "2026-12-30"], ["Bob", "2027-01-02"]],
  "year wrap, today included, window ends before the 4th of January",
);
// 29 Feb birthday shows on 28 Feb in a non-leap year, on 29 Feb in a leap year.
const leap = [{ id: 1, name: "Leap", dob: "2000-02-29" }];
assert.deepEqual(upcomingBirthdays(leap, "2027-02-25", 7).map((b) => b.date), ["2027-02-28"]);
assert.deepEqual(upcomingBirthdays(leap, "2028-02-25", 7).map((b) => b.date), ["2028-02-29"]);

// openMinutesFor
const hours = [
  { dow: 0, closed: true },
  { dow: 1, closed: false, open: "09:00", close: "17:30" },
  { dow: 2, closed: false },
];
assert.equal(openMinutesFor(0, hours), 0);
assert.equal(openMinutesFor(1, hours), 510);
assert.equal(openMinutesFor(2, hours), 0, "open day without times counts nothing");
assert.equal(openMinutesFor(5, hours), 0, "missing day");

// utilisationByWeekday: two Mondays (2026-10-05, 2026-10-12) and a Sunday (closed).
const days = ["2026-10-04", "2026-10-05", "2026-10-12"];
const u = utilisationByWeekday(
  [
    { date: "2026-10-05", startTime: "09:00", endTime: "10:00" },
    { date: "2026-10-12", startTime: "10:00", endTime: "11:30" },
  ],
  days,
  hours,
);
assert.equal(u.rows.length, 7);
assert.equal(u.rows[0].label, "Mon");
assert.equal(u.rows[0].booked, 150);
assert.equal(u.rows[0].open, 1020);
assert.equal(u.rows[0].pct, 14.7);
assert.equal(u.rows[6].pct, null, "Sunday is closed: no percentage");
assert.equal(u.overallPct, 14.7);
assert.equal(utilisationByWeekday([], [], hours).overallPct, null);

assert.equal(shortDay("2026-10-06"), "Tue 6 Oct");

console.log("frontdesk.test.ts: ok");
