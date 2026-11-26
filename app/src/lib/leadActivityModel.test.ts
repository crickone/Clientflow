// Run: npm test -- src/lib/leadActivityModel.test.ts
import assert from "node:assert/strict";
import { buildFeed, dayLabel, paymentLabel, withoutAdNumber, type ActivityEvent } from "./leadActivityModel";

const NOW = Date.parse("2026-11-26T12:00:00Z");
const at = (iso: string) => Date.parse(iso);
const ev = (key: string, kind: ActivityEvent["kind"], iso: string): ActivityEvent => ({ key, kind, at: at(iso), title: key });
const events = [
  ev("came", "came_in", "2026-11-25T21:51:00Z"),
  ev("buy1", "purchase", "2026-11-25T21:51:30Z"),
  ev("buy2", "purchase", "2026-11-25T21:52:00Z"),
  ev("call", "call", "2026-11-26T09:00:00Z"),
  ev("flow", "flow_message", "2026-11-26T09:30:00Z"),
];
const messages = [
  { id: 1, at: at("2026-11-26T10:14:00Z") },
  { id: 2, at: at("2026-11-25T21:52:00Z") },
];

const all = buildFeed(events, messages, "all", NOW);
assert.deepEqual(all.map((d) => d.label), ["Yesterday", "Today"], "grouped by Dublin day, oldest first");
assert.deepEqual(
  all[0].items.map((i) => (i.type === "event" ? i.event.key : `m${i.message.id}`)),
  ["came", "buy1", "buy2", "m2"],
  "in time order, an event before a message at the same moment",
);
assert.deepEqual(all[1].items.map((i) => (i.type === "event" ? i.event.key : `m${i.message.id}`)), ["call", "flow", "m1"]);

const msgs = buildFeed(events, messages, "messages", NOW).flatMap((d) => d.items);
assert.deepEqual(msgs.map((i) => (i.type === "event" ? i.event.key : `m${i.message.id}`)), ["m2", "flow", "m1"], "messages include what the flows sent");
assert.deepEqual(buildFeed(events, messages, "calls", NOW).flatMap((d) => d.items).length, 1);
assert.deepEqual(buildFeed(events, messages, "purchases", NOW).flatMap((d) => d.items).length, 2);
assert.deepEqual(buildFeed([], [], "all", NOW), [], "nothing, no days");

// Late evening in Dublin is still that day (UTC+0 in winter, UTC+1 in summer).
assert.equal(dayLabel(at("2026-07-10T23:30:00Z"), NOW), "Saturday 11 July", "summer time moves 23:30 UTC into the next day");
assert.equal(dayLabel(at("2025-03-02T10:00:00Z"), NOW), "Sunday 2 March 2025", "another year names the year");

assert.equal(paymentLabel("Online: Black Friday: Sports massage (Stripe pi_3Ufo7O0ABxjAJ).", null), "Black Friday: Sports massage");
assert.equal(paymentLabel("Online: Black Friday: Deep tissue massage (Stripe pi_x)", null), "Black Friday: Deep tissue massage");
assert.equal(paymentLabel("anything", "Massage x 5"), "Massage x 5", "a package name wins");
assert.equal(paymentLabel(null, null), null);

assert.equal(withoutAdNumber("Facebook ad (120250788598410442)"), "Facebook ad");
assert.equal(withoutAdNumber("Facebook ad (black-friday)"), "Facebook ad (black-friday)", "a readable campaign name stays");

console.log("leadActivityModel: 16 checks passed.");
