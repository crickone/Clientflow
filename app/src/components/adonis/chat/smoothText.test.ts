// Run: npm test -- src/components/adonis/chat/smoothText.test.ts
//
// How fast a streaming answer is revealed: whole words at an even pace,
// faster when far behind, never more than about 1.5 s behind what has
// arrived, and never stuck.
import assert from "node:assert/strict";

import {
  advance,
  commonPrefix,
  MAX_BACKLOG_CHARS,
  nextWordEnd,
  wordStartAtOrBefore,
  type RevealState,
} from "./smoothText";

assert.equal(nextWordEnd("Hello big world", 0), 5);
assert.equal(nextWordEnd("Hello big world", 5), 9, "skips the space, then the word");
assert.equal(nextWordEnd("Hello", 2), 5);
assert.equal(wordStartAtOrBefore("Hello big world", 7), 6);
assert.equal(commonPrefix("abcd", "abxy"), 2);

// Whole words only.
const text = "The massage offer is ahead of the bundle this week.";
let s: RevealState = { shown: 0, carry: 0 };
const stops = new Set<number>();
for (let i = 0; i < 300; i++) {
  s = advance(text, s, 16);
  stops.add(s.shown);
}
assert.equal(s.shown, text.length, "it finishes");
for (const n of stops) assert.ok(n === 0 || n === text.length || /\s/.test(text[n]), `never stops mid-word (stopped at ${n})`);

// A short frame shows nothing yet but keeps what it earned.
const one = advance("Hello world", { shown: 0, carry: 0 }, 16);
assert.equal(one.shown, 0);
assert.ok(one.carry > 1.4 && one.carry < 1.5, "the budget carries to the next frame");

// While streaming, a word still being written waits; finished text shows it.
assert.equal(advance("Hello wor", { shown: 0, carry: 0 }, 250, { holdTail: true }).shown, 5);
assert.equal(advance("Hello wor", { shown: 0, carry: 0 }, 250).shown, 9);

// A very long word (a link) still comes out.
const link = `See https://adonisagent.ie/${"x".repeat(70)} now`;
let l: RevealState = { shown: 0, carry: 0 };
for (let i = 0; i < 400; i++) l = advance(link, l, 16);
assert.equal(l.shown, link.length, "a word longer than any one frame's budget is not stuck");

// A huge backlog (a reconnect) jumps instead of crawling.
const long = "word ".repeat(400);
const jumped = advance(long, { shown: 0, carry: 0 }, 16);
assert.ok(long.length - jumped.shown <= MAX_BACKLOG_CHARS, "never more than the backlog cap behind");

// Streaming at 200 characters a second, the reveal stays within about 1.5 s.
let target = "";
let st: RevealState = { shown: 0, carry: 0 };
let worstLagMs = 0;
for (let t = 0; t < 5000; t += 16) {
  while (target.length < Math.floor((t / 1000) * 200)) target += "word ";
  st = advance(target, st, 16, { holdTail: true });
  if (t > 1000) worstLagMs = Math.max(worstLagMs, ((target.length - st.shown) / 200) * 1000);
}
assert.ok(worstLagMs <= 1700, `lag stays near 1.5 s (worst ${Math.round(worstLagMs)} ms)`);

// When the run ends, the rest drains fast.
const fin = advance("word ".repeat(100), { shown: 0, carry: 0 }, 100, { lagMs: 350 });
assert.ok(fin.shown >= 135, "finishing uses a much shorter lag");

console.log("smoothText: all checks passed");
