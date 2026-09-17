// Run: npm test -- src/lib/content-studio/rewriteRun.test.ts
//
// Rewriting one line of a designed slide. The length rule is the part that
// matters: the composition was written around the words on it, so a heading
// that comes back half again as long wraps onto a third line and lands on its
// own body copy -- the defect lib/design/layoutBoxes exists to catch.
import assert from "node:assert/strict";

import { lengthBudget, parseRewrite, rewritePrompt } from "./rewriteRun";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

// ---------------------------------------------------------------------------
// The length budget
// ---------------------------------------------------------------------------
{
  const heading = "It isn't the oxygen percentage that matters most";
  const b = lengthBudget(heading);
  check("a long line gets a proportional budget", b.max - heading.length === Math.round(heading.length * 0.25));
  check("and the floor is symmetrical", heading.length - b.min === Math.round(heading.length * 0.25));
}
// 25% of a four-character word is one character. Refusing every alternative to
// "HBOT" is worse than letting it become "Infrared".
check("a short line gets an absolute floor, not a useless percentage", lengthBudget("HBOT").max >= 16);
check("the budget never asks for fewer than one character", lengthBudget("a").min >= 1);
check("an empty line does not produce a negative budget", lengthBudget("").min >= 1);

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------
const RUNS = [
  { index: 0, text: "INFRARED THERAPY" },
  { index: 1, text: "Radiant warmth, nothing enclosing you" },
  { index: 2, text: "You lie on a bed that radiates gentle heat through the skin." },
];
{
  const p = rewritePrompt({
    text: RUNS[1].text,
    runs: RUNS,
    index: 1,
    topic: "HBOT or infrared",
    business: "Optimal Health, a recovery clinic in Clonmel.",
    note: null,
  });
  check("the whole slide is shown, so the rewrite fits what surrounds it", RUNS.every((r) => p.includes(r.text)));
  check("the line to rewrite is marked", p.includes("-> " + JSON.stringify(RUNS[1].text)));
  check("the others are not marked", p.includes("   " + JSON.stringify(RUNS[0].text)));
  check("the business context is carried", p.includes("recovery clinic in Clonmel"));
  check("the topic is carried", p.includes("HBOT or infrared"));
  const b = lengthBudget(RUNS[1].text);
  check("the character budget is stated as numbers the model can count against", p.includes(`${b.min} and ${b.max} characters`));
  // Told WHY, because a model given a bare limit trades the copy's sense for
  // the number; told the reason, it keeps both.
  check("and the reason for it is given", p.includes("collides with the text beneath it"));
  check("the house no-fabrication rule is present", p.includes("NEVER INVENT A FACT"));
  check("emojis are forbidden -- these land inside a rendered design", p.includes("no emojis"));
  check("one line back, with nothing around it", p.includes("nothing else"));
  check("no operator note means no empty bullet", !p.includes("What the operator asked for"));
}
check(
  "an operator's own words are carried when they gave some",
  rewritePrompt({
    text: "x",
    runs: [{ index: 0, text: "x" }],
    index: 0,
    topic: "t",
    business: "b",
    note: "make it punchier",
  }).includes("make it punchier"),
);

// ---------------------------------------------------------------------------
// Parsing the reply
// ---------------------------------------------------------------------------
const ORIGINAL = "Radiant warmth, nothing enclosing you";
check("a plain reply comes through", parseRewrite("Gentle heat, nothing closing in", ORIGINAL) === "Gentle heat, nothing closing in");
check("surrounding whitespace is dropped", parseRewrite("  Warmth without walls  ", ORIGINAL) === "Warmth without walls");
check("a markdown bullet is stripped", parseRewrite("- Warmth without walls", ORIGINAL) === "Warmth without walls");
check("so is numbering", parseRewrite("1. Warmth without walls", ORIGINAL) === "Warmth without walls");
check("quotes wrapping the whole line are stripped", parseRewrite('"Warmth without walls"', ORIGINAL) === "Warmth without walls");
// An apostrophe is part of the words, not packaging.
check(
  "an apostrophe inside the line survives",
  parseRewrite("It isn't enclosing you", ORIGINAL) === "It isn't enclosing you",
);
check(
  "a model that explains itself has its first line taken",
  parseRewrite("Warmth without walls\n\nThis keeps the same rhythm.", ORIGINAL) === "Warmth without walls",
);
check("nothing usable is null, not an empty slide line", parseRewrite("   \n  ", ORIGINAL) === null);
check("an empty reply is null", parseRewrite("", ORIGINAL) === null);
// Showing the operator the words already on the slide as a "rewrite" reads as
// a broken button.
check("a reply identical to the original is null, so the caller can try again", parseRewrite(ORIGINAL, ORIGINAL) === null);
check(
  "and so is one that blew straight through the length rule",
  parseRewrite("x".repeat(lengthBudget(ORIGINAL).max * 2 + 1), ORIGINAL) === null,
);

// ---------------------------------------------------------------------------
// Not handing back what was already rejected
//
// Measured against the live model: the FIRST press returned the line
// unchanged -- a good line, so the model kept it -- and a button whose first
// press says "that came back the same" reads as broken.
// ---------------------------------------------------------------------------
check(
  "the rules demand a line different from the one being replaced",
  rewritePrompt({ text: "x", runs: [{ index: 0, text: "x" }], index: 0, topic: "t", business: "b" })
    .includes("MUST be different"),
);
{
  const p = rewritePrompt({
    text: ORIGINAL,
    runs: RUNS,
    index: 1,
    topic: "t",
    business: "b",
    avoid: [ORIGINAL, "Warmth without walls"],
  });
  check("lines already shown are listed back to the model", p.includes("Already tried"));
  check("including the one the last press produced", p.includes("Warmth without walls"));
}
check(
  "an empty avoid list adds no rule",
  !rewritePrompt({ text: "x", runs: [{ index: 0, text: "x" }], index: 0, topic: "t", business: "b", avoid: ["", "  "] })
    .includes("Already tried"),
);
check(
  "a reply matching something already rejected is null, so the route retries",
  parseRewrite("Warmth without walls", ORIGINAL, [ORIGINAL, "Warmth without walls"]) === null,
);
check(
  "a genuinely new line survives the avoid list",
  parseRewrite("Heat that reaches deeper", ORIGINAL, [ORIGINAL, "Warmth without walls"]) ===
    "Heat that reaches deeper",
);

check(
  "a rewrite may not invent the equipment either -- the gap that let a clinic's infrared bed be called \"open, no seal\"",
  rewritePrompt({ text: "x", runs: [{ index: 0, text: "x" }], index: 0, topic: "t", business: "b" })
    .includes("covers the EQUIPMENT too"),
);

console.log(`\nrewriteRun: ${passed} checks passed`);
