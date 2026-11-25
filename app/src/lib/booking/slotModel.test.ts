// Run: npm test -- src/lib/booking/slotModel.test.ts
import assert from "node:assert/strict";

import {
  BOOKING_STEP_MINUTES,
  addDaysIso,
  blocksCoverDay,
  dayStrip,
  groupByPeriod,
  onGrid,
  periodOf,
  slotCandidates,
  stripStart,
} from "./slotModel";

assert.equal(BOOKING_STEP_MINUTES, 15);

// ------------------------------------------------------------ candidates
const day = slotCandidates("09:00", "19:00", 60);
assert.equal(day[0], "09:00", "first start is opening time");
assert.equal(day[1], "09:15", "then every 15 minutes");
assert.equal(day[day.length - 1], "18:00", "the last start still ends by closing");
assert.equal(day.length, 37, "09:00 to 18:00 on a 15-minute grid");

assert.deepEqual(slotCandidates("09:00", "10:00", 45), ["09:00", "09:15"], "a session never runs past close");
assert.deepEqual(slotCandidates("09:00", "10:00", 60), ["09:00"], "a session may end exactly at close");
assert.deepEqual(slotCandidates("09:00", "10:00", 90), [], "too long for the day");
assert.deepEqual(slotCandidates("08:10", "09:00", 30), ["08:15", "08:30"], "an off-grid opening starts at the next grid line");
assert.deepEqual(slotCandidates("09:00", "10:00", 30, 30), ["09:00", "09:30"], "the grid can be changed");
assert.deepEqual(slotCandidates("09:00", "17:00", 0), [], "no length, no times");
assert.deepEqual(slotCandidates("09:00", "17:00", 30, 0), [], "no grid, no times");

// ------------------------------------------------------------ block-outs
assert.equal(blocksCoverDay("09:00", "17:00", []), false);
assert.equal(blocksCoverDay("09:00", "17:00", [{ startTime: "00:00", endTime: "23:59" }]), true, "an all-day block closes the day");
assert.equal(blocksCoverDay("09:00", "17:00", [{ startTime: "09:00", endTime: "13:00" }]), false, "a morning block leaves the afternoon");
assert.equal(
  blocksCoverDay("09:00", "17:00", [
    { startTime: "12:00", endTime: "17:30" },
    { startTime: "08:00", endTime: "12:00" },
  ]),
  true,
  "two blocks meeting end to end cover the day, in any order",
);
assert.equal(
  blocksCoverDay("09:00", "17:00", [
    { startTime: "09:00", endTime: "12:00" },
    { startTime: "12:15", endTime: "17:00" },
  ]),
  false,
  "a 15-minute gap keeps the day open",
);
assert.equal(blocksCoverDay("09:00", "09:00", []), true, "an empty window is closed");

// ------------------------------------------------------------ days
assert.equal(addDaysIso("2026-11-25", 1), "2026-11-26");
assert.equal(addDaysIso("2026-11-30", 1), "2026-12-01");
assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
assert.equal(addDaysIso("2026-03-28", 2), "2026-03-30", "no daylight-saving drift");

const strip = dayStrip("2026-11-25", 14, (d) => d === "2026-11-29");
assert.equal(strip.length, 14);
assert.deepEqual(strip[0], { date: "2026-11-25", weekday: "Wed", day: 25, closed: false });
assert.deepEqual(strip[4], { date: "2026-11-29", weekday: "Sun", day: 29, closed: true });
assert.deepEqual(strip[6], { date: "2026-12-01", weekday: "Tue", day: 1, closed: false });
assert.equal(strip[13].date, "2026-12-08");

assert.equal(stripStart("2026-11-25", "2026-11-25"), "2026-11-25");
assert.equal(stripStart("2026-11-25", "2026-12-08"), "2026-11-25", "the 14th day is still inside the strip");
assert.equal(stripStart("2026-11-25", "2026-12-09"), "2026-12-09", "a date past the strip starts the strip");
assert.equal(stripStart("2026-11-25", "2026-11-20"), "2026-11-20", "a past date (recording a past session) starts the strip");

// ------------------------------------------------------------ periods
assert.equal(periodOf("09:00"), "Morning");
assert.equal(periodOf("11:45"), "Morning");
assert.equal(periodOf("12:00"), "Afternoon");
assert.equal(periodOf("16:45"), "Afternoon");
assert.equal(periodOf("17:00"), "Evening");

const grouped = groupByPeriod([{ time: "09:00" }, { time: "11:45" }, { time: "12:00" }, { time: "18:00" }]);
assert.deepEqual(
  grouped.map((g) => [g.period, g.slots.map((s) => s.time)]),
  [
    ["Morning", ["09:00", "11:45"]],
    ["Afternoon", ["12:00"]],
    ["Evening", ["18:00"]],
  ],
);
assert.deepEqual(groupByPeriod([]), []);

assert.equal(onGrid("12:45"), true);
assert.equal(onGrid("12:40"), false);
assert.equal(onGrid(""), false);
assert.equal(onGrid("9:00"), false, "only HH:mm counts");

console.log("booking slotModel: all checks passed.");
