/**
 * The editable "edit document" for the CapCut-style video editor, and the pure
 * geometry that maps between the MAIN SOURCE clip's timeline and the OUTPUT
 * timeline the viewer sees.
 *
 * This module is intentionally environment-agnostic (no `server-only`, no
 * ffmpeg/trim imports) so the browser preview engine and the server renderer
 * share exactly the same math. Anything that needs ffmpeg/silence-detection
 * (e.g. synthesizing the first cut) lives in `firstCut.ts` instead.
 */

import type { TranscriptWord } from "@/lib/ai/transcribe";

/** One slice of the main source clip. `mainSegments` in order = "the cut". */
export interface MainSegment {
  /** Start time in the MAIN SOURCE clip (seconds). */
  sourceStart: number;
  /** End time in the MAIN SOURCE clip (seconds). */
  sourceEnd: number;
}

/** A B-roll cutaway, positioned in OUTPUT-timeline coordinates. */
export interface TimelineBrollInsert {
  /** Where the cutaway begins in the output timeline (seconds). */
  startSec: number;
  /** Where the cutaway ends in the output timeline (seconds). */
  endSec: number;
  brollAssetId: number;
  /** Which second of the B-roll SOURCE to start playing from (default 0). */
  brollStartSec?: number;
  /** Optional note (AI reason / "manual edit"). */
  reason?: string;
}

export interface TimelineDoc {
  mainSegments: MainSegment[];
  brollInserts: TimelineBrollInsert[];
}

export function segmentLength(seg: MainSegment): number {
  return Math.max(0, seg.sourceEnd - seg.sourceStart);
}

/** Total length of the output timeline = sum of segment lengths. */
export function outputDuration(segments: MainSegment[]): number {
  return segments.reduce((acc, s) => acc + segmentLength(s), 0);
}

interface LaidOutSegment extends MainSegment {
  length: number;
  /** Where this segment starts in the OUTPUT timeline. */
  outputStart: number;
}

/** Stack segments end-to-end onto the output timeline (handles reorder). */
export function layoutSegments(segments: MainSegment[]): LaidOutSegment[] {
  let acc = 0;
  return segments.map((s) => {
    const length = segmentLength(s);
    const out = { ...s, length, outputStart: acc };
    acc += length;
    return out;
  });
}

/**
 * Map an OUTPUT-timeline time to a position in the MAIN SOURCE clip. Returns
 * which segment is playing and where in the source to seek. Used by the
 * preview player to drive the single <video> element across cuts/reorders.
 */
export function mapOutputToSource(
  segments: MainSegment[],
  outputSec: number,
): { segmentIndex: number; sourceTime: number } | null {
  const laid = layoutSegments(segments);
  if (laid.length === 0) return null;
  const total = laid[laid.length - 1].outputStart + laid[laid.length - 1].length;
  const t = Math.max(0, Math.min(outputSec, total));
  for (let i = 0; i < laid.length; i++) {
    const s = laid[i];
    // Last segment owns its trailing edge so t === total still resolves.
    const isLast = i === laid.length - 1;
    if (t >= s.outputStart && (t < s.outputStart + s.length || isLast)) {
      return { segmentIndex: i, sourceTime: s.sourceStart + (t - s.outputStart) };
    }
  }
  return null;
}

/**
 * Map a MAIN SOURCE time to the OUTPUT timeline. Because segments can be
 * reordered or duplicated, a source time may map to several output positions;
 * we return the FIRST (lowest output time) match, or null if the source time
 * falls in a cut-out region.
 */
export function mapSourceToOutput(
  segments: MainSegment[],
  sourceSec: number,
): number | null {
  const laid = layoutSegments(segments);
  for (const s of laid) {
    if (sourceSec >= s.sourceStart && sourceSec <= s.sourceEnd) {
      return s.outputStart + (sourceSec - s.sourceStart);
    }
  }
  return null;
}

