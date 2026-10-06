// Run: npm test -- src/lib/dashboard/briefItems.test.ts
import assert from "node:assert/strict";
import { parseBriefItems } from "./briefItems";

const reply = 'Here:\n[{"kind":"leads","title":"10 new leads","detail":"Not contacted yet."},{"kind":"leads","title":"dup","detail":""},{"kind":"hack","title":"x"},{"kind":"campaign","title":"Bank holiday in 20 days","detail":"Autumn Reset is ready."},{"kind":"schedule","title":"Empty week","detail":"No classes booked."},{"kind":"money","title":"fourth","detail":""}]';
const items = parseBriefItems(reply, "timetable");
assert.equal(items.length, 3, "at most three");
assert.deepEqual(items.map((i) => i.kind), ["leads", "campaign", "schedule"], "valid kinds, once each, in order");
assert.equal(items[0].href, "/leads", "links come from the kind");
assert.equal(items[2].href, "/timetable", "schedule follows the scheduling mode");
assert.equal(parseBriefItems("[]", "appointments").length, 0, "a quiet day is an empty list");
assert.equal(parseBriefItems("not json", "appointments").length, 0, "garbage is empty");
assert.equal(parseBriefItems('[{"kind":"schedule","title":"Today"}]', "appointments")[0].href, "/appointments");
console.log("briefItems: all checks passed.");
