// Run: npm test -- src/lib/leadScoreModel.test.ts
import assert from "node:assert/strict";

import { band, leadScoreState, LEAD_SCORE_QUESTIONS, readLeadScore, scoreDue } from "./leadScoreModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const now = Date.parse("2026-10-16T12:00:00Z");
const h = (n: number) => now - n * 3_600_000;

check("five readiness levels", (LEAD_SCORE_QUESTIONS.readiness as { criteria: string[] }).criteria.length === 5);
check("next steps are the five options", Object.keys((LEAD_SCORE_QUESTIONS.nextStep as { criteria: object }).criteria).join() === "book,call,message,wait,close");

const state = leadScoreState(
  {
    source: "facebook",
    campaign: "Black Friday",
    interestedIn: null,
    stage: "New lead",
    formNotes: "Interested in the 6 week challenge",
    hasPhone: true,
    hasEmail: false,
    doNotCall: false,
    createdAt: h(50),
    messages: [
      { direction: "outbound", channel: "whatsapp", at: h(48), content: "Hi, thanks for your interest" },
      { direction: "note", channel: "manual", at: h(30), content: "Called, no answer" },
      { direction: "inbound", channel: "whatsapp", at: h(3), content: "How much is it and when does it start?" },
    ],
  },
  now,
);
check("counts each side, notes left out", state.messagesFromThem === 1 && state.messagesFromUs === 1 && (state.recentMessages as unknown[]).length === 2);
check("hours since each side last wrote", state.hoursSinceTheirLastMessage === 3 && state.hoursSinceOurLastMessage === 48);
check("days since first contact", state.daysSinceFirstContact === 2);
check("empty fields are left out", !("interestedIn" in state) && state.campaign === "Black Friday");
check("no messages means no last-message times", leadScoreState({ source: "manual", campaign: null, interestedIn: null, stage: null, formNotes: null, hasPhone: false, hasEmail: true, doNotCall: false, createdAt: h(1), messages: [] }, now).hoursSinceTheirLastMessage === null);

check("readiness 3 of 4 is 75", readLeadScore({ readiness: { type: "score", score: 3 }, nextStep: { type: "choice", choice: "call" } })!.score === 75);
check("out-of-range scores are clamped", readLeadScore({ readiness: { type: "score", score: 9 }, nextStep: { type: "choice", choice: "book" } })!.score === 100);
check("an unknown next step is no answer", readLeadScore({ readiness: { type: "score", score: 2 }, nextStep: { type: "choice", choice: "email" } }) === null);
check("a refusal is no answer", readLeadScore({ readiness: { type: "refusal" }, nextStep: { type: "choice", choice: "wait" } }) === null);

check("bands", band(70) === "hot" && band(69) === "warm" && band(40) === "warm" && band(39) === "cold");

const base = { scoredAt: h(2), lastActivity: h(5), stageRole: "new_lead", isClient: false };
check("scored after the last activity and recently: not due", !scoreDue(base, now));
check("never scored: due", scoreDue({ ...base, scoredAt: null }, now));
check("new activity since the score: due", scoreDue({ ...base, lastActivity: h(1) }, now));
check("score over a day old: due", scoreDue({ ...base, scoredAt: h(25) }, now));
check("clients and closed leads are left alone", !scoreDue({ ...base, scoredAt: null, isClient: true }, now) && !scoreDue({ ...base, scoredAt: null, stageRole: "lost" }, now) && !scoreDue({ ...base, scoredAt: null, stageRole: "sale" }, now));

console.log(`leadScoreModel: ${passed} checks passed`);
