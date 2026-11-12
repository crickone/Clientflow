// app/src/lib/programs/templates/content.test.ts
// Run: npm test -- src/lib/programs/templates/content.test.ts
//
// Every platform program explains itself: a summary, phases from week 1 to
// its length (or one cycle when it repeats) with a note each, and why it
// works. The words follow the house rules.
import assert from "node:assert/strict";

import { contentErrors } from "../content";
import { PLATFORM_PROGRAMS } from "../registry";

// The programs written so far; Task 5 checks every platform program.
const WRITTEN = new Set(["stronglifts-5x5", "starting-strength", "greyskull-lp", "531-bbb", "531-fsl", "texas-method", "gzclp"]);
const programs = PLATFORM_PROGRAMS.filter((t) => WRITTEN.has(t.key));
assert.equal(programs.length, WRITTEN.size);

const CLAIMS = /\byou will\b|\bguarantee|\bproven\b|\bfastest\b|\bnot just\b|\brather than\b/i;
for (const t of programs) {
  assert.deepEqual(contentErrors(t), [], t.key);
  const words = [t.summary!, t.whyItWorks!, ...t.phases!.flatMap((p) => [p.name, p.note])];
  for (const w of words) {
    assert.ok(!CLAIMS.test(w), `${t.key}: no claims or filler: ${w}`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(w), `${t.key}: no emojis`);
    assert.ok(w === w.trim() && !/\s{2,}/.test(w), `${t.key}: tidy spacing: ${w}`);
  }
  assert.ok(t.summary!.length <= 200, `${t.key}: summary fits the card`);
  // "-style" and "After ..." programs say the numbers or workouts are ours.
  if (/-style/i.test(t.name)) assert.ok(/\bours\b/.test(t.whyItWorks!), `${t.key}: says the numbers are ours`);
}

console.log(`programs/templates content: ${programs.length} programs ok`);
