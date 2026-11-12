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

assert.ok(validateTemplate(platformProgram("stronglifts-5x5")!).ok, "a good template still passes");
console.log("programs/validate: ok");
