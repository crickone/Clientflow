/**
 * Turning the sentences an ad should use into the main-track cut. Pure.
 *
 * The model picks transcript SENTENCES by id, in the order the ad should play
 * them (the strongest line first, as the hook); this module looks the times
 * up. The model never writes a timestamp, so it cannot invent one or cut a
 * word in half.
 */
import type { TranscriptSegment, TranscriptWord } from "@/lib/ai/transcribe";
import type { MainSegment } from "./timeline";

const PAD = 0.08;
const MIN_LEN = 0.5;

/**
 * Sentence ids -> main segments, in the given order. Unknown and repeated ids
 * are dropped; each sentence is tightened to its first and last spoken word
 * (Whisper's sentence bounds include the silence around them); the total is
 * capped at `maxSec`, trimming the last sentence to a word boundary rather
 * than mid-word.
 */
export function adSegmentsFromIds(
  ids: number[],
  sentences: TranscriptSegment[],
  words: TranscriptWord[],
  durationSec: number,
  maxSec: number,
): MainSegment[] {
  const byId = new Map(sentences.map((s) => [s.id, s]));
  const seen = new Set<number>();
  const out: MainSegment[] = [];
  let total = 0;
  for (const id of ids) {
    const s = byId.get(id);
    if (!s || seen.has(id)) continue;
    seen.add(id);
    const inside = words.filter((w) => w.start >= s.start - 0.05 && w.end <= s.end + 0.05 && w.word.trim());
    let start = Math.max(0, (inside[0]?.start ?? s.start) - PAD);
    let end = Math.min(durationSec, (inside[inside.length - 1]?.end ?? s.end) + PAD);
    if (end - start < MIN_LEN) continue;
    if (total + (end - start) > maxSec) {
      // Fit what is left by ending on the last whole word that fits.
      const room = maxSec - total;
      const fits = inside.filter((w) => w.end + PAD - start <= room);
      if (fits.length < 2) break;
      end = Math.min(durationSec, fits[fits.length - 1].end + PAD);
    }
    start = Math.round(start * 100) / 100;
    end = Math.round(end * 100) / 100;
    out.push({ sourceStart: start, sourceEnd: end });
    total += end - start;
    if (total >= maxSec - 0.3) break;
  }
  return out;
}

/** When the model gives nothing usable: the clip from the start, sentence by sentence, up to the cap. */
export function fallbackAdSegments(sentences: TranscriptSegment[], words: TranscriptWord[], durationSec: number, maxSec: number): MainSegment[] {
  return adSegmentsFromIds(sentences.map((s) => s.id), sentences, words, durationSec, maxSec);
}
