// Run: npm test -- src/components/adonis/chat/history.test.ts
//
// The history drawer groups chats by Irish calendar day and labels each one;
// the opening screen greets by Irish time of day.
import assert from "node:assert/strict";

import type { ConversationSummary } from "@/lib/agents/conversationModel";
import { filterHistory, greetingFor, groupHistory, historyTimeLabel, previousDay } from "./history";

const now = Date.UTC(2026, 10, 24, 15, 0); // Tuesday 24 November 2026, 15:00 in Dublin (UTC+0)
const chat = (id: string, title: string, updatedAt: number): ConversationSummary => ({ id, title, updatedAt, running: false });
const items = [
  chat("d", "Who hasn't booked in 30 days", Date.UTC(2026, 10, 20, 9, 0)),
  chat("a", "Black Friday budget split", now - 30_000),
  chat("c", "Voucher store wording", Date.UTC(2026, 10, 23, 9, 0)),
  chat("b", "Reply to Messenger leads", Date.UTC(2026, 10, 24, 11, 20)),
  chat("e", "Early one", Date.UTC(2026, 10, 24, 0, 10)),
];

const groups = groupHistory(items, now);
assert.deepEqual(groups.map((g) => g.label), ["Today", "Yesterday", "Earlier"]);
assert.deepEqual(groups[0].items.map((c) => c.id), ["a", "b", "e"], "newest first within a day");
assert.deepEqual(groups[1].items.map((c) => c.id), ["c"]);
assert.deepEqual(groups[2].items.map((c) => c.id), ["d"]);
assert.deepEqual(groupHistory([items[0]], now).map((g) => g.label), ["Earlier"], "empty groups are left out");

assert.equal(historyTimeLabel(now - 30_000, now), "now");
assert.equal(historyTimeLabel(Date.UTC(2026, 10, 24, 11, 20), now), "11:20");
assert.equal(historyTimeLabel(Date.UTC(2026, 10, 23, 9, 0), now), "Mon");
assert.equal(historyTimeLabel(Date.UTC(2026, 10, 20, 9, 0), now), "20 Nov");

// Summer time: 23:30 UTC on 1 July is 00:30 on 2 July in Dublin.
const summer = Date.UTC(2026, 6, 2, 10, 0);
const late = groupHistory([chat("x", "x", Date.UTC(2026, 6, 1, 23, 30)), chat("y", "y", Date.UTC(2026, 6, 1, 22, 30))], summer);
assert.deepEqual(late.map((g) => [g.label, g.items.map((c) => c.id)]), [["Today", ["x"]], ["Yesterday", ["y"]]], "days are Irish days");

assert.equal(previousDay("2026-01-01"), "2025-12-31");
assert.equal(previousDay("2026-03-01"), "2026-02-28");

assert.deepEqual(filterHistory(items, "  BLACK ").map((c) => c.id), ["a"], "search ignores case and spaces");
assert.equal(filterHistory(items, "").length, items.length);

assert.equal(greetingFor(now, "Chris"), "Good afternoon, Chris.");
assert.equal(greetingFor(Date.UTC(2026, 10, 24, 8, 0), "Chris"), "Good morning, Chris.");
assert.equal(greetingFor(Date.UTC(2026, 10, 24, 20, 0), null), "Good evening.");
assert.equal(greetingFor(Date.UTC(2026, 6, 2, 11, 30), null), "Good afternoon.", "12:30 in Dublin in summer");

console.log("history: all checks passed");
