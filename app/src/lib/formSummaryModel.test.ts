// Run: npm test -- src/lib/formSummaryModel.test.ts
import assert from "node:assert/strict";

import { summariseForm } from "./formSummaryModel";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const s = summariseForm([
  { questionId: 1, label: "Any medical conditions?", fieldType: "long", value: "Bad knee" },
  { questionId: 2, label: "Heart condition?", fieldType: "dropdown", value: "Yes" },
  { questionId: 3, label: "Waiting on test results?", fieldType: "dropdown", value: "No" },
  { questionId: 4, label: "Target weight", fieldType: "number", value: "" },
  { questionId: 5, label: "I understand the notice period", fieldType: "confirm", value: "yes" },
  { questionId: 6, label: "I understand the fee", fieldType: "confirm", value: "" },
  { questionId: 7, label: "A video", fieldType: "video", value: "" },
]);
check("questions exclude ticks and video", s.questions === 4);
check("answered counts filled ones", s.answered === 3);
check("ticks counted", s.confirms.total === 2 && s.confirms.ticked === 1);
check("Yes answers to Yes/No questions are pulled out", s.yes.length === 1 && s.yes[0] === "Heart condition?");
check("an empty form is all zeros", summariseForm([]).questions === 0 && summariseForm([]).yes.length === 0);

console.log(`formSummaryModel: ${passed} checks passed`);
