// app/src/lib/programs/templates/content.test.ts
// Run: npm test -- src/lib/programs/templates/content.test.ts
//
// Every platform program explains itself: a summary, phases from week 1 to
// its length (or one cycle when it repeats) with a note each, and why it
// works. The words follow the house rules and claim no outcome.
import assert from "node:assert/strict";

import { contentErrors } from "../content";
import { PLATFORM_PROGRAMS } from "../registry";

const programs = PLATFORM_PROGRAMS;
assert.equal(programs.length, 19);

// Only these programs describe one pass through a cycle that repeats.
assert.deepEqual(
  programs.filter((t) => t.phasesRepeat === true).map((t) => t.key).sort(),
  ["531-bbb", "531-fsl", "texas-method"],
  "only 5/3/1 and the Texas Method repeat",
);
for (const t of programs) assert.ok(t.phasesRepeat === true || t.phasesRepeat === undefined, `${t.key}: phasesRepeat is true or left out`);

const CLAIMS = /\byou will\b|\bguarantee|\bproven\b|\bfastest\b|\bnot just\b|\brather than\b|\bnever drops\b/i;
/** "new max" (or "new 1-rep max") is an outcome unless it is the thing being tested or attempted. */
const NEW_MAX = /(?<!\b(?:test|attempt)\s+(?:(?:of|at|for)\s+)?(?:(?:a|your)\s+)?)\bnew\s+(?:1-rep\s+)?max\b/i;
/** "every session" with no "you" in the next six words promises growth with no condition. */
const UNCONDITIONAL = /\bevery\s+(?:session|time|workout)\b(?!(?:\W+[\w'-]+){0,5}\W+you\b)/i;

// The patterns catch what they should and let the corrected wording through.
assert.ok(NEW_MAX.test("ending in a new max"));
assert.ok(NEW_MAX.test("work up to a new 1-rep max"));
assert.ok(NEW_MAX.test("The test week reads your new max."), "a test elsewhere in the sentence does not excuse it");
assert.ok(!NEW_MAX.test("then a test of your new max"));
assert.ok(!NEW_MAX.test("an attempt at a new max"));
assert.ok(UNCONDITIONAL.test("a little heavier every session."));
assert.ok(UNCONDITIONAL.test("You squat every session, so the squat gets the most practice."));
assert.ok(!UNCONDITIONAL.test("Each lift goes up every session you get all your reps."));
assert.ok(!UNCONDITIONAL.test("heavier every time you get all your reps"));
assert.ok(CLAIMS.test("so the volume never drops"));
assert.ok(CLAIMS.test("You will add 20 kg."));
assert.ok(CLAIMS.test("Guaranteed results."));

for (const t of programs) {
  assert.deepEqual(contentErrors(t), [], t.key);
  const words = [t.summary!, t.whyItWorks!, ...t.phases!.flatMap((p) => [p.name, p.note])];
  for (const w of words) {
    assert.ok(!CLAIMS.test(w), `${t.key}: no claims or filler: ${w}`);
    assert.ok(!NEW_MAX.test(w), `${t.key}: a new max is tested or attempted, never promised: ${w}`);
    assert.ok(!UNCONDITIONAL.test(w), `${t.key}: growth every session needs its condition: ${w}`);
    assert.ok(!/\p{Extended_Pictographic}/u.test(w), `${t.key}: no emojis`);
    assert.ok(w === w.trim() && !/\s{2,}/.test(w), `${t.key}: tidy spacing: ${w}`);
  }
  assert.ok(t.summary!.length <= 200, `${t.key}: summary fits the card`);
  // A program whose name says "-style" says in why it works that the numbers or workouts are ours.
  if (/-style/i.test(t.name)) assert.ok(/\bours\b/.test(t.whyItWorks!), `${t.key}: says the numbers are ours`);
}

console.log(`programs/templates content: ${programs.length} programs ok`);
