// Run: npm test -- src/lib/leadFlows/editorSettings.test.ts
//
// What the /automations editor reads and saves for a flow: the start column,
// the finish move, the treatment keywords, and the default wording; and
// that a saved setting is what the engine then uses.
import "./testing/stubs";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const h = requireLocal("./testing/harness") as typeof import("./testing/harness");
  const { runWithTenant } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const automations = requireLocal("../automations") as typeof import("../automations");
  const { getFlowDefinition } = requireLocal("./definitions") as typeof import("./definitions");
  const { DEFAULT_MESSAGES } = requireLocal("../automationModel") as typeof import("../automationModel");

  const s = h.makeScratchTenant("lead-flow-editor-test");
  let n = 0;
  const ok = (cond: boolean, name: string) => {
    assert.ok(cond, name);
    n++;
  };

  try {
    await runWithTenant(s.tid, async () => {
      const t = automations.getTrigger("lead_no_answer")!;
      ok(!!t.flow && t.flow.columnStarted && t.flow.finishable && !t.flow.beforeCall, "No answer: column-started, can finish with a move");
      ok(t.startColumn === "key:no_answer" && t.finishColumn === "key:nurture" && t.finishAfterValue === 4 && t.finishAfterUnit === "days", "the defaults are shown");
      ok(t.flow!.columns.some((c) => c.ref === "key:no_answer" && c.name === "No answer") && t.flow!.columns.some((c) => c.ref === "role:booked"), "every column of the main board is offered");
      ok(t.defaults.length === DEFAULT_MESSAGES.lead_no_answer.length, "the default wording is there to fall back to");
      ok(automations.getTrigger("lead_call_booked")!.flow!.beforeCall && !automations.getTrigger("lead_call_booked")!.flow!.finishable, "Call booked: counted back from the call, no finish move");
      ok(automations.getTrigger("client_birthday")!.flow === null, "not a lead flow: no flow settings");

      automations.saveTrigger({
        key: "lead_no_answer",
        enabled: true,
        externalEnabled: false,
        startColumn: "key:thinking",
        finishColumn: "",
        finishAfterValue: 9,
        finishAfterUnit: "days",
        messages: [
          { channel: "whatsapp", subject: null, template: "Hi [FIRST_NAME]", attachmentFilename: null, attachmentOriginal: null, delayValue: 0, delayUnit: "days", matchInterest: " hbot, hyperbaric " },
        ],
      });
      const def = getFlowDefinition("lead_no_answer");
      ok(def.enabled && def.startColumn === "key:thinking" && def.finish === null, "saved: starts from Thinking about it, no finish move");
      ok(def.messages[0].matchInterest === "hbot, hyperbaric", "keywords saved, trimmed");
      const back = automations.getTrigger("lead_no_answer")!;
      ok(back.startColumn === "key:thinking" && back.finishColumn === "" && back.messages[0].matchInterest === "hbot, hyperbaric", "and read back by the editor");

      automations.saveTrigger({ key: "lead_no_answer", enabled: true, externalEnabled: false, startColumn: "role:nope", finishColumn: "key:nurture", finishAfterValue: 4, finishAfterUnit: "days", messages: [] });
      ok(getFlowDefinition("lead_no_answer").startColumn === "key:no_answer", "a column reference that makes no sense falls back to the default");
      automations.saveTrigger({ key: "new_lead", enabled: false, externalEnabled: false, startColumn: "key:thinking", messages: [] });
      ok(getFlowDefinition("new_lead").startColumn === null, "a flow with a fixed trigger never gets a start column");
    });
    console.log(`editorSettings: ${n} checks passed.`);
  } finally {
    s.cleanup();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
