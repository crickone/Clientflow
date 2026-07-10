/**
 * Unit test for the auto-reply confidence gate. Pure logic, no I/O.
 * Run: npx tsx src/lib/inbox/autoReplyDecision.test.ts
 */
import assert from "node:assert/strict";

import { decideAutoReply } from "./autoReplyDecision";
import type { InboxAiSettings } from "./settings";
import type { TriageResult } from "../ai/triageMessage";

type GateTriage = Pick<
  TriageResult,
  "category" | "confidence" | "sensitive" | "autoReplyEligible" | "suggestedReply"
>;

const baseSettings: InboxAiSettings = {
  autoReplyEnabled: true,
  autoReplyCategories: ["faq", "new_lead"],
  autoReplyConfidenceThreshold: 0.8,
};

const baseTriage: GateTriage = {
  category: "faq",
  confidence: 0.9,
  sensitive: false,
  autoReplyEligible: true,
  suggestedReply: "Our HBOT session is €95.",
};

function decide(
  t: Partial<GateTriage> = {},
  s: Partial<InboxAiSettings> = {},
  briefComplete = true,
) {
  return decideAutoReply(
    { ...baseTriage, ...t },
    { ...baseSettings, ...s },
    briefComplete,
  );
}

let passed = 0;
function check(name: string, actual: string, expected: string) {
  assert.equal(actual, expected, `${name}: expected "${expected}", got "${actual}"`);
  passed++;
  console.log("  ✓", name);
}

check("eligible FAQ auto-sends", decide(), "auto_send");
check("eligible new_lead auto-sends", decide({ category: "new_lead" }), "auto_send");
check("sensitive is always held", decide({ sensitive: true }), "held");
check(
  "sensitive wins even when otherwise eligible",
  decide({ sensitive: true, category: "faq", confidence: 1 }),
  "held",
);
check("brief incomplete -> draft", decide({}, {}, false), "draft");
check("auto-reply disabled -> draft", decide({}, { autoReplyEnabled: false }), "draft");
check("category not in auto-set -> draft", decide({ category: "booking" }), "draft");
check("existing_client -> draft", decide({ category: "existing_client" }), "draft");
check("below threshold -> draft", decide({ confidence: 0.79 }), "draft");
check("at threshold -> auto_send", decide({ confidence: 0.8 }), "auto_send");
check("model says not eligible -> draft", decide({ autoReplyEligible: false }), "draft");
check("no suggested reply -> draft", decide({ suggestedReply: null }), "draft");

console.log(`\nautoReplyDecision: ${passed} checks passed.`);
