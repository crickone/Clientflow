import "server-only";

import type { TranscriptWord } from "@/lib/ai/transcribe";

export interface TimeRange {
  start: number;
  end: number;
}

export interface TrimConfig {
  /** Gaps longer than this many seconds get trimmed. */
  silenceThresholdSec: number;
  /** When a gap is trimmed, this much pause is kept (split evenly). */
  keptPauseSec: number;
  /** Padding kept before the first word. */
  leadingPadSec: number;
  /** Padding kept after the last word. */
  trailingPadSec: number;
  /** Small breathing room around every word so consonants don't get clipped. */
  wordPadSec: number;
}

export const DEFAULT_TRIM_CONFIG: TrimConfig = {
  // Only trim gaps that are clearly intentional pauses, not regular speech
  // breathing room. Bumped from 0.6 → 0.9 so words at the end of a clause
  // don't get clipped when Whisper's end-time is slightly off.
  silenceThresholdSec: 0.9,
  // When we DO trim, keep a more natural-sounding beat between sentences.
  keptPauseSec: 0.25,
  leadingPadSec: 0.25,
  trailingPadSec: 0.4,
  // Per-word buffer — bumped from 60ms to 200ms so trailing consonants
  // ("ing", "s", "t") never get clipped, even if Whisper's word.end
  // timestamp lands a touch early.
  wordPadSec: 0.2,
};

/**
 * From a word-level transcript, work out which time ranges of the original
 * video to keep. Long silences (longer than the threshold) get squeezed
 * down to `keptPauseSec`; short pauses pass through untouched.
 */
export function computeKeepRanges(
  words: TranscriptWord[],
  totalDuration: number,
  cfg: TrimConfig = DEFAULT_TRIM_CONFIG,
): TimeRange[] {
  if (words.length === 0) {
    return [{ start: 0, end: totalDuration }];
  }

  const ranges: TimeRange[] = words.map((w) => ({
    start: Math.max(0, w.start - cfg.wordPadSec),
    end: Math.min(totalDuration, w.end + cfg.wordPadSec),
  }));

  const merged: TimeRange[] = [{ ...ranges[0] }];
  for (let i = 1; i < ranges.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = ranges[i];
    const gap = cur.start - prev.end;
    if (gap <= 0) {
      prev.end = Math.max(prev.end, cur.end);
    } else if (gap <= cfg.silenceThresholdSec) {
      // Short pause — keep it natural by joining the ranges.
      prev.end = cur.end;
    } else {
      // Long silence — keep half a "kept pause" on each side, drop the middle.
      const half = cfg.keptPauseSec / 2;
      prev.end = Math.min(prev.end + half, cur.start);
      const newStart = Math.max(cur.start - half, prev.end);
      merged.push({ start: newStart, end: cur.end });
    }
  }

  merged[0].start = Math.max(0, words[0].start - cfg.leadingPadSec);
  merged[merged.length - 1].end = Math.min(
    totalDuration,
    words[words.length - 1].end + cfg.trailingPadSec,
  );

  return merged;
}

export interface TimeRemap {
  /** Map an original-timeline timestamp to its new (trimmed-timeline) timestamp. */
  remap: (origSec: number) => number;
  /** Duration of the trimmed timeline. */
  newDuration: number;
  /** Total seconds removed from the original. */
  removedSec: number;
  /** Original keep ranges, in order. */
  ranges: TimeRange[];
}

export function buildTimeRemap(ranges: TimeRange[]): TimeRemap {
  let acc = 0;
  const layout = ranges.map((r) => {
    const newStart = acc;
    const length = Math.max(0, r.end - r.start);
    acc += length;
    return { start: r.start, end: r.end, length, newStart };
  });
  const newDuration = acc;
  const originalSpan =
    ranges.length > 0
      ? ranges[ranges.length - 1].end - ranges[0].start
      : 0;
  const removedSec = Math.max(0, originalSpan - newDuration);

  function remap(origSec: number): number {
    if (layout.length === 0) return origSec;
    if (origSec <= layout[0].start) return 0;
    if (origSec >= layout[layout.length - 1].end) return newDuration;
    for (let i = 0; i < layout.length; i++) {
      const r = layout[i];
      if (origSec >= r.start && origSec <= r.end) {
        return r.newStart + (origSec - r.start);
      }
      // Falls in a trimmed gap before the next kept range → snap forward.
      if (i + 1 < layout.length && origSec < layout[i + 1].start) {
        return r.newStart + r.length;
      }
    }
    return newDuration;
  }

  return { remap, newDuration, removedSec, ranges };
}

/**
 * Apply a remap to the word-level transcript so captions appear at their new
 * timestamps. Words that get crushed to zero duration (entirely inside a
 * removed silence) are dropped.
 */
export function remapWords(
  words: TranscriptWord[],
  remap: TimeRemap,
): TranscriptWord[] {
  // Whisper sometimes returns words with zero or near-zero duration
  // (start === end), especially for fast-spoken or low-confidence words like
  // "sending", "and", "keeping". Previously we dropped any word whose
  // remapped duration was <= 20 ms, which silently removed those words from
  // the captions. Instead, give every word at least a 120 ms display so it
  // still renders, ending no later than the next word's start.
  const MIN_DURATION_SEC = 0.12;
  const remapped = words.map((w) => ({
    word: w.word,
    start: remap.remap(w.start),
    end: remap.remap(w.end),
  }));
  const out: TranscriptWord[] = [];
  for (let i = 0; i < remapped.length; i++) {
    const w = remapped[i];
    if (!w.word.trim()) continue;
    let end = w.end;
    if (end - w.start < MIN_DURATION_SEC) {
      const nextStart = remapped[i + 1]?.start ?? Infinity;
      end = Math.min(w.start + MIN_DURATION_SEC, nextStart);
      // Ensure forward progress even when the next word also starts here.
      if (end <= w.start) end = w.start + 0.04;
    }
    out.push({ word: w.word, start: w.start, end });
  }
  return out;
}

/** Build an ffmpeg expression that selects only the kept ranges. */
export function selectExpr(ranges: TimeRange[]): string {
  if (ranges.length === 0) return "1";
  return ranges
    .map((r) => `between(t,${r.start.toFixed(3)},${r.end.toFixed(3)})`)
    .join("+");
}
