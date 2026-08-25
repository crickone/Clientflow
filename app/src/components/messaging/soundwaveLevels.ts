/**
 * Pure, DOM-free helpers behind the recording soundwave (`Soundwave.tsx`) —
 * downsampling an AnalyserNode's byte frequency data into a fixed number of
 * normalized bar levels. Split out for the same reason as this directory's
 * `voiceInput.ts` (see that file's doc comment): everything actually
 * touching AudioContext/AnalyserNode/canvas is a browser API this repo can't
 * unit-test headlessly, so this is the one piece of the visualizer's logic
 * that can be — `npm run typecheck` + `npx next build` are the gate for
 * `Soundwave.tsx` itself.
 *
 * Named `soundwaveLevels` rather than `soundwave` deliberately — a
 * `soundwave.ts` alongside `Soundwave.tsx` differs only in case, which
 * breaks TS module resolution on case-insensitive filesystems (macOS
 * default): an extension-less `import ... from "./Soundwave"` can resolve
 * to the wrong file.
 */

/**
 * Default floor for a bar's normalized level (0..1) — even a silent mic
 * renders a gentle idle wave instead of flat-zero bars. Exported so
 * `Soundwave.tsx` and this file's test agree on the same constant.
 */
export const SOUNDWAVE_MIN_LEVEL = 0.06;

/**
 * Buckets `data` (an AnalyserNode's `getByteFrequencyData` output — one byte
 * per frequency bin, 0-255) into `barCount` contiguous groups, averaging
 * each group and normalizing it to a 0..1 level with a `minLevel` floor.
 * Bucket boundaries are spread as evenly as `data.length`/`barCount` allows
 * (the last bucket in a group absorbs any remainder), so this works both for
 * the intended case (~30 bars over a ~128-bin analyser) and for `barCount` >
 * `data.length` (multiple bars can land on the same bin; never reads out of
 * range either way).
 *
 * Returns `[]` for a non-positive `barCount` or empty `data` — nothing to
 * draw. Takes `ArrayLike<number>` (not specifically `Uint8Array`) so plain
 * arrays exercise it directly in tests; the real caller passes the
 * `Uint8Array` an `AnalyserNode` fills.
 */
export function computeBarLevels(
  data: ArrayLike<number>,
  barCount: number,
  minLevel: number = SOUNDWAVE_MIN_LEVEL,
): number[] {
  const len = data.length;
  if (barCount <= 0 || len === 0) return [];

  const levels: number[] = new Array(barCount);
  for (let i = 0; i < barCount; i++) {
    const start = Math.floor((i * len) / barCount);
    const end = Math.max(start + 1, Math.floor(((i + 1) * len) / barCount));
    let sum = 0;
    for (let j = start; j < end; j++) sum += data[j];
    const normalized = sum / (end - start) / 255;
    levels[i] = Math.min(1, Math.max(minLevel, normalized));
  }
  return levels;
}
