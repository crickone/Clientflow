// Run: npm test -- src/lib/leadFlows/heldRows.test.ts
//
// A flow that was off is switched on: its imported runs' held rows go,
// except messages whose time passed (skipped, never sent late) and any
// second message the same day. A finish move whose time passed happens now.
import assert from "node:assert/strict";

import { planRelease, type HeldRow } from "./heldRows";
import { todayIn } from "./sendingWindow";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};
const H = 3_600_000;
const NOW = Date.parse("2030-01-16T10:00:00Z");
const dayOf = (at: number) => todayIn(at);
const row = (id: number, runId: number, kind: string, dueAt: number): HeldRow => ({ id, runId, kind, dueAt });

const plan = planRelease(
  [
    row(1, 10, "message", NOW - 24 * H), // passed: skipped
    row(2, 10, "message", NOW + 1 * H), // today: goes
    row(3, 10, "message", NOW + 3 * H), // today again: skipped
    row(4, 10, "message", NOW + 48 * H), // later: goes
    row(5, 10, "move", NOW + 72 * H), // later move: goes
    row(6, 11, "message", NOW + 2 * H), // another run, today: goes
    row(7, 12, "move", NOW - 5 * H), // a passed move: now
  ],
  NOW,
  dayOf,
);
assert.deepEqual([...plan.cancel].sort((a, b) => a - b), [1, 3]);
n++;
const q = new Map(plan.queue.map((r) => [r.id, r.dueAt]));
ok(q.get(2) === NOW + H && q.get(4) === NOW + 48 * H && q.get(5) === NOW + 72 * H, "future rows keep their times");
ok(q.get(6) === NOW + 2 * H, "each run gets its own one message today");
ok(q.get(7) === NOW, "a passed move happens now");
ok(planRelease([], NOW, dayOf).cancel.length === 0, "nothing held: nothing to do");

console.log(`heldRows: ${n} checks passed.`);
