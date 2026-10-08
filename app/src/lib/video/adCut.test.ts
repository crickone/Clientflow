// Run: npx tsx src/lib/video/adCut.test.ts
import assert from "node:assert/strict";

import { adSegmentsFromIds, fallbackAdSegments } from "./adCut";

const sentences = [
  { id: 0, start: 0, end: 4.2, text: "Hi, I'm Aoife." },
  { id: 1, start: 4.2, end: 9.8, text: "Most people feel the difference by the third session." },
  { id: 2, start: 9.8, end: 16, text: "You lie down, the chamber closes, and you rest for an hour." },
];
const words = [
  { word: "Hi", start: 0.6, end: 0.9 }, { word: "I'm", start: 1.0, end: 1.2 }, { word: "Aoife", start: 1.2, end: 1.7 },
  { word: "Most", start: 4.5, end: 4.8 }, { word: "people", start: 4.8, end: 5.2 }, { word: "session", start: 9.0, end: 9.5 },
  { word: "You", start: 10.1, end: 10.3 }, { word: "lie", start: 10.3, end: 10.6 }, { word: "rest", start: 14.0, end: 14.4 }, { word: "hour", start: 15.0, end: 15.5 },
];

// Hook first, out of the original order; tightened to the words.
const seg = adSegmentsFromIds([1, 2, 1, 99], sentences, words, 16, 30);
assert.equal(seg.length, 2, "a repeated and an unknown id are dropped");
assert.deepEqual(seg[0], { sourceStart: 4.42, sourceEnd: 9.58 });
assert.equal(seg[1].sourceStart, 10.02);

// The cap ends on a whole word, not mid-sentence.
const capped = adSegmentsFromIds([1, 2], sentences, words, 16, 8);
const total = capped.reduce((a, s) => a + (s.sourceEnd - s.sourceStart), 0);
assert.ok(total <= 8.0001, `total ${total} over the cap`);
assert.ok(capped.length >= 1);
const last = capped[capped.length - 1];
assert.ok(words.some((w) => Math.abs(w.end + 0.08 - last.sourceEnd) < 0.011), "ends just after a word");

// Fallback plays from the start.
assert.equal(fallbackAdSegments(sentences, words, 16, 30)[0].sourceStart, 0.52);

console.log("adCut: all checks passed.");
