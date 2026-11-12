// app/src/lib/programs/validate.test.ts
// Run: npm test -- src/lib/programs/validate.test.ts
//
// Shape errors read in plain words for a gym admin, with the week, day and exercise they are about.
import assert from "node:assert/strict";

import { platformProgram } from "./registry";
import { parseTemplate, validateTemplate } from "./validate";

function errorsFor(mutate: (t: any) => void): string[] {
  const t = JSON.parse(JSON.stringify(platformProgram("stronglifts-5x5")!)) as any;
  mutate(t);
  const r = parseTemplate(t);
  assert.equal(r.ok, false);
  return r.ok ? [] : r.errors;
}

const dayName = platformProgram("stronglifts-5x5")!.weeks[0].days[0].name;
const noName = errorsFor((t) => {
  t.weeks[0].days[0].exercises[0].name = "";
});
assert.equal(noName[0], `Week 1, ${dayName}, exercise 1: add a name.`);

const badRest = errorsFor((t) => {
  t.weeks[1].days[2].exercises[1].sets[3].rest = 5000;
});
assert.ok(badRest[0].startsWith("Week 2, "), badRest[0]);
assert.ok(badRest[0].endsWith("exercise 2, set 4: rest must be between 0 and 900 seconds."), badRest[0]);

const unnamedDay = errorsFor((t) => {
  t.weeks[0].days[1].name = "";
});
assert.equal(unnamedDay[0], "Week 1, Day 2: add a name.");

const noSets = errorsFor((t) => {
  t.weeks[0].days[0].exercises[0].sets = [];
});
assert.ok(noSets[0].endsWith("exercise 1: add at least one set."), noSets[0]);

const topLevel = errorsFor((t) => {
  t.name = "";
});
assert.deepEqual(topLevel, ["Add a name."]);

for (const e of [...noName, ...badRest, ...unnamedDay, ...noSets, ...topLevel]) {
  assert.ok(!/\.\d|: (Too|Invalid|Expected)/.test(e), `no zod path or jargon: ${e}`);
}

// Content fields: blank asks for the text, never "too long (NaN characters at most)".
assert.deepEqual(errorsFor((t) => (t.summary = "")), ["Add a summary."]);
assert.deepEqual(errorsFor((t) => (t.summary = "   ")), ["Add a summary."]);
assert.deepEqual(errorsFor((t) => (t.summary = "x".repeat(201))), ["The summary is too long (200 characters at most)."]);
assert.deepEqual(errorsFor((t) => (t.whyItWorks = "")), ["Add why it works."]);
assert.deepEqual(errorsFor((t) => (t.whyItWorks = " ")), ["Add why it works."]);
assert.deepEqual(errorsFor((t) => (t.whyItWorks = "x".repeat(601))), ["The line on why it works is too long (600 characters at most)."]);
// Phases, in plain grammar.
assert.deepEqual(errorsFor((t) => (t.phases[0].name = " ")), ["Each phase needs a name."]);
assert.deepEqual(errorsFor((t) => (t.phases[0].name = "x".repeat(41))), ["A phase name is too long (40 characters at most)."]);
assert.deepEqual(errorsFor((t) => (t.phases[0].note = "x".repeat(301))), ["A phase note is too long (300 characters at most)."]);
assert.deepEqual(errorsFor((t) => (t.phases[0].fromWeek = 0)), ["A phase's weeks must be whole numbers from 1 to 52."]);
assert.deepEqual(errorsFor((t) => (t.phases = [])), ["Add at least one phase."]);
assert.deepEqual(errorsFor((t) => (t.phases = Array.from({ length: 13 }, () => t.phases[0]))), ["No more than 12 phases."]);
assert.deepEqual(errorsFor((t) => (t.phasesRepeat = "yes")), ["Whether the phases repeat must be yes or no."]);
for (const e of [...errorsFor((t) => (t.summary = 3)), ...errorsFor((t) => (t.warning = 3)), ...errorsFor((t) => (t.weeks[0].label = 3))]) {
  assert.ok(!/NaN/.test(e), `no NaN: ${e}`);
}

assert.ok(validateTemplate(platformProgram("stronglifts-5x5")!).ok, "a good template still passes");
console.log("programs/validate: ok");