/**
 * Re-time the word-level transcript onto the output timeline. Each word is
 * assigned to the (output-ordered) segment containing its MIDPOINT, so words
 * inside cut-out regions vanish and reordered segments carry their words with
 * them. Words crushed below a readable minimum get a small floor so captions
 * still render (mirrors the old `remapWords`).
 */
export function remapWordsThroughSegments(
  words: TranscriptWord[],
  segments: MainSegment[],
): TranscriptWord[] {
  const MIN_DURATION_SEC = 0.12;
  const laid = layoutSegments(segments);
  const out: TranscriptWord[] = [];

  for (const w of words) {
    if (!w.word.trim()) continue;
    const mid = (w.start + w.end) / 2;
    const seg = laid.find((s) => mid >= s.sourceStart && mid < s.sourceEnd);
    if (!seg) continue; // word's midpoint is in a cut-out region
    const startInSeg = Math.max(0, w.start - seg.sourceStart);
    const endInSeg = Math.min(seg.length, w.end - seg.sourceStart);
    out.push({
      word: w.word,
      start: seg.outputStart + startInSeg,
      end: seg.outputStart + Math.max(startInSeg, endInSeg),
    });
  }

  out.sort((a, b) => a.start - b.start);

  // Floor any zero/short durations so fast words still show.
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    if (w.end - w.start < MIN_DURATION_SEC) {
      const nextStart = out[i + 1]?.start ?? Infinity;
      let end = Math.min(w.start + MIN_DURATION_SEC, nextStart);
      if (end <= w.start) end = w.start + 0.04;
      out[i] = { ...w, end };
    }
  }
  return out;
}

/** A single full-length segment for a clip of the given duration. */
export function fullClipSegment(durationSeconds: number): MainSegment {
  return { sourceStart: 0, sourceEnd: Math.max(durationSeconds, 0.1) };
}

// ── Editing operations (pure: return a new TimelineDoc) ────────────────────
// On structural main-track edits the output timeline changes length, so we
// clamp B-roll inserts to the new total (dropping any that no longer fit).
// Predictable for v1 — the user re-drags b-roll after restructuring if needed.

const MIN_SEG_SEC = 0.2;
const MIN_BROLL_SEC = 0.4;

function clampBroll(
  inserts: TimelineBrollInsert[],
  total: number,
): TimelineBrollInsert[] {
  return inserts
    .map((b) => ({ ...b, endSec: Math.min(b.endSec, total) }))
    .filter((b) => b.startSec >= 0 && b.startSec < total && b.endSec - b.startSec >= MIN_BROLL_SEC);
}

/** Split the segment under `atOutputSec` into two at that point. */
export function splitSegment(doc: TimelineDoc, atOutputSec: number): TimelineDoc {
  const laid = layoutSegments(doc.mainSegments);
  const out: MainSegment[] = [];
  for (const s of laid) {
    const localStart = s.outputStart + MIN_SEG_SEC;
    const localEnd = s.outputStart + s.length - MIN_SEG_SEC;
    if (atOutputSec > localStart && atOutputSec < localEnd) {
      const srcSplit = s.sourceStart + (atOutputSec - s.outputStart);
      out.push({ sourceStart: s.sourceStart, sourceEnd: srcSplit });
      out.push({ sourceStart: srcSplit, sourceEnd: s.sourceEnd });
    } else {
      out.push({ sourceStart: s.sourceStart, sourceEnd: s.sourceEnd });
    }
  }
  return { ...doc, mainSegments: out };
}

/** Remove a segment (never the last remaining one); gap closes automatically. */
export function deleteSegment(doc: TimelineDoc, idx: number): TimelineDoc {
  if (idx < 0 || idx >= doc.mainSegments.length) return doc;
  if (doc.mainSegments.length <= 1) return doc;
  const segs = doc.mainSegments.filter((_, i) => i !== idx);
  return { mainSegments: segs, brollInserts: clampBroll(doc.brollInserts, outputDuration(segs)) };
}

