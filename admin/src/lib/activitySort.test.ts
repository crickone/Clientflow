// Run: npm test -- src/lib/activitySort.test.ts
import assert from "node:assert/strict";

import { bookingsDelta, joinProblems, sortActivity, type ActivityView } from "./activitySort";
import type { ActivityRow } from "./types";

const NOW = 1_000_000;

function row(id: number, name: string, over: Partial<ActivityRow> = {}): ActivityRow {
  return {
    tenantId: id,
    name,
    slug: name.toLowerCase(),
    setup: { done: 3, total: 5 },
    lastLoginAt: null,
    membersActive7d: null,
    bookings7d: null,
    bookingsPrev7d: null,
    leads7d: null,
    salesCents7d: null,
    aiCentsThisMonth: null,
    ...over,
  };
}

// --- bookingsDelta ---
assert.equal(bookingsDelta(row(1, "A", { bookings7d: 10, bookingsPrev7d: 4 })), 6);
assert.equal(bookingsDelta(row(1, "A", { bookings7d: 2, bookingsPrev7d: 5 })), -3);
assert.equal(bookingsDelta(row(1, "A", { bookings7d: 0, bookingsPrev7d: 0 })), 0);
assert.equal(bookingsDelta(row(1, "A", { bookings7d: null, bookingsPrev7d: 4 })), null);
assert.equal(bookingsDelta(row(1, "A", { bookings7d: 4, bookingsPrev7d: null })), null);

// --- joinProblems ---
const rows = [row(1, "Alpha"), row(2, "Beta"), row(3, "Gamma")];
const joined = joinProblems(
  rows,
  [
    { tenantId: 1, level: "warn" },
    { tenantId: 1, level: "bad" },
    { tenantId: 1, level: "warn" },
    { tenantId: 2, level: "warn" },
    { tenantId: 2, level: "bad", snoozedUntil: NOW + 1 }, // snoozed into the future: ignored
    { tenantId: 3, level: "bad", snoozedUntil: NOW - 1 }, // snooze over: counts
    { tenantId: null, level: "bad" }, // platform alert: belongs to no row
    { tenantId: 99, level: "bad" }, // unknown business: ignored
  ],
  NOW,
);
assert.equal(joined.length, 3);
assert.deepEqual(joined.map((v) => [v.row.tenantId, v.problems, v.worst]), [
  [1, 3, "bad"],
  [2, 1, "warn"],
  [3, 1, "bad"],
]);
assert.deepEqual(joinProblems([row(4, "Delta")], [], NOW).map((v) => [v.problems, v.worst]), [[0, null]]);
// No alerts feed: unknown, not zero, and unknown sorts last in both directions.
const unknown = joinProblems([row(5, "Echo"), row(6, "Foxtrot")], null, NOW);
assert.deepEqual(unknown.map((v) => v.problems), [null, null]);
const mixed: ActivityView[] = [unknown[0]!, { row: row(7, "Alpha"), problems: 2, worst: "bad" }];
assert.equal(sortActivity(mixed, "problems", "desc")[0]!.row.name, "Alpha");
assert.equal(sortActivity(mixed, "problems", "asc")[0]!.row.name, "Alpha");

// --- sortActivity ---
const v = (r: ActivityRow, problems = 0, worst: ActivityView["worst"] = null): ActivityView => ({ row: r, problems, worst });
const names = (xs: ActivityView[]) => xs.map((x) => x.row.name);

const views: ActivityView[] = [
  v(row(1, "Bravo", { lastLoginAt: 500, membersActive7d: 5, bookings7d: 9, leads7d: 2, salesCents7d: 100, aiCentsThisMonth: 30, setup: { done: 2, total: 4 } }), 2, "warn"),
  v(row(2, "alpha", { lastLoginAt: 900, membersActive7d: 0, bookings7d: 3, leads7d: 7, salesCents7d: 900, aiCentsThisMonth: 10, setup: { done: 4, total: 4 } }), 0, null),
  v(row(3, "Charlie"), 5, "bad"),
  v(row(4, "Delta", { lastLoginAt: 500, membersActive7d: 5, bookings7d: 1, leads7d: 2, salesCents7d: 100, aiCentsThisMonth: 30, setup: null }), 2, "bad"),
];

assert.deepEqual(names(sortActivity(views, "name", "asc")), ["alpha", "Bravo", "Charlie", "Delta"]);
assert.deepEqual(names(sortActivity(views, "name", "desc")), ["Delta", "Charlie", "Bravo", "alpha"]);
assert.deepEqual(names(sortActivity(views, "problems", "desc")), ["Charlie", "Bravo", "Delta", "alpha"], "ties by name");
assert.deepEqual(names(sortActivity(views, "problems", "asc")), ["alpha", "Bravo", "Delta", "Charlie"]);
// nulls last in both directions
assert.deepEqual(names(sortActivity(views, "lastLogin", "desc")), ["alpha", "Bravo", "Delta", "Charlie"]);
assert.deepEqual(names(sortActivity(views, "lastLogin", "asc")), ["Bravo", "Delta", "alpha", "Charlie"]);
assert.deepEqual(names(sortActivity(views, "membersActive", "desc")), ["Bravo", "Delta", "alpha", "Charlie"], "0 is a value, not null");
assert.deepEqual(names(sortActivity(views, "membersActive", "asc")), ["alpha", "Bravo", "Delta", "Charlie"]);
assert.deepEqual(names(sortActivity(views, "bookings", "desc")), ["Bravo", "alpha", "Delta", "Charlie"]);
assert.deepEqual(names(sortActivity(views, "bookings", "asc")), ["Delta", "alpha", "Bravo", "Charlie"]);
assert.deepEqual(names(sortActivity(views, "leads", "desc")), ["alpha", "Bravo", "Delta", "Charlie"]);
assert.deepEqual(names(sortActivity(views, "sales", "desc")), ["alpha", "Bravo", "Delta", "Charlie"]);
assert.deepEqual(names(sortActivity(views, "sales", "asc")), ["Bravo", "Delta", "alpha", "Charlie"]);
assert.deepEqual(names(sortActivity(views, "ai", "desc")), ["Bravo", "Delta", "alpha", "Charlie"]);
// setup sorts by fraction done; no setup data is null
assert.deepEqual(names(sortActivity(views, "setup", "desc")), ["alpha", "Charlie", "Bravo", "Delta"]);
assert.deepEqual(names(sortActivity(views, "setup", "asc")), ["Bravo", "Charlie", "alpha", "Delta"], "no setup data sorts last");
// does not mutate its input
const before = names(views);
sortActivity(views, "ai", "asc");
assert.deepEqual(names(views), before);

console.log("activitySort ok");
