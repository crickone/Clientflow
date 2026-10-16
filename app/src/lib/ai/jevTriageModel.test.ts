// Run: npm test -- src/lib/ai/jevTriageModel.test.ts
import assert from "node:assert/strict";

import { jevTriageState, readJevTriage, trialStats, JEV_TRIAGE_QUESTIONS } from "./jevTriageModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

check("the category options match Claude's categories", Object.keys((JEV_TRIAGE_QUESTIONS.category as { criteria: Record<string, string> }).criteria).join() === "new_lead,booking,existing_client,faq,sensitive,spam,other");

const state = jevTriageState({
  messageText: "Can I book the 6pm spin?",
  channel: "whatsapp",
  isExistingClient: true,
  senderName: "Aoife",
  history: Array.from({ length: 9 }, (_, i) => ({ direction: i % 2 ? "outbound" : "inbound", content: `m${i}` }) as const),
});
check("the state carries the message and who sent it", state.newMessage === "Can I book the 6pm spin?" && state.senderIsKnownClient === true && state.senderName === "Aoife");
check("only the last six messages of history go", (state.recentConversation as unknown[]).length === 6);

const good = readJevTriage({
  category: { type: "choice", choice: "booking", probabilities: { booking: 0.91, faq: 0.09 } },
  priority: { type: "score", score: 1.2 },
  sensitive: { type: "boolean", probability: 0.04 },
});
check("answers read as labels", good !== null && good.category === "booking" && good.priority === "normal" && good.sensitive === false && good.confidence === 0.91);
check("a high score is high priority", readJevTriage({ category: { type: "choice", choice: "faq" }, priority: { type: "score", score: 1.8 }, sensitive: { type: "boolean", probability: 0.6 } })!.priority === "high");
check("sensitive at 50% or more", readJevTriage({ category: { type: "choice", choice: "faq" }, priority: { type: "score", score: 0 }, sensitive: { type: "boolean", probability: 0.5 } })!.sensitive === true);
check("no probabilities means no confidence", readJevTriage({ category: { type: "choice", choice: "faq" }, priority: { type: "score", score: 0 }, sensitive: { type: "boolean", probability: 0 } })!.confidence === null);
check("a refusal is no answer", readJevTriage({ category: { type: "refusal" }, priority: { type: "score", score: 0 }, sensitive: { type: "boolean", probability: 0 } }) === null);
check("an unknown category is no answer", readJevTriage({ category: { type: "choice", choice: "billing" }, priority: { type: "score", score: 0 }, sensitive: { type: "boolean", probability: 0 } }) === null);
check("a missing question is no answer", readJevTriage({ category: { type: "choice", choice: "faq" } }) === null);

const row = (o: Partial<Parameters<typeof trialStats>[0][number]>) => ({ claudeCategory: "faq", claudePriority: "normal", claudeSensitive: false, jevCategory: "faq", jevPriority: "normal", jevSensitive: false, jevMs: 200, error: null, ...o });
const s = trialStats([
  row({}),
  row({ jevCategory: "booking", jevMs: 100 }),
  row({ claudeSensitive: true, claudeCategory: "sensitive", jevCategory: "sensitive", jevSensitive: false, jevMs: 400 }),
  row({ error: "403", jevCategory: null, jevPriority: null, jevSensitive: null, jevMs: null }),
]);
check("failed calls don't count as disagreements", s.compared === 3 && s.failed === 1);
check("category agreement", s.category === 67);
check("sensitive agreement and the misses that matter", s.sensitive === 67 && s.missedSensitive === 1);
check("median response time", s.medianMs === 200);
check("nothing compared yet", trialStats([]).category === null && trialStats([]).medianMs === null);

console.log(`jevTriageModel: ${passed} checks passed`);
