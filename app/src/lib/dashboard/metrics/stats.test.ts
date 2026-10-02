import assert from "node:assert/strict";
import { bucketIndex, firstResponseTimes, median, pct, seriesBuckets, timeInStage, velocityDays, weekdayHourGrid } from "./stats";

const H = 3_600_000, D = 86_400_000;

assert.equal(median([]), null);
assert.equal(median([5]), 5);
assert.equal(median([1, 9, 3]), 3);
assert.equal(median([1, 2, 3, 4]), 2.5);
assert.equal(pct(1, 3), 33.3);
assert.equal(pct(0, 0), null);

const from = Date.UTC(2026, 8, 26), to = Date.UTC(2026, 9, 3);
const days = seriesBuckets(from, to);
assert.equal(days.length, 7);
assert.equal(days[0].key, "2026-09-26");
assert.equal(days[6].label, "2 Oct");
assert.equal(bucketIndex(days, Date.UTC(2026, 8, 28, 13)), 2);
assert.equal(bucketIndex(days, to), -1);
const weeks = seriesBuckets(Date.UTC(2026, 6, 5), Date.UTC(2026, 9, 3));
assert.equal(weeks.length, 13);
assert.match(weeks[0].label, /^w\/c /);

// 2026-10-05 is a Monday. 09:30 UTC = 10:30 Dublin (IST).
const grid = weekdayHourGrid([Date.UTC(2026, 9, 5, 9, 30), Date.UTC(2026, 9, 5, 9, 45), Date.UTC(2026, 9, 11, 23, 0)], "Europe/Dublin");
assert.equal(grid.length, 7);
assert.equal(grid[0][10], 2, "Monday 10:00 Dublin");
assert.equal(grid[0][0], 1, "Sunday 23:00 UTC is Monday 00:00 Dublin");

const t0 = Date.UTC(2026, 9, 1, 9);
const fr = firstResponseTimes([
  { convo: "a", direction: "inbound", atMs: t0, channel: "whatsapp" },
  { convo: "a", direction: "inbound", atMs: t0 + 5 * 60_000, channel: "whatsapp" },
  { convo: "a", direction: "outbound", atMs: t0 + 30 * 60_000, channel: "whatsapp" },
  { convo: "b", direction: "inbound", atMs: t0, channel: "email" },
  { convo: "c", direction: "outbound", atMs: t0, channel: "sms" },
  { convo: "c", direction: "inbound", atMs: t0 + H, channel: "sms" },
  { convo: "c", direction: "outbound", atMs: t0 + 3 * H, channel: "sms" },
]);
assert.deepEqual(fr.map((r) => [r.channel, r.minutes]), [["whatsapp", 30], ["sms", 120]], "run start answered; b unanswered omitted");

const ev = [
  { leadId: 1, fromStageId: null, toStageId: 10, atMs: t0 },
  { leadId: 1, fromStageId: 10, toStageId: 11, atMs: t0 + 2 * D },
  { leadId: 1, fromStageId: 11, toStageId: 12, atMs: t0 + 5 * D },
  { leadId: 2, fromStageId: null, toStageId: 10, atMs: t0 },
  { leadId: 2, fromStageId: 10, toStageId: 12, atMs: t0 + 1 * D },
  { leadId: 3, fromStageId: 10, toStageId: 12, atMs: t0 + D },
];
const tis = timeInStage(ev);
assert.deepEqual(tis.get(10), [2 * D, 1 * D]);
assert.deepEqual(tis.get(11), [3 * D]);
assert.equal(tis.get(12), undefined, "still in stage 12: not counted");
assert.deepEqual(velocityDays(ev, new Set([12]), t0, t0 + 10 * D).sort(), [1, 5], "lead 3 has no creation event");
assert.deepEqual(velocityDays(ev, new Set([12]), t0 + 2 * D, t0 + 10 * D), [5], "won move must fall in range");

console.log("stats.test.ts: ok");

import { addDaysIso, dublinIso, weekBounds } from "./stats";
// 2026-10-04 is a Sunday: its week started Monday the 28th of September.
assert.deepEqual(weekBounds("2026-10-04"), { mon: "2026-09-28", sun: "2026-10-04" });
assert.deepEqual(weekBounds("2026-10-05"), { mon: "2026-10-05", sun: "2026-10-11" });
assert.equal(addDaysIso("2026-12-30", 3), "2027-01-02");
assert.equal(dublinIso(Date.UTC(2026, 6, 15, 23, 30)), "2026-07-16", "23:30 UTC in summer is already tomorrow in Dublin");
assert.equal(dublinIso(Date.UTC(2026, 0, 15, 23, 30)), "2026-01-15");
console.log("stats.test.ts (dates): ok");
