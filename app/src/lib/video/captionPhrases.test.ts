// Run: npm test -- src/lib/video/captionPhrases.test.ts
//
// Caption phrase grouping + the per-word timings behind the "word pop"
// highlight (the modern short-form caption look). captionPhrases.ts is the
// SHARED module: the ffmpeg renderer (captions.ts → ASS) and the browser
// preview (PreviewStage) both build from it, so preview == export. These
// checks pin the invariants the highlight depends on:
//   1. every phrase carries its words, and they reconstruct the phrase text;
//   2. word timings are non-decreasing and sit inside the phrase's span
//      (the ASS \t() offsets are computed from them — bad ordering would make
//      the highlight jump around or fire before the phrase appears);
//   3. phrasesForDisplay uppercases the per-word text too (the burned-in
//      captions are ALL CAPS, so the preview must match).
import assert from "node:assert/strict";

import { groupIntoPhrases, phrasesForDisplay } from "./captionPhrases";
import type { TranscriptWord } from "@/lib/ai/transcribe";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
}

const w = (word: string, start: number, end: number): TranscriptWord => ({
  word,
  start,
  end,
});

// A short line with a clear pause after "gym." to force a phrase break.
const WORDS: TranscriptWord[] = [
  w("Can't", 0.0, 0.3),
  w("afford", 0.3, 0.7),
  w("the", 0.7, 0.8),
  w("gym.", 0.8, 1.2),
  w("Here's", 1.8, 2.1),
  w("how", 2.1, 2.3),
];

const phrases = groupIntoPhrases(WORDS);
ok("groups into more than one phrase", phrases.length > 1);

for (const p of phrases) {
  ok(`phrase "${p.text}" carries its words`, p.words.length > 0);
  assert.strictEqual(
    p.words.map((x) => x.text).join(" "),
    p.text,
    `phrase words must reconstruct the phrase text ("${p.text}")`,
  );
  passed++;
  // Timings: ordered, and within the phrase span (ASS \t offsets rely on this).
  for (let i = 0; i < p.words.length; i++) {
    const word = p.words[i];
    ok(`"${word.text}" start <= end`, word.start <= word.end);
    ok(`"${word.text}" starts at/after phrase start`, word.start >= p.start - 1e-9);
    ok(`"${word.text}" ends at/before phrase end`, word.end <= p.end + 1e-9);
    if (i > 0) {
      ok(
        `"${word.text}" starts at/after the previous word`,
        word.start >= p.words[i - 1].start - 1e-9,
      );
    }
  }
}

// Display phrases are uppercased — including the per-word text the preview
// renders, otherwise the highlight would show lowercase words over ALL-CAPS
// burned-in captions.
const display = phrasesForDisplay(WORDS);
ok("display phrases produced", display.length > 0);
for (const p of display) {
  assert.strictEqual(p.text, p.text.toUpperCase(), "phrase text is uppercase");
  passed++;
  for (const word of p.words) {
    assert.strictEqual(
      word.text,
      word.text.toUpperCase(),
      `word "${word.text}" is uppercase for display`,
    );
    passed++;
  }
  assert.strictEqual(
    p.words.map((x) => x.text).join(" "),
    p.text,
    "display words still reconstruct the display text",
  );
  passed++;
}

// A phrase with no words must not crash the renderer's highlight builder —
// it falls back to the plain phrase text (guarded in captions.ts).
ok("empty transcript yields no phrases", groupIntoPhrases([]).length === 0);

console.log(`captionPhrases.test.ts: all ${passed} assertions passed`);
