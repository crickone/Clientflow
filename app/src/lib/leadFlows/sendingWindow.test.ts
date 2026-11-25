// Run: npm test -- src/lib/leadFlows/sendingWindow.test.ts
//
// Sending-window maths, Irish time: Mon-Sat 09:00-18:00 (Optimal Health),
// the next window start for anything outside it, both clock changes, and
// today's behaviour when a business has saved no hours.
import assert from "node:assert/strict";

import {
  addDays,
  endOfLocalDay,
  fitToWindow,
  morningOf,
  nextSendTime,
  todayIn,
  weekdayOf,
  zonedTimeToUtc,
  type SendingWindow,
} from "./sendingWindow";

let n = 0;
function eq(actual: number | string, expected: number | string, name: string) {
  assert.equal(actual, expected, name);
  n++;
}
const iso = (s: string) => Date.parse(s);
const OH: SendingWindow = { days: [1, 2, 3, 4, 5, 6], start: "09:00", end: "18:00" };

// Winter (Irish time = UTC). 2026-11-25 is a Wednesday.
eq(nextSendTime(iso("2026-11-25T10:00:00Z"), OH), iso("2026-11-25T10:00:00Z"), "inside the window: now");
eq(nextSendTime(iso("2026-11-25T08:15:00Z"), OH), iso("2026-11-25T09:00:00Z"), "before 9: that morning at 9");
eq(nextSendTime(iso("2026-11-25T18:00:00Z"), OH), iso("2026-11-26T09:00:00Z"), "the end time is exclusive");
eq(nextSendTime(iso("2026-11-25T19:00:00Z"), OH), iso("2026-11-26T09:00:00Z"), "evening: next morning");
eq(nextSendTime(iso("2026-11-28T18:30:00Z"), OH), iso("2026-11-30T09:00:00Z"), "Saturday evening: Monday at 9");
eq(nextSendTime(iso("2026-11-29T12:00:00Z"), OH), iso("2026-11-30T09:00:00Z"), "Sunday: Monday at 9");

// Summer (Irish time = UTC+1).
eq(nextSendTime(iso("2026-07-01T07:30:00Z"), OH), iso("2026-07-01T08:00:00Z"), "summer 08:30 Irish waits for 09:00 Irish");
eq(zonedTimeToUtc("2026-07-01", "09:00"), iso("2026-07-01T08:00:00Z"), "09:00 Irish in summer is 08:00 UTC");

// Clocks go forward Sunday 2026-03-29; back Sunday 2026-10-25.
eq(nextSendTime(iso("2026-03-28T19:00:00Z"), OH), iso("2026-03-30T08:00:00Z"), "across the spring change: Monday 09:00 summer time");
eq(nextSendTime(iso("2026-10-24T17:30:00Z"), OH), iso("2026-10-26T09:00:00Z"), "across the autumn change: Monday 09:00 winter time");

// No hours saved yet: today's behaviour.
eq(fitToWindow(iso("2026-11-11T02:30:00Z"), "email", null), iso("2026-11-11T02:30:00Z"), "no hours set: email goes any time");
eq(fitToWindow(iso("2026-11-11T02:30:00Z"), "whatsapp", null), iso("2026-11-11T09:00:00Z"), "no hours set: WhatsApp waits for 9");
eq(fitToWindow(iso("2026-11-11T22:15:00Z"), "whatsapp", null), iso("2026-11-12T09:00:00Z"), "no hours set: WhatsApp after 9pm waits for next day");
eq(fitToWindow(iso("2026-11-29T12:00:00Z"), "whatsapp", null), iso("2026-11-29T12:00:00Z"), "no hours set: Sunday is a sending day");
// Hours saved: every channel.
eq(fitToWindow(iso("2026-11-25T19:00:00Z"), "email", OH), iso("2026-11-26T09:00:00Z"), "hours set: email waits too");

// Helpers.
eq(morningOf("2026-12-02", OH), iso("2026-12-02T09:00:00Z"), "the morning of a day is its start time");
eq(morningOf("2026-12-02", null), iso("2026-12-02T09:00:00Z"), "no hours set: 9am");
eq(endOfLocalDay("2026-07-01"), iso("2026-07-01T22:59:59.999Z"), "end of an Irish summer day");
eq(addDays("2026-11-30", 1), "2026-12-01", "adding a day crosses a month");
eq(weekdayOf("2026-11-29"), 0, "2026-11-29 is a Sunday");
eq(todayIn(iso("2026-07-01T23:30:00Z")), "2026-07-02", "half eleven UTC in summer is the next Irish day");
eq(nextSendTime(iso("2026-11-25T19:00:00Z"), { days: [], start: "09:00", end: "18:00" }), iso("2026-11-25T19:00:00Z"), "no days at all never drops a message");

console.log(`sendingWindow: ${n} checks passed.`);
