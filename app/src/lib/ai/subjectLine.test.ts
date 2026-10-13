// Run: npm test -- src/lib/ai/subjectLine.test.ts
//
// Campaign emails now get their subject from the model instead of a fixed
// "<campaign name> is here", which showed customers internal names.
import assert from "node:assert/strict";

import { splitSubjectLine } from "./subjectLine";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const a = splitSubjectLine("Subject: 20% off every massage this week\n\nHi,\n\nBody here.");
check("subject taken off the first line", a.subject === "20% off every massage this week");
check("body keeps the rest", a.body === "Hi,\n\nBody here.");

const b = splitSubjectLine('**Subject:** "Your November plan"\nHi there');
check("bold label and quotes removed", b.subject === "Your November plan" && b.body === "Hi there");

const c = splitSubjectLine("Hi,\n\nNo subject line here.");
check("no subject line leaves the body untouched", c.subject === null && c.body === "Hi,\n\nNo subject line here.");

const d = splitSubjectLine("Subject:   \nHi");
check("an empty subject counts as none", d.subject === null);

console.log(`subjectLine: ${passed} checks passed`);
