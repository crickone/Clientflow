// Run: npm test -- src/lib/content-studio/title.test.ts
//
// The bug this pins: a design's name was the topic box hard-sliced at 80
// characters, so a brief composed by the idea picker landed on the Content
// Studio card as "...(and what isn't) What i" — a sentence cut mid-word with
// the start of the generator's instructions hanging off it.
import assert from "node:assert/strict";

import { titleFrom } from "./title";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const HOOK = "What's actually in your sweat after an infrared session (and what isn't)";
const BRIEF = `${HOOK}\n\nWhat it should teach: sweat is mostly water and electrolytes.\n\nIt rests on: the composition of eccrine sweat.`;

check("a brief becomes its hook", titleFrom(BRIEF) === HOOK);
check("a plain title is left alone", titleFrom("Five ways to sleep better") === "Five ways to sleep better");
check("whitespace collapses", titleFrom("  Deep   tissue\ttherapy  ") === "Deep tissue therapy");

// The rows already in the database: the newline is gone, so only the
// lead-in strip can rescue them.
check(
  "a name sliced mid-brief loses the dangling lead-in",
  titleFrom(`${HOOK} What i`) === HOOK,
);
check(
  "a whole lead-in goes too",
  titleFrom(`${HOOK} What it should teach:`) === HOOK,
);

const LONG = "Why cold exposure before bed is the single worst piece of recovery advice still circulating in gyms today";
const cut = titleFrom(LONG, 60);
check("an over-long title is truncated", cut.length <= 61 && cut.endsWith("…"));
check("it is cut on a word boundary", LONG.startsWith(cut.slice(0, -1)));
check("no punctuation is left hanging before the ellipsis", !/[\s,;:.]…$/.test(cut));

// The other legacy shape: the 80-character slice landed inside the hook
// itself, so there is no lead-in to strip — only the fragment.
const SLICED = "How to work out roughly how much protein you actually need — and why 'eat more c";
check("an 80-char slice loses its fragment word", titleFrom(SLICED) === "How to work out roughly how much protein you actually need — and why 'eat more…");
check(
  "a real 80-char title that ends cleanly is left alone",
  titleFrom("Deep tissue work hurts less than people expect, and here is the reason it does.").length === 79,
);

const ONE_WORD = "Supercalifragilisticexpialidocious".repeat(3);
check("one enormous word still yields a title", titleFrom(ONE_WORD, 20).length === 21);

console.log(`\n${passed} checks passed`);
