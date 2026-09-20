/**
 * Pure unit tests for free-slot arithmetic. No I/O, no DB.
 * Run: npm test -- src/lib/scheduling/freeSlots.test.ts
 */
import assert from "node:assert/strict";

import { computeFreeSlots, spreadSlots, hmToMin, minToHm, type DayAvailability } from "./freeSlots";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed++;
}

const day = (date: string, over: Partial<DayAvailability> = {}): DayAvailability => ({
  date,
  closed: false,
  openMin: hmToMin("09:00"),
  closeMin: hmToMin("17:00"),
  busy: [],
  ...over,
});

const base = {
  durationMinutes: 20,
  bufferMinutes: 0,
  granularityMinutes: 30,
  therapyIds: [1],
  earliest: { date: "2026-10-05", min: 0 },
  limit: 100,
};

// ---------------------------------------------------------------- time maths
check("hmToMin", hmToMin("18:30"), 1110);
check("minToHm", minToHm(1110), "18:30");
check("minToHm pads", minToHm(65), "01:05");

// ------------------------------------------------------------- the empty day
const empty = computeFreeSlots({ ...base, days: [day("2026-10-05")] });
check("empty 09:00-17:00 day, 20min on a 30min grid", empty.length, 16);
check("first slot is opening time", empty[0], { date: "2026-10-05", startTime: "09:00", endTime: "09:20" });
check("last slot ends by closing", empty[empty.length - 1], { date: "2026-10-05", startTime: "16:30", endTime: "16:50" });

// A slot that would run past closing is never offered.
check(
  "nothing overruns closing time",
  computeFreeSlots({ ...base, durationMinutes: 45, days: [day("2026-10-05", { closeMin: hmToMin("10:00") })] }),
  [{ date: "2026-10-05", startTime: "09:00", endTime: "09:45" }],
);

check("closed days contribute nothing", computeFreeSlots({ ...base, days: [day("2026-10-05", { closed: true })] }), []);

// ------------------------------------------------------------------- clashes
const booked = day("2026-10-05", {
  openMin: hmToMin("09:00"),
  closeMin: hmToMin("11:00"),
  busy: [{ startMin: hmToMin("09:30"), endMin: hmToMin("10:00"), therapyIds: [1] }],
});
check(
  "a booking sharing a therapy blocks its own span only",
  computeFreeSlots({ ...base, days: [booked] }).map((s) => s.startTime),
  ["09:00", "10:00", "10:30"],
);

check(
  "a booking for a DIFFERENT therapy does not block",
  computeFreeSlots({
    ...base,
    days: [day("2026-10-05", {
      closeMin: hmToMin("11:00"),
      busy: [{ startMin: hmToMin("09:30"), endMin: hmToMin("10:00"), therapyIds: [99] }],
    })],
  }).map((s) => s.startTime),
  ["09:00", "09:30", "10:00", "10:30"],
);

check(
  "a block-out (no therapies) blocks everything",
  computeFreeSlots({
    ...base,
    days: [day("2026-10-05", {
      closeMin: hmToMin("11:00"),
      busy: [{ startMin: hmToMin("09:30"), endMin: hmToMin("10:00"), therapyIds: [] }],
    })],
  }).map((s) => s.startTime),
  ["09:00", "10:00", "10:30"],
);

// Half-open spans: a 09:00-09:20 slot does NOT clash with a 09:20 booking.
check(
  "touching spans do not overlap",
  computeFreeSlots({
    ...base,
    days: [day("2026-10-05", {
      closeMin: hmToMin("10:00"),
      busy: [{ startMin: hmToMin("09:20"), endMin: hmToMin("09:40"), therapyIds: [1] }],
    })],
  }).map((s) => s.startTime),
  ["09:00"],
);

// ------------------------------------------------------------------- buffers
check(
  "buffer pushes a slot away from an existing booking",
  computeFreeSlots({
    ...base,
    bufferMinutes: 15,
    days: [day("2026-10-05", {
      closeMin: hmToMin("11:00"),
      busy: [{ startMin: hmToMin("09:30"), endMin: hmToMin("10:00"), therapyIds: [1] }],
    })],
  }).map((s) => s.startTime),
  ["10:30"],
);

// ------------------------------------------------------------- the lead time
check(
  "nothing before `earliest` on the same day",
  computeFreeSlots({
    ...base,
    earliest: { date: "2026-10-05", min: hmToMin("14:00") },
    days: [day("2026-10-05")],
  })[0].startTime,
  "14:00",
);

check(
  "an earliest that is off-grid rounds UP, never back",
  computeFreeSlots({
    ...base,
    earliest: { date: "2026-10-05", min: hmToMin("14:07") },
    days: [day("2026-10-05")],
  })[0].startTime,
  "14:30",
);

check(
  "days before `earliest` are skipped entirely",
  computeFreeSlots({
    ...base,
    earliest: { date: "2026-10-06", min: 0 },
    days: [day("2026-10-05"), day("2026-10-06")],
  }).every((s) => s.date === "2026-10-06"),
  true,
);

// ---------------------------------------------------------------- the limits
check("limit caps the total", computeFreeSlots({ ...base, limit: 3, days: [day("2026-10-05")] }).length, 3);
check(
  "maxPerDay spreads across days",
  computeFreeSlots({ ...base, maxPerDay: 2, days: [day("2026-10-05"), day("2026-10-06")] }).map((s) => `${s.date} ${s.startTime}`),
  ["2026-10-05 09:00", "2026-10-05 09:30", "2026-10-06 09:00", "2026-10-06 09:30"],
);
check("days come back in date order", computeFreeSlots({ ...base, days: [day("2026-10-07"), day("2026-10-05")] })[0].date, "2026-10-05");

// Guards: nonsense in, empty out, rather than an infinite loop.
check("zero duration yields nothing", computeFreeSlots({ ...base, durationMinutes: 0, days: [day("2026-10-05")] }), []);
check("zero granularity yields nothing", computeFreeSlots({ ...base, granularityMinutes: 0, days: [day("2026-10-05")] }), []);
check("zero limit yields nothing", computeFreeSlots({ ...base, limit: 0, days: [day("2026-10-05")] }), []);

// ------------------------------------------------------------------- spread
const manySameDay = computeFreeSlots({ ...base, days: [day("2026-10-05")] });
check("spread on one day still returns the count", spreadSlots(manySameDay, 2).length, 2);
check(
  "spread prefers one per day over three in one evening",
  spreadSlots(
    computeFreeSlots({ ...base, days: [day("2026-10-05"), day("2026-10-06"), day("2026-10-07")] }),
    3,
  ).map((s) => s.date),
  ["2026-10-05", "2026-10-06", "2026-10-07"],
);
check("spread of an empty list is empty", spreadSlots([], 2), []);
check("spread never invents slots", spreadSlots(manySameDay.slice(0, 1), 3).length, 1);

console.log(`freeSlots: ${passed} checks passed.`);
