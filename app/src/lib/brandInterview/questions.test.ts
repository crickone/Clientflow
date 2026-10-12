// Run: npm test -- src/lib/brandInterview/questions.test.ts
//
// The brand interview's question list: venue-aware wording, the business's
// own services as chips, and the answers handed to the writer with skipped
// questions left out.
import assert from "node:assert/strict";
import { answeredCount, answersAsText, interviewQuestions } from "./questions";

const gym = interviewQuestions("gym", { name: "Inspire", town: "Clonmel", services: [] });
const clinic = interviewQuestions("clinic", { name: "Optimal Health", town: "", services: ["Hyperbaric oxygen", "Infrared"] });

assert.ok(gym.find((q) => q.id === "who")!.title.includes("member"));
assert.ok(clinic.find((q) => q.id === "who")!.title.includes("client"));
assert.ok(gym.find((q) => q.id === "different")!.title.includes("in Clonmel"));
assert.deepEqual(clinic.find((q) => q.id === "offer")!.options, ["Hyperbaric oxygen", "Infrared"], "the business's own services are the chips");
assert.equal(new Set(gym.map((q) => q.id)).size, gym.length, "question ids are unique");

const answers = { oneLiner: { text: "A strength gym" }, offer: { picks: ["Personal training"], text: "Hyrox" }, story: { text: "  " } };
assert.equal(answeredCount(answers), 2);
const text = answersAsText(gym, answers);
assert.ok(text.includes("A strength gym") && text.includes("Personal training. Hyrox"));
assert.ok(!text.includes("How did"), "a blank answer is left out");

console.log("brandInterview questions: 8 checks passed.");
