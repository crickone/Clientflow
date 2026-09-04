import "server-only";

import path from "node:path";

import type { TranscriptWord } from "@/lib/ai/transcribe";
import {
  configFor,
  groupIntoPhrases,
  type AspectRatio,
  type CaptionConfig,
  type CaptionPhrase,
} from "@/lib/video/captionPhrases";

/**
 * Caption fill colours in ASS's &HBBGGRR order (NOT RGB).
 * Base = white; highlight = the brand orange #ff6a32 → BB=32, GG=6a, RR=ff.
 */
const BASE_COLOUR = "&H00FFFFFF&";
const HIGHLIGHT_COLOUR = "&H00326AFF&";

// Re-exported so existing server importers (render.ts, cards.ts) are unchanged.
export { configFor };
export type { AspectRatio, CaptionConfig };

export interface CaptionFont {
  /** ASS Fontname value (must match the font's family name as libass sees it). */
  name: string;
  /** Label shown in the UI dropdown. */
  label: string;
  /** Filename inside FONTS_DIR (when null, the font is a system font). */
  file: string | null;
}

/**
 * Source of bundled font files copied into the work directory before render
 * so libass can find them via the `fontsdir` option.
 */
export const FONTS_DIR = path.join(
  process.cwd(),
  "src",
  "app",
  "fonts",
);

/**
 * The font picker exposed to the user. System fonts (Arial Black, Impact)
 * are resolved by libass from the OS; bundled fonts are copied alongside
 * captions.ass at render time.
 */
export const CAPTION_FONTS: CaptionFont[] = [
  { name: "Arial Black", label: "Arial Black (default)", file: null },
  { name: "Impact", label: "Impact", file: null },
  { name: "Nebula", label: "Nebula (brand)", file: "Nebula-Regular.otf" },
  {
    name: "Nebula Hollow",
    label: "Nebula Hollow (brand outline)",
    file: "Nebula-Hollow.otf",
  },
];

export function findFont(name: string | null | undefined): CaptionFont {
  if (!name) return CAPTION_FONTS[0];
  return CAPTION_FONTS.find((f) => f.name === name) ?? CAPTION_FONTS[0];
}

function toAssTime(seconds: number): string {
  const total = Math.max(0, seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(Math.floor(s)).padStart(
    2,
    "0",
  )}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(input: string): string {
  // ASS uses { } for override tags. Escape any literal braces; also remove
  // newlines which would terminate the line.
  return input
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\r?\n/g, " ")
    .trim();
}

/**
 * Group consecutive Whisper words into 2–3-word "phrases" so captions read
 * as short bursts instead of single words flashing one at a time. A new
 * phrase starts when:
 *   - the running chunk already has the target number of words, OR
 *   - there's a clear pause (gap >= 350ms) between the previous word and
 *     the current one, OR
 *   - the previous word ended in sentence-final punctuation (. ! ?), which
 *     gives the caption a natural breath.
 */
/**
 * Build a kinetic caption track: one ASS Dialogue per 2–3 word phrase,
 * each one pops in then settles. Phrases are displayed in ALL CAPS.
 *
 * Word timings come straight from Whisper (or the user's edited transcript).
 * Each phrase shows from its first word's start until just before the next
 * phrase begins (with a 200ms minimum so very short phrases don't flash).
 */
export function buildAssCaptions(
  words: TranscriptWord[],
  cfg: CaptionConfig,
  fontName: string = "Arial Black",
): string {
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${cfg.width}`,
    `PlayResY: ${cfg.height}`,
    // WrapStyle 0 = smart wrapping. If a phrase is still too wide after our
    // character cap (e.g. one very long word + a short one), libass will
    // break it across two lines rather than running off the screen.
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Bright white fill, thick black outline, centered (Alignment=2 = bottom-center)
    `Style: Pop,${fontName},${cfg.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,1,0,0,0,100,100,0,0,1,8,2,2,40,40,${cfg.marginVBottom},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  // Animation tags: pop-in from 80% scale to 110% then 100%, plus quick fade.
  const popTags =
    "{\\fad(40,60)\\fscx80\\fscy80\\t(0,80,\\fscx112\\fscy112)\\t(80,180,\\fscx100\\fscy100)}";

  const phrases = groupIntoPhrases(words);
  const events: string[] = [];
  for (let i = 0; i < phrases.length; i++) {
    const p = phrases[i];
    const next = phrases[i + 1];
    const start = p.start;
    const naturalEnd = next ? next.start : p.end + 0.25;
    const minEnd = start + 0.2;
    const end = Math.max(naturalEnd, minEnd);
    const text = escapeAssText(p.text).toUpperCase();
    if (!text) continue;
    events.push(
      `Dialogue: 0,${toAssTime(start)},${toAssTime(end)},Pop,,0,0,0,,${popTags}${buildWordHighlightBody(p, start)}`,
    );
  }

  return [...header, ...events, ""].join("\n");
}

/**
 * The phrase body with the word currently being spoken highlighted — the
 * "word pop" look modern short-form captions use (CapCut/Submagic style).
 *
 * Each word is emitted with its own colour override, switched with `\t`
 * transforms relative to the Dialogue's start: the word turns the accent colour
 * (and scales up a touch) at its Whisper start time, then returns to white when
 * it finishes. Because every word carries its own timing, the highlight tracks
 * the speech exactly. Falls back to the plain uppercase phrase when a phrase has
 * no word timings.
 */
function buildWordHighlightBody(phrase: CaptionPhrase, dialogueStart: number): string {
  if (!phrase.words || phrase.words.length === 0) {
    return escapeAssText(phrase.text).toUpperCase();
  }
  // ms offsets from the Dialogue start, which is what \t() is relative to.
  const off = (t: number) => Math.max(0, Math.round((t - dialogueStart) * 1000));
  const parts = phrase.words.map((w) => {
    const word = escapeAssText(w.text).toUpperCase();
    if (!word) return "";
    const on = off(w.start);
    const done = Math.max(on + 60, off(w.end));
    // Highlight in, then back to the base fill. \1c = primary (fill) colour.
    return (
      `{\\t(${on},${on + 60},\\1c${HIGHLIGHT_COLOUR}\\fscx118\\fscy118)` +
      `\\t(${done},${done + 80},\\1c${BASE_COLOUR}\\fscx100\\fscy100)}${word}`
    );
  });
  return parts.filter(Boolean).join(" ");
}
