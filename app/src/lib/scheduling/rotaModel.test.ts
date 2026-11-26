// Run: npm test -- src/lib/scheduling/rotaModel.test.ts
import assert from "node:assert/strict";

import {
  buildRotaWeek,
  coverForDate,
  coverRuns,
  coverText,
  dayLabel,
  hoursLabel,
  initials,
  lookAtFrom,
  mondayOf,
  shiftLabel,
  validateShift,
  weekDates,
  weekRangeLabel,
  type OpeningHourLike,
  type ShiftRow,
} from "./rotaModel";

const HOURS: OpeningHourLike[] = [
  { dow: 0, closed: true },
  { dow: 1, closed: false, open: "09:00", close: "19:00" },
  { dow: 2, closed: false, open: "09:00", close: "19:00" },
  { dow: 3, closed: false, open: "09:00", close: "17:00" },
  { dow: 4, closed: false, open: "09:00", close: "19:00" },
  { dow: 5, closed: false, open: "09:00", close: "17:00" },
  { dow: 6, closed: false, open: "09:00", close: "14:00" },
];
const h = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

// Week maths. 2026-11-30 is a Monday; 2026-12-06 the Sunday.
assert.equal(mondayOf("2026-11-30"), "2026-11-30");
assert.equal(mondayOf("2026-12-06"), "2026-11-30");
assert.equal(mondayOf("2026-12-02"), "2026-11-30");
assert.deepEqual(weekDates("2026-11-30"), [
  "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05", "2026-12-06",
]);
assert.equal(weekRangeLabel("2026-11-30"), "Mon 30 Nov – Sun 6 Dec");
assert.equal(dayLabel("2026-12-01"), "Tue 1");
assert.equal(shiftLabel("09:00", "17:00"), "9:00–17:00");
assert.equal(shiftLabel("13:30", "19:00"), "13:30–19:00");
assert.equal(initials("Example Therapist"), "ET");
assert.equal(initials("  example "), "E");
assert.equal(hoursLabel([{ start: "09:00", end: "17:00" }, { start: "09:00", end: "17:00" }, { start: "11:00", end: "19:00" }, { start: "09:00", end: "17:00" }]), "32 h this week");
assert.equal(hoursLabel([{ start: "09:00", end: "12:30" }]), "3.5 h this week");
assert.equal(hoursLabel([]), "No shifts this week");

// Validation.
const ok = { staffId: 1, date: "2026-11-30", start: "09:00", end: "17:00" };
assert.equal(validateShift(ok, HOURS, []), null);
assert.equal(validateShift({ ...ok, start: "9:00" }, HOURS, []), "Give the times as HH:mm.");
assert.equal(validateShift({ ...ok, date: "2026-12-06" }, HOURS, []), "Closed that day, so no shifts.");
assert.equal(validateShift({ ...ok, end: "09:00" }, HOURS, []), "The shift has to end after it starts.");
assert.equal(validateShift({ ...ok, end: "19:30" }, HOURS, []), "Shifts have to sit inside opening hours (09:00–19:00).");
assert.equal(validateShift({ ...ok, start: "08:30" }, HOURS, []), "Shifts have to sit inside opening hours (09:00–19:00).");
assert.equal(
  validateShift({ ...ok, start: "16:00", end: "19:00" }, HOURS, [{ id: 7, ...ok }]),
  "This overlaps another shift for the same person.",
);
assert.equal(validateShift({ ...ok, start: "17:00", end: "19:00" }, HOURS, [{ id: 7, ...ok }]), null, "a split day is two shifts");
assert.equal(validateShift({ id: 7, ...ok, end: "18:00" }, HOURS, [{ id: 7, ...ok }]), null, "editing a shift ignores itself");
assert.equal(validateShift({ ...ok, start: "10:00" }, HOURS, [{ id: 8, ...ok, staffId: 2 }]), null, "another person may overlap");

// Coverage runs and text, as the mockup's Monday.
const mon = coverRuns([{ start: "09:00", end: "17:00" }, { start: "13:00", end: "19:00" }], h("09:00"), h("19:00"));
assert.deepEqual(mon, [
  { startMin: h("09:00"), endMin: h("13:00"), count: 1 },
  { startMin: h("13:00"), endMin: h("17:00"), count: 2 },
  { startMin: h("17:00"), endMin: h("19:00"), count: 1 },
]);
assert.deepEqual(coverText(mon), ["1 on 9–13", "2 on 13–17", "1 on 17–19"]);
assert.deepEqual(coverText(coverRuns([{ start: "09:00", end: "17:00" }], h("09:00"), h("19:00"))), ["1 on 9–17", "None 17–19"]);
assert.deepEqual(coverText(coverRuns([], h("09:00"), h("14:00"))), ["Nobody on"]);
assert.deepEqual(coverText(coverRuns([{ start: "09:30", end: "14:00" }], h("09:00"), h("14:00"))), ["None 9–9:30", "1 on 9:30–14"]);

