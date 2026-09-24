/**
 * What the editor can honestly say about a run in flight.
 *
 * PURE — no imports, so the wording and the arithmetic are pinned by a test
 * rather than left to drift against the server's strings.
 *
 * A design takes two to four minutes, and for most of it the only thing on
 * screen was a drifting field of light: it said "working" and nothing else, so
 * minute three looked exactly like minute one. The server already knows more
 * than that — it reports which slide it is on and what it is doing to it — and
 * this turns those strings back into the two facts a person waiting actually
 * wants: how far along, and is it still moving.
 *
 * THE STRINGS ARE THE CONTRACT. They are written by designPost's onProgress
 * and carouselGeneration (grep `setGenerationStage`). Parsing beats passing a
 * structured payload here only because the stage is a single text column read
 * by a poll; if that ever becomes an object, delete this and read the fields.
 * An unrecognised stage is NOT an error — it shows verbatim with no progress
 * claimed, which is the safe direction for a string this module has not met.
 */

export type GenerationPhase =
  | "writing" // the model is composing every slide; one long opaque step
  | "drawing" // rendering one slide
  | "photographing" // making one slide's photograph
  | "correcting" // the repair pass
  | "saving";

export interface GenerationProgress {
  phase: GenerationPhase;
  /** How many slides the run is making, once a stage has said. */
  total: number | null;
  /** 1-based slide this stage concerns, or null when it is about the whole post. */
  slide: number | null;
  /** Slides finished. Feeds the rail, so it must never run ahead of the truth. */
  done: number;
  /** What to show. The server's own words when it had some. */
  label: string;
}

const PATTERNS: {
  re: RegExp;
  phase: GenerationPhase;
  /** Reads [slide, total] out of the match. */
  read?: (m: RegExpMatchArray) => { slide: number | null; total: number | null };
}[] = [
  {
    re: /^Designing (\d+) slides?/i,
    phase: "writing",
    read: (m) => ({ slide: null, total: Number(m[1]) }),
  },
  {
    re: /^Drawing slide (\d+) of (\d+)/i,
    phase: "drawing",
    read: (m) => ({ slide: Number(m[1]), total: Number(m[2]) }),
  },
  {
    re: /^Photographing slide (\d+) of (\d+)/i,
    phase: "photographing",
    read: (m) => ({ slide: Number(m[1]), total: Number(m[2]) }),
  },
  { re: /^Correcting/i, phase: "correcting" },
  { re: /^Saving/i, phase: "saving" },
];

const FALLBACK = "Writing the slides.";

/**
 * Read one stage string.
 *
 * `knownTotal` carries the count forward: "Correcting what didn't fit" and
 * "Saving the slides" name no count, and a rail that vanished for the length of
 * the repair pass would be worse than no rail at all.
 */
export function readGenerationStage(
  stage: string | null | undefined,
  knownTotal: number | null = null,
): GenerationProgress {
  const text = (stage ?? "").trim();
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    const read = p.read?.(m) ?? { slide: null, total: null };
    const total = read.total ?? knownTotal;
    return {
      phase: p.phase,
      total,
      slide: read.slide,
      // A slide being drawn is not a slide done: the rail fills BEHIND the
      // work, never in front of it. Saving is the one stage where every slide
      // genuinely exists.
      done: p.phase === "saving" ? (total ?? 0) : read.slide ? read.slide - 1 : 0,
      label: text,
    };
  }
  return {
    phase: "writing",
    total: knownTotal,
    slide: null,
    done: 0,
    label: text || FALLBACK,
  };
}

/** Seconds are shown once a few have passed: "1s" flickering on is a glitch, not information. */
const SHOW_ELAPSED_FROM = 5;

/**
 * "2:14", or "" while it is too early to be worth saying.
 *
 * Minutes rather than the bare seconds the dialog buttons use: those waits are
 * twenty seconds and this one is three minutes, where "147s" is arithmetic the
 * reader has to do.
 */
export function elapsedLabel(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < SHOW_ELAPSED_FROM) return "";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
