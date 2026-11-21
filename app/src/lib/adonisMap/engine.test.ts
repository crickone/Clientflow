// Run: npm test -- src/lib/adonisMap/engine.test.ts
import assert from "node:assert/strict";

import {
  addDays, bucketKey, clampLimit, datePushdown, dublinDate, dublinDateTime, filterRows, groupRows, pick, sortRows,
  validateWhere, weekStart, weekdayName,
} from "./engine";
import { TYPE_DEFS } from "./schema";
import { MapError, type FieldCondition, type Row, type TypeName } from "./types";

const ALL: TypeName[] = ["Person", "Booking", "Class", "Membership", "Package", "Order", "Conversation"];
const B = TYPE_DEFS.Booking;
const P = TYPE_DEFS.Person;
const throwsMap = (fn: () => unknown, re: RegExp) =>
  assert.throws(fn, (e: unknown) => e instanceof MapError && re.test(e.message), `expected MapError matching ${re}`);

// ── validation ──
throwsMap(() => validateWhere(P, [{ field: "shoeSize", op: "eq", value: 1 }], ALL), /Unknown field "shoeSize" on Person\. Fields: name, firstName/);
throwsMap(() => validateWhere(P, [{ field: "name", op: "gt", value: "a" }], ALL), /takes ops: eq, ne, in, contains, isNull/);
throwsMap(() => validateWhere(P, [{ field: "leadScore", op: "gt", value: "70" }], ALL), /takes a number/);
throwsMap(() => validateWhere(P, [{ field: "stage", op: "eq", value: "vip" }], ALL), /one of: lead, member, lapsed, client/);
throwsMap(() => validateWhere(B, [{ field: "date", op: "gte", value: "21/11/2026" }], ALL), /a date like 2026-11-21/);
throwsMap(() => validateWhere(P, [{ link: "friends", exists: true }], ALL), /Unknown link "friends" on Person\. Links: bookings/);
throwsMap(() => validateWhere(P, [{ link: "bookings", exists: true, where: [{ link: "class", exists: true }] }], ALL), /can't contain another link/);
throwsMap(() => validateWhere(P, [{ link: "conversations", exists: true }], ["Person", "Order"]), /Unknown link "conversations"/);
throwsMap(() => validateWhere(P, [{ field: "name", op: "in", value: [] }], ALL), /a list of 1 to 100 values/);
throwsMap(() => validateWhere(P, [{ link: "bookings" }], ALL), /needs exists: true or false/);
throwsMap(() => validateWhere(P, "stage = lapsed", ALL), /where must be a list/);
assert.deepEqual(validateWhere(P, undefined, ALL), []);

// ── matching ──
const people: Row[] = [
  { id: "c:1", name: "Niamh Byrne", leadScore: 64, stage: "member", lastContactedAt: "2026-11-19 10:15" },
  { id: "c:2", name: "Aoife Kelly", leadScore: 82, stage: "lapsed", lastContactedAt: null },
  { id: "l:3", name: "Sean Byrne", leadScore: null, stage: "lead", lastContactedAt: "2026-11-01 09:00" },
];
const w = (where: unknown) => validateWhere(P, where, ALL) as FieldCondition[];
const ids = (rows: Row[]) => rows.map((r) => r.id);
assert.deepEqual(ids(filterRows(P, people, w([{ field: "stage", op: "eq", value: "lapsed" }, { field: "leadScore", op: "gt", value: 70 }]))), ["c:2"]);
assert.deepEqual(ids(filterRows(P, people, w([{ field: "name", op: "contains", value: "BYRNE" }]))), ["c:1", "l:3"], "contains ignores case");
assert.deepEqual(ids(filterRows(P, people, w([{ field: "name", op: "eq", value: "niamh byrne" }]))), ["c:1"], "text eq ignores case");
assert.deepEqual(ids(filterRows(P, people, w([{ field: "leadScore", op: "isNull", value: true }]))), ["l:3"]);
assert.deepEqual(ids(filterRows(P, people, w([{ field: "leadScore", op: "ne", value: 64 }]))), ["c:2", "l:3"], "ne keeps nulls");
assert.deepEqual(ids(filterRows(P, people, w([{ field: "lastContactedAt", op: "eq", value: "2026-11-19" }]))), ["c:1"], "a date matches a datetime by its day");
assert.deepEqual(ids(filterRows(P, people, w([{ field: "lastContactedAt", op: "lte", value: "2026-11-19" }]))), ["c:1", "l:3"], "lte a date includes that whole day");
assert.deepEqual(ids(filterRows(P, people, w([{ field: "leadScore", op: "between", value: [60, 80] }]))), ["c:1"]);
assert.deepEqual(ids(filterRows(P, people, w([{ field: "stage", op: "in", value: ["lead", "lapsed"] }]))), ["c:2", "l:3"]);

// ── sorting: nulls last both ways ──
assert.deepEqual(ids(sortRows(P, people, { field: "leadScore", dir: "desc" })), ["c:2", "c:1", "l:3"]);
assert.deepEqual(ids(sortRows(P, people, { field: "leadScore", dir: "asc" })), ["c:1", "c:2", "l:3"]);
assert.deepEqual(ids(sortRows(P, people, undefined)), ["c:1", "c:2", "l:3"]);
throwsMap(() => sortRows(P, people, { field: "nope" }), /Unknown field "nope"/);

// ── pick and limits ──
assert.deepEqual(pick(P, people[0], ["name"]), { id: "c:1", name: "Niamh Byrne" });
assert.equal(pick(P, people[0], undefined), people[0]);
throwsMap(() => pick(P, people[0], ["shoe"]), /Unknown field "shoe"/);
assert.equal(clampLimit(undefined, 20, 50), 20);
assert.equal(clampLimit(500, 20, 50), 50);
assert.equal(clampLimit(-3, 20, 50), 20);
assert.equal(clampLimit(7, 20, 50), 7);

// ── dates ──
assert.equal(addDays("2026-11-21", -30), "2026-10-22");
assert.equal(addDays("2026-03-01", -1), "2026-02-28");
assert.equal(weekStart("2026-11-21"), "2026-11-16", "21 Nov 2026 is a Saturday; its week starts Monday 16th");
assert.equal(weekStart("2026-11-16"), "2026-11-16");
assert.equal(weekStart("2026-11-22"), "2026-11-16", "Sunday belongs to the week before");
assert.equal(weekdayName("2026-11-21"), "Sat");
assert.equal(bucketKey("2026-11-21 19:00", "hour"), "19");
assert.equal(bucketKey("2026-11-21", "month"), "2026-11");
assert.equal(bucketKey("2026-11-21 19:00", "week"), "2026-11-16");
assert.equal(dublinDate(Date.parse("2026-10-31T23:30:00Z")), "2026-10-31", "winter: Dublin is UTC");
assert.equal(dublinDate(Date.parse("2026-07-31T23:30:00Z")), "2026-08-01", "summer: Dublin is UTC+1");
assert.equal(dublinDateTime(Date.parse("2026-07-31T23:30:00Z")), "2026-08-01 00:30");

// ── pushdown ──
const bw = validateWhere(B, [
  { field: "date", op: "gte", value: "2026-11-01" },
  { field: "date", op: "lt", value: "2026-11-08" },
  { field: "status", op: "eq", value: "attended" },
], ALL);
assert.deepEqual(datePushdown(B, bw), { from: "2026-11-01", to: "2026-11-08" });
assert.deepEqual(datePushdown(B, validateWhere(B, [{ field: "date", op: "eq", value: "2026-11-03" }], ALL)), { from: "2026-11-03", to: "2026-11-03" });
assert.deepEqual(datePushdown(P, []), {});

// ── grouping ──
const bookings: Row[] = [
  { id: "s:1", date: "2026-11-09", startsAt: "2026-11-09 19:00", status: "attended", priceEur: null, name: "HIIT" },
  { id: "s:2", date: "2026-11-10", startsAt: "2026-11-10 19:00", status: "attended", priceEur: null, name: "HIIT" },
  { id: "a:3", date: "2026-11-17", startsAt: "2026-11-17 10:00", status: "booked", priceEur: 60, name: "HBOT" },
];
assert.deepEqual(groupRows(B, bookings, { field: "date", by: "week" }, undefined), {
  total: 3,
  groups: [{ key: "2026-11-09", count: 2 }, { key: "2026-11-16", count: 1 }],
});
assert.deepEqual(groupRows(B, bookings, "name", "priceEur"), {
  total: 3,
  sum: 60,
  groups: [{ key: "HIIT", count: 2, sum: 0 }, { key: "HBOT", count: 1, sum: 60 }],
});
assert.deepEqual(groupRows(B, bookings, { field: "startsAt", by: "hour" }, undefined).groups, [{ key: "10", count: 1 }, { key: "19", count: 2 }]);
assert.deepEqual(groupRows(B, bookings, undefined, undefined), { total: 3, groups: [] });
throwsMap(() => groupRows(B, bookings, { field: "date", by: "hour" }, undefined), /hour needs a datetime field/);
throwsMap(() => groupRows(B, bookings, "name", "name"), /sum takes a number field/);
throwsMap(() => groupRows(B, bookings, { field: "name", by: "week" }, undefined), /needs a date field/);

console.log("engine.test.ts: all assertions passed");