// Cover for a date.
const shift = (id: number, staffId: number, date: string, start: string, end: string): ShiftRow => ({ id, staffId, date, start, end });
assert.deepEqual(coverForDate("2026-11-30", { rotaOn: false, weekShifts: [], openingHours: HOURS }), { mode: "off" });
assert.deepEqual(coverForDate("2026-11-30", { rotaOn: true, weekShifts: [], openingHours: HOURS }), { mode: "assumeOne", openMin: h("09:00"), closeMin: h("19:00") });
assert.deepEqual(coverForDate("2026-12-06", { rotaOn: true, weekShifts: [], openingHours: HOURS }), { mode: "assumeOne", openMin: 0, closeMin: 0 });
const week = [shift(1, 1, "2026-11-30", "09:00", "17:00")];
assert.deepEqual(coverForDate("2026-11-30", { rotaOn: true, weekShifts: week, openingHours: HOURS }), { mode: "shifts", shifts: [{ startMin: h("09:00"), endMin: h("17:00") }] });
assert.deepEqual(coverForDate("2026-12-01", { rotaOn: true, weekShifts: week, openingHours: HOURS }), { mode: "shifts", shifts: [] }, "a day with no shifts in a week that has some has nobody on");

// Bookings to look at: the later-booked one in a clash is listed, once.
const coverOf = (d: string) => coverForDate(d, { rotaOn: true, weekShifts: week, openingHours: HOURS });
const items = lookAtFrom(
  [
    { id: 10, date: "2026-11-30", startTime: "14:00", endTime: "15:00", staffing: "whole", label: "Deep tissue massage" },
    { id: 11, date: "2026-11-30", startTime: "14:00", endTime: "15:00", staffing: "setup", label: "HBOT" },
    { id: 12, date: "2026-11-30", startTime: "15:00", endTime: "16:00", staffing: "setup", label: "HBOT" },
    { id: 13, date: "2026-12-05", startTime: "11:00", endTime: "12:00", staffing: "setup", label: "Infrared" },
  ],
  coverOf,
);
assert.deepEqual(items, [
  { appointmentId: 11, date: "2026-11-30", startTime: "14:00", title: "Mon 30 Nov, 14:00 · HBOT", reason: "Only one therapist on at 14:00 and Deep tissue massage is booked then." },
  { appointmentId: 13, date: "2026-12-05", startTime: "11:00", title: "Sat 5 Dec, 11:00 · Infrared", reason: "Nobody is on the rota then." },
]);
assert.deepEqual(lookAtFrom([{ id: 1, date: "2026-11-30", startTime: "14:00", endTime: "15:00", staffing: "whole", label: "X" }], () => ({ mode: "off" })), []);

// The page's data.
const data = buildRotaWeek({
  monday: "2026-11-30",
  rotaOn: true,
  openingHours: HOURS,
  people: [{ id: 1, name: "Example Therapist" }, { id: 2, name: "Second Therapist" }],
  weekShifts: [shift(1, 1, "2026-11-30", "09:00", "17:00"), shift(2, 2, "2026-11-30", "13:00", "19:00")],
  lastWeekShiftCount: 4,
  appts: [],
  treatments: [{ id: 1, name: "HBOT", staffing: "setup" }],
});
assert.equal(data.rangeLabel, "Mon 30 Nov – Sun 6 Dec");
assert.equal(data.prevMonday, "2026-11-23");
assert.equal(data.nextMonday, "2026-12-07");
assert.equal(data.unfilled, false);
assert.equal(data.thisWeekShiftCount, 2);
assert.equal(data.lastWeekShiftCount, 4);
assert.equal(data.days.length, 7);
assert.deepEqual([data.days[0].label, data.days[0].open, data.days[0].close, data.days[0].closed], ["Mon 30", "09:00", "19:00", false]);
assert.deepEqual(data.days[0].text, ["1 on 9–13", "2 on 13–17", "1 on 17–19"]);
assert.deepEqual([data.days[6].closed, data.days[6].open, data.days[6].text], [true, null, []]);
assert.deepEqual(data.people.map((p) => [p.name, p.initials, p.hours, p.shifts.length, p.tone]), [
  ["Example Therapist", "ET", "8 h this week", 1, 0],
  ["Second Therapist", "ST", "6 h this week", 1, 1],
]);
const empty = buildRotaWeek({ monday: "2026-11-30", rotaOn: true, openingHours: HOURS, people: [], weekShifts: [], lastWeekShiftCount: 0, appts: [], treatments: [] });
assert.equal(empty.unfilled, true, "rota on and no shifts this week");
assert.equal(buildRotaWeek({ monday: "2026-11-30", rotaOn: false, openingHours: HOURS, people: [], weekShifts: [], lastWeekShiftCount: 0, appts: [], treatments: [] }).unfilled, false, "unfilled only matters while the rota is on");

console.log("rotaModel: all checks passed.");
