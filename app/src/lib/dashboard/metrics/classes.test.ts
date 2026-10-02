// Run: npm test -- src/lib/dashboard/metrics/classes.test.ts
import assert from "node:assert/strict";
import { fillByGroup, fillBySlotGrid, instructorRows, quietMembers } from "./classes";

const S = (o: Partial<{ date: string; startTime: string; name: string; booked: number; capacity: number; attended: number; noShow: number; instructor: string | null }>) => ({
  date: "2026-10-05",
  startTime: "18:00",
  name: "HIIT",
  booked: 0,
  capacity: 10,
  attended: 0,
  noShow: 0,
  instructor: null as string | null,
  ...o,
});

// fillByGroup: sum booked over sum capacity, sorted by fill, top n, zero-capacity skipped.
const rows = fillByGroup(
  [
    S({ name: "HIIT", booked: 10, capacity: 10 }),
    S({ name: "HIIT", booked: 5, capacity: 10 }),
    S({ name: "Yoga", booked: 2, capacity: 20 }),
    S({ name: "Open gym", booked: 0, capacity: 0 }),
  ].map((s) => ({ key: s.name, booked: s.booked, capacity: s.capacity })),
  8,
);
assert.deepEqual(rows, [
  { label: "HIIT", booked: 15, capacity: 20, pct: 75 },
  { label: "Yoga", booked: 2, capacity: 20, pct: 10 },
]);
assert.equal(fillByGroup(Array.from({ length: 12 }, (_, i) => ({ key: `c${i}`, booked: 1, capacity: 2 })), 8).length, 8);

// fillBySlotGrid: 2026-10-05 is a Monday, 2026-10-06 a Tuesday.
const grid = fillBySlotGrid([
  S({ date: "2026-10-05", startTime: "18:00", booked: 10, capacity: 10 }),
  S({ date: "2026-10-12", startTime: "18:30", booked: 5, capacity: 10 }),
  S({ date: "2026-10-06", startTime: "07:00", booked: 1, capacity: 4 }),
  S({ date: "2026-10-06", startTime: "07:00", booked: 0, capacity: 0 }),
]);
assert.equal(grid.length, 7);
assert.equal(grid[0][18], 75, "average of 100 and 50");
assert.equal(grid[1][7], 25, "zero-capacity session ignored");
assert.equal(grid[2][7], 0);

// instructorRows
const ins = instructorRows([
  S({ instructor: "Sam", booked: 10, capacity: 10, attended: 8, noShow: 2 }),
  S({ instructor: "Sam", booked: 5, capacity: 10, attended: 5, noShow: 0 }),
  S({ instructor: null, booked: 4, capacity: 8, attended: 0, noShow: 0 }),
  S({ instructor: "  ", booked: 4, capacity: 8, attended: 0, noShow: 0 }),
]);
assert.deepEqual(ins, [
  { name: "Sam", classes: 2, fillPct: 75, attendancePct: 86.7 },
  { name: "Unassigned", classes: 2, fillPct: 50, attendancePct: null },
]);

// quietMembers
const now = Date.UTC(2026, 9, 2);
const D = 86_400_000;
const q = quietMembers(
  [
    { id: 1, name: "Recent", lastMs: now - 5 * D },
    { id: 2, name: "Old", lastMs: now - 50 * D },
    { id: 3, name: "Never", lastMs: null },
    { id: 4, name: "Older", lastMs: now - 90 * D },
  ],
  now,
  30,
  10,
);
assert.deepEqual(q.map((m) => m.name), ["Never", "Older", "Old"], "never first, then oldest");

console.log("classes.test.ts: ok");
