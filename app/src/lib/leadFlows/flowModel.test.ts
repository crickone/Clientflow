// Run: npm test -- src/lib/leadFlows/flowModel.test.ts
//
// Column references (how a flow names a column on any board), the flow
// defaults, and the queue payload reader.
import assert from "node:assert/strict";

import { TRIGGER_CATALOG, ACTIVE_TRIGGER_KEYS, LEAD_SEQUENCE_KEYS, STOP_ON_REPLY, STOP_ON_BOOKED, applyShortcodes, supportsDelays } from "../automationModel";
import {
  FLOW_DEFAULTS,
  LEAD_FLOW_KEYS,
  columnMatches,
  columnRefFor,
  hasFinishStep,
  isColumnRef,
  isColumnStartedFlow,
  isTriggerEnabled,
  parsePayload,
  resolveColumn,
} from "./flowModel";

let n = 0;
const ok = (cond: boolean, name: string) => {
  assert.ok(cond, name);
  n++;
};

const hot = { id: 2, role: "engaged" as const, systemKey: null };
const noAnswer = { id: 11, role: null, systemKey: "no_answer" as const };
const custom = { id: 40, role: null, systemKey: null };

ok(columnRefFor(hot) === "role:engaged", "a role column is named by its role");
ok(columnRefFor(noAnswer) === "key:no_answer", "a follow-up column by its key");
ok(columnRefFor(custom) === "stage:40", "any other column by its id");
ok(columnMatches("key:no_answer", { ...noAnswer, id: 99 }), "a key matches the same column on another board");
ok(!columnMatches("key:no_answer", hot) && !columnMatches("stage:40", { ...custom, id: 41 }), "and nothing else");
ok(resolveColumn("role:engaged", [custom, noAnswer, hot]) === hot, "resolveColumn finds it");
ok(resolveColumn("key:nurture", [custom, hot]) === null, "or says there is none");
ok(isColumnRef("role:booked") && isColumnRef("key:thinking") && isColumnRef("stage:3"), "valid refs");
ok(!isColumnRef("role:nope") && !isColumnRef("key:booked") && !isColumnRef("stage:0") && !isColumnRef("stage:x") && !isColumnRef(""), "invalid refs");

// Defaults.
for (const key of LEAD_FLOW_KEYS) ok(key in FLOW_DEFAULTS, `${key} has defaults`);
for (const [key, d] of Object.entries(FLOW_DEFAULTS)) {
  ok(d.startColumn === null || isColumnRef(d.startColumn), `${key} start column is a valid ref`);
  ok(d.finishColumn === null || isColumnRef(d.finishColumn), `${key} finish column is a valid ref`);
}
ok(FLOW_DEFAULTS.new_lead.finishColumn === "key:nurture" && FLOW_DEFAULTS.new_lead.finishAfter?.value === 14, "New lead ends in Long-term nurture after 14 days");
ok(FLOW_DEFAULTS.lead_no_answer.startColumn === "key:no_answer" && FLOW_DEFAULTS.lead_no_answer.finishAfter?.value === 4, "No answer: column-started, 4 days to the move");
ok(FLOW_DEFAULTS.lead_call_back.finishAfter?.value === 6 && FLOW_DEFAULTS.lead_thinking.finishAfter?.value === 17, "Call back later 6 days, Thinking about it 17");
ok(FLOW_DEFAULTS.lead_booked.startColumn === "role:booked" && FLOW_DEFAULTS.lead_no_show.startColumn === "role:no_show", "the booked and no-show flows are column-started");
ok(isColumnStartedFlow("lead_nurture") && !isColumnStartedFlow("new_lead") && !isColumnStartedFlow("lead_call_booked"), "isColumnStartedFlow");
ok(hasFinishStep("new_lead") && !hasFinishStep("lead_call_booked") && !hasFinishStep("client_birthday"), "hasFinishStep");

// Catalog.
for (const key of ["lead_no_answer", "lead_call_back", "lead_call_booked", "lead_thinking", "lead_nurture"]) {
  ok(TRIGGER_CATALOG.some((t) => t.key === key) && ACTIVE_TRIGGER_KEYS.has(key) && supportsDelays(key), `${key} is in the catalog, active and delayed`);
}
ok(LEAD_SEQUENCE_KEYS.length === 10, "ten lead flows");
ok(!STOP_ON_REPLY.includes("lead_call_booked") && STOP_ON_REPLY.includes("lead_nurture"), "a reply stops nurture but not a booked call's reminder");
ok(!STOP_ON_BOOKED.includes("lead_booked") && STOP_ON_BOOKED.includes("lead_thinking"), "booking stops Thinking about it");
ok(!isTriggerEnabled("lead_nurture", undefined) && isTriggerEnabled("campaign_signup", undefined), "new flows are off until switched on");
ok(isTriggerEnabled("lead_nurture", { enabled: true }), "and on when switched on");

// Shortcodes.
ok(
  applyShortcodes("Ring [BUSINESS_PHONE] on [CALL_DAY] at [CALL_TIME]", { businessPhone: "087 000 0000", callDay: "Wednesday 2 December", callTime: "10:30" }) ===
    "Ring 087 000 0000 on Wednesday 2 December at 10:30",
  "the new shortcodes fill in",
);
ok(applyShortcodes("[CALL_DAY]", {}) === "[CALL_DAY]", "a call code outside a call stays as typed");

// Payload.
assert.deepEqual(parsePayload('{"column":"key:nurture"}'), { column: "key:nurture" });
n++;
assert.deepEqual(parsePayload("not json"), {});
n++;
assert.deepEqual(parsePayload(null), {});
n++;

console.log(`flowModel: ${n} checks passed.`);
