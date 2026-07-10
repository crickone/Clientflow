/**
 * Client-safe transcript text editing. Lets the editor fix a caption by
 * rewriting one transcript segment's text while keeping word-level timings
 * aligned (1:1 when the word count is unchanged, evenly redistributed
 * otherwise). Mirrors the logic that lived in the old ProjectDetail editor.
 */
import type {
  Transcript,
  TranscriptSegment,
  TranscriptWord,
} from "@/lib/ai/transcribe";

function reTokenizeSegmentWords(
  segStart: number,
  segEnd: number,
  newText: string,
  oldWords: TranscriptWord[],
): TranscriptWord[] {
  const tokens = newText
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];
  if (tokens.length === oldWords.length) {
    return tokens.map((t, i) => ({
      word: t,
      start: oldWords[i].start,
      end: oldWords[i].end,
    }));
  }
  const span = Math.max(segEnd - segStart, 0.2);
  const perWord = span / tokens.length;
  return tokens.map((t, i) => ({
    word: t,
    start: Number((segStart + i * perWord).toFixed(3)),
    end: Number((segStart + (i + 1) * perWord).toFixed(3)),
  }));
}

/** Return a new transcript with one segment's text (and its words) replaced. */
export function applySegmentTextEdit(
  transcript: Transcript,
  segmentId: number,
  newText: string,
): Transcript {
  const newSegments: TranscriptSegment[] = [];
  const newWords: TranscriptWord[] = [];
  for (const seg of transcript.segments) {
    const wordsInSeg = transcript.words.filter(
      (w) => w.start >= seg.start - 0.001 && w.start < seg.end + 0.001,
    );
    if (seg.id === segmentId) {
      const rebuilt = reTokenizeSegmentWords(
        seg.start,
        seg.end,
        newText,
        wordsInSeg,
      );
      newWords.push(...rebuilt);
      newSegments.push({ ...seg, text: rebuilt.map((w) => w.word).join(" ") });
    } else {
      newWords.push(...wordsInSeg);
      newSegments.push(seg);
    }
  }
  newWords.sort((a, b) => a.start - b.start);
  return {
    ...transcript,
    segments: newSegments,
    words: newWords,
    text: newSegments.map((s) => s.text).join(" "),
  };
}
