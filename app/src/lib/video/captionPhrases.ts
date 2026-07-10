/**
 * Client-safe caption layout + phrase grouping. Shared by the server renderer
 * (`captions.ts`, which burns ASS subtitles) and the browser preview overlay
 * (`PreviewStage`), so the live captions match the exported ones: same 2–3
 * word phrases, same timing, same bottom-centre placement.
 *
 * No `server-only` / node imports here — it must import cleanly in the browser.
 */

import type { TranscriptWord } from "@/lib/ai/transcribe";

export type AspectRatio = "9:16" | "1:1";

export interface CaptionConfig {
  aspectRatio: AspectRatio;
  width: number;
  height: number;
  fontSize: number;
  /** Distance from the bottom of the frame to the caption baseline (px). */
  marginVBottom: number;
}

export function configFor(aspectRatio: AspectRatio): CaptionConfig {
  if (aspectRatio === "9:16") {
    return {
      aspectRatio,
      width: 1080,
      height: 1920,
      fontSize: 110,
      marginVBottom: 380,
    };
  }
  return {
    aspectRatio,
    width: 1080,
    height: 1080,
    fontSize: 90,
    marginVBottom: 220,
  };
}

export interface CaptionPhrase {
  start: number;
  end: number;
  text: string;
}

const SENTENCE_END_RE = /[.!?]$/;
const PHRASE_GAP_SEC = 0.35;
const PHRASE_MIN_WORDS = 2;
const PHRASE_MAX_WORDS = 3;
/**
 * Hard cap on rendered characters per phrase (including spaces). Anything
 * longer overflows the safe area on a 1080-wide canvas at our caption font
 * size, so we break the phrase early.
 */
const PHRASE_MAX_CHARS = 22;

/**
 * Group consecutive Whisper words into 2–3-word phrases so captions read as
 * short bursts. A new phrase starts at the word cap, a clear pause (>=350ms),
 * sentence-final punctuation, or the character cap. Duplicated stutter-words
 * from Whisper are filtered.
 */
export function groupIntoPhrases(words: TranscriptWord[]): CaptionPhrase[] {
  const phrases: CaptionPhrase[] = [];
  let current: { words: TranscriptWord[]; start: number; end: number } | null =
    null;
  let lastKeptText = "";
  let lastKeptEnd = -Infinity;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const clean = w.word.trim();
    if (!clean) continue;
    const cleanLower = clean.toLowerCase().replace(/[^a-z0-9']/gi, "");
    const isDuplicate =
      cleanLower !== "" &&
      cleanLower === lastKeptText &&
      w.start < lastKeptEnd + 0.05;
    if (isDuplicate) continue;
    lastKeptText = cleanLower;
    lastKeptEnd = w.end;
    const prev = current ? current.words[current.words.length - 1] : null;
    const gap = prev ? w.start - prev.end : 0;
    const sentenceBreak = prev ? SENTENCE_END_RE.test(prev.word.trim()) : false;
    const fullEnough = current && current.words.length >= PHRASE_MAX_WORDS;
    const currentLen = current
      ? current.words.map((x) => x.word.trim()).join(" ").length
      : 0;
    const tooLong =
      current &&
      current.words.length >= 1 &&
      currentLen + 1 + clean.length > PHRASE_MAX_CHARS;
    const naturalBreak =
      current &&
      current.words.length >= PHRASE_MIN_WORDS &&
      (gap >= PHRASE_GAP_SEC || sentenceBreak);
    if (!current || fullEnough || naturalBreak || tooLong) {
      if (current) {
        phrases.push({
          start: current.start,
          end: current.end,
          text: current.words.map((x) => x.word.trim()).join(" "),
        });
      }
      current = { words: [w], start: w.start, end: w.end };
    } else {
      current.words.push(w);
      current.end = w.end;
    }
  }
  if (current) {
    phrases.push({
      start: current.start,
      end: current.end,
      text: current.words.map((x) => x.word.trim()).join(" "),
    });
  }
  return phrases;
}

/**
 * Phrases ready for display: uppercased text + a display end time that holds
 * each phrase until the next begins (200ms minimum), matching the renderer.
 */
export function phrasesForDisplay(words: TranscriptWord[]): CaptionPhrase[] {
  const phrases = groupIntoPhrases(words);
  const out: CaptionPhrase[] = [];
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i];
    const next = phrases[i + 1];
    const start = p.start;
    const naturalEnd = next ? next.start : p.end + 0.25;
    const end = Math.max(naturalEnd, start + 0.2);
    const text = p.text.trim().toUpperCase();
    if (text) out.push({ start, end, text });
  }
  return out;
}

/** The active caption phrase at a given output time, or null. */
export function activePhrase(
  phrases: CaptionPhrase[],
  t: number,
): CaptionPhrase | null {
  for (const p of phrases) {
    if (t >= p.start && t < p.end) return p;
  }
  return null;
}