/** Move a segment from one index to another (reorder). */
export function reorderSegment(doc: TimelineDoc, from: number, to: number): TimelineDoc {
  const segs = [...doc.mainSegments];
  if (from < 0 || from >= segs.length || to < 0 || to >= segs.length || from === to) {
    return doc;
  }
  const [moved] = segs.splice(from, 1);
  segs.splice(to, 0, moved);
  return { ...doc, mainSegments: segs };
}

/**
 * Change a segment's in/out points (trim or extend its edges). Bounds are
 * clamped to [0, maxSourceSec] with a minimum length.
 */
export function trimSegment(
  doc: TimelineDoc,
  idx: number,
  newSourceStart: number,
  newSourceEnd: number,
  maxSourceSec: number,
): TimelineDoc {
  if (idx < 0 || idx >= doc.mainSegments.length) return doc;
  const lo = Math.max(0, Math.min(newSourceStart, maxSourceSec - MIN_SEG_SEC));
  const hi = Math.min(maxSourceSec, Math.max(newSourceEnd, lo + MIN_SEG_SEC));
  const segs = doc.mainSegments.map((s, i) =>
    i === idx ? { sourceStart: lo, sourceEnd: hi } : s,
  );
  return { mainSegments: segs, brollInserts: clampBroll(doc.brollInserts, outputDuration(segs)) };
}

/** Append a b-roll insert, then clamp + sort by start. */
export function addBroll(doc: TimelineDoc, insert: TimelineBrollInsert): TimelineDoc {
  const total = outputDuration(doc.mainSegments);
  const next = clampBroll([...doc.brollInserts, insert], total).sort(
    (a, b) => a.startSec - b.startSec,
  );
  return { ...doc, brollInserts: next };
}

/** Patch one b-roll insert. */
export function updateBroll(
  doc: TimelineDoc,
  idx: number,
  patch: Partial<TimelineBrollInsert>,
): TimelineDoc {
  if (idx < 0 || idx >= doc.brollInserts.length) return doc;
  const next = doc.brollInserts.map((b, i) => (i === idx ? { ...b, ...patch } : b));
  return { ...doc, brollInserts: next };
}

/** Remove a b-roll insert. */
export function removeBroll(doc: TimelineDoc, idx: number): TimelineDoc {
  if (idx < 0 || idx >= doc.brollInserts.length) return doc;
  return { ...doc, brollInserts: doc.brollInserts.filter((_, i) => i !== idx) };
}

/**
 * Remap b-roll inserts whose times are in MAIN-SOURCE coordinates (e.g. a fresh
 * AI plan, which is built against the full transcript) onto the current OUTPUT
 * timeline. Inserts whose source window falls entirely in a cut-out region are
 * dropped; the rest land at the right output moment even after trims/reorders.
 */
export function remapBrollSourceToOutput(
  inserts: TimelineBrollInsert[],
  segments: MainSegment[],
): TimelineBrollInsert[] {
  const total = outputDuration(segments);
  const out: TimelineBrollInsert[] = [];
  for (const ins of inserts) {
    const s = mapSourceToOutput(segments, ins.startSec);
    if (s == null) continue;
    const eMapped = mapSourceToOutput(segments, ins.endSec);
    const e = eMapped ?? Math.min(total, s + (ins.endSec - ins.startSec));
    if (e - s < MIN_BROLL_SEC) continue;
    out.push({ ...ins, startSec: s, endSec: e });
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

/** Parse a stored timelineJson, or null if absent/invalid. */
export function parseTimeline(json: string | null | undefined): TimelineDoc | null {
  if (!json) return null;
  try {
    const doc = JSON.parse(json) as TimelineDoc;
    if (!Array.isArray(doc.mainSegments) || !Array.isArray(doc.brollInserts)) {
      return null;
    }
    return doc;
  } catch {
    return null;
  }
}
