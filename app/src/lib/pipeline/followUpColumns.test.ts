// Run: npm test -- src/lib/pipeline/followUpColumns.test.ts
//
// Where the five follow-up columns go on a board, and the one advancement
// rule they add: a lead in one is pulled out by any forward funnel event.
import assert from "node:assert/strict";

import { DEFAULT_STAGES, shouldAdvance, type StageRole } from "./roles";
import { FOLLOW_UP_KEYS, isFollowUpKey, planFollowUpColumns, type ColumnSlot } from "./followUpColumns";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const defaults: ColumnSlot[] = DEFAULT_STAGES.map((s, i) => ({ id: i + 1, position: s.position, role: s.role, systemKey: null }));
const plan = planFollowUpColumns(defaults);
ok(plan.inserts.length === 5, "a default board gets all five");
const order = [
  ...defaults.map((s) => ({ name: DEFAULT_STAGES[s.id - 1].name, position: plan.moves.find((m) => m.id === s.id)?.position ?? s.position })),
  ...plan.inserts.map((i) => ({ name: i.name, position: i.position })),
]
  .sort((a, b) => a.position - b.position)
  .map((x) => x.name);
assert.deepEqual(order, [
  "New lead",
  "Hot lead",
  "No answer",
  "Call back later",
  "Thinking about it",
  "Consultation booked",
  "No-show",
  "Attended",
  "Sale",
  "Repeat customer",
  "Long-term nurture",
  "Message undelivered",
  "Lapsed",
  "Lost",
]);
n++;
const positions = [...plan.inserts.map((i) => i.position), ...defaults.map((s) => plan.moves.find((m) => m.id === s.id)?.position ?? s.position)].sort((a, b) => a - b);
assert.deepEqual(positions, [...Array(14).keys()], "positions are 0..13 with no gaps or clashes");
n++;

const full: ColumnSlot[] = [...defaults, ...FOLLOW_UP_KEYS.map((k, i) => ({ id: 100 + i, position: 20 + i, role: null, systemKey: k }))];
const none = planFollowUpColumns(full);
ok(none.inserts.length === 0 && none.moves.length === 0, "a board that has them all is left alone");

const partial = planFollowUpColumns([...defaults, { id: 50, position: 9, role: null, systemKey: "nurture" }]);
ok(partial.inserts.length === 4 && !partial.inserts.some((i) => i.key === "nurture"), "only the missing ones are added");

const bare = planFollowUpColumns([
  { id: 1, position: 0, role: null, systemKey: null },
  { id: 2, position: 1, role: null, systemKey: null },
]);
ok(bare.inserts.find((i) => i.key === "no_answer")?.position === 1, "no new or engaged column: the early ones go after the first column, never before the entry column");
ok(bare.inserts.every((i) => i.position !== 0) && !bare.moves.some((m) => m.id === 1), "the first column stays first");
ok(bare.inserts.find((i) => i.key === "undelivered")?.position === 6, "no lapsed or lost column: the late ones go last");

ok(isFollowUpKey("thinking") && !isFollowUpKey("booked"), "isFollowUpKey");

// Advancement out of a follow-up column.
const at = (position: number, role: StageRole | null, systemKey: (typeof FOLLOW_UP_KEYS)[number] | null = null) => ({ position, role, systemKey });
ok(shouldAdvance(at(3, null, "no_answer"), at(1, "engaged")), "a reply pulls a lead out of No answer into Hot lead, even though Hot lead sits left of it");
ok(shouldAdvance(at(10, null, "nurture"), at(5, "booked")), "a booking pulls a lead out of Long-term nurture");
ok(!shouldAdvance(at(3, null, "no_answer"), at(0, "new")), "never back to the entry column");
ok(!shouldAdvance(at(3, null), at(1, "engaged")), "a plain manual column still never auto-advances");
ok(!shouldAdvance(at(3, null, "thinking"), at(12, "lapsed")), "never into an out-of-band column");

console.log(`followUpColumns: ${n} checks passed.`);
