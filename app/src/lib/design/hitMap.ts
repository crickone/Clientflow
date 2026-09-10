import { extractColours } from "./htmlAudit";
import { findTextRuns, type TextRun } from "./textRuns";

/**
 * The hit map: the same design, rendered with every editable text element
 * filled with a unique flat colour, so a click on the preview becomes a pixel
 * lookup.
 *
 * Why this rather than overlaying boxes at coordinates we calculated: the
 * geometry comes from satori itself. Any hand-computed overlay is a second
 * implementation of the layout, and the moment it disagrees with the render —
 * a wrapped line, a font fallback, a flex rule we modelled slightly wrong —
 * the operator clicks a word and edits a different one. Here the click regions
 * ARE the rendered boxes, because the renderer drew them.
 *
 * The design is left structurally untouched. Only two things change per
 * element: a background colour and transparent text, both appended to the
 * existing inline style so they win as later declarations. No wrapper, no new
 * child, no display change — so the layout being hit-tested is exactly the
 * layout on screen. (This is also why ./textRuns refuses mixed content: making
 * that editable would require a wrapper element, and a wrapper can change what
 * satori's `prepare` does to the parent.)
 *
 * Photographs are blanked to a transparent pixel, keeping their box (an <img>
 * in these designs takes its size from `style`, never from attributes) but
 * removing every colour they contribute. A photo contains every colour there
 * is, including whichever ones we chose to encode indices with.
 */

/**
 * Index encoded as a colour: a reserved red channel, with the index in green
 * and blue. The red band is chosen at build time to be one the design does not
 * already use, so a brand colour can never be mistaken for a click target.
 */
export function hitColour(index: number, band: number): string {
  const g = (index >> 8) & 0xff;
  const b = index & 0xff;
  return `#${band.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
    .toString(16)
    .padStart(2, "0")}`;
}

/** The inverse. `null` for any pixel that is not a hit region. */
export function indexFromColour(r: number, g: number, b: number, band: number): number | null {
  if (r !== band) return null;
  return (g << 8) | b;
}

/** Candidate red bands, in order. Improbable as brand colours, and distinct from each other. */
const BANDS = [0xfe, 0xfd, 0xfc, 0xfb];

/**
 * Pick a red band the design doesn't already use. A design that somehow uses
 * all four falls back to the first: the collision risk is then real but
 * confined to pixels of that exact colour, which is a far better failure than
 * refusing to make the slide editable.
 */
export function pickBand(html: string): number {
  const used = new Set(
    extractColours(html)
      .map((hex) => hex.replace("#", ""))
      .filter((h) => h.length === 6)
      .map((h) => parseInt(h.slice(0, 2), 16)),
  );
  return BANDS.find((b) => !used.has(b)) ?? BANDS[0];
}

/** A 1x1 fully transparent PNG — keeps an <img>'s box while contributing no colour. */
const BLANK_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function injectStyle(openTag: string, declarations: string): string {
  const styleMatch = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i.exec(openTag);
  if (styleMatch) {
    const quote = styleMatch[1][0];
    const existing = styleMatch[2] ?? styleMatch[3] ?? "";
    const sep = existing.trim().endsWith(";") || existing.trim() === "" ? "" : ";";
    const replaced = ` style=${quote}${existing}${sep}${declarations}${quote}`;
    return openTag.slice(0, styleMatch.index) + replaced + openTag.slice(styleMatch.index + styleMatch[0].length);
  }
  // No style attribute at all — add one just before the tag closes.
  return `${openTag.slice(0, -1)} style="${declarations}">`;
}

/**
 * Build the markup for the hit map. Returns the HTML plus the runs it encoded,
 * so a caller never has to re-scan and risk a different numbering.
 */
export function buildHitMapHtml(
  html: string,
  band: number,
): { html: string; runs: TextRun[] } {
  const runs = findTextRuns(html);

  // Rewrite from the END so earlier offsets stay valid.
  let out = html;
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    const openTag = out.slice(run.tagStart, run.tagEnd + 1);
    const painted = injectStyle(
      openTag,
      `background-color:${hitColour(run.index, band)};color:transparent;`,
    );
    out = out.slice(0, run.tagStart) + painted + out.slice(run.tagEnd + 1);
  }

  // Blank every image: same box, no colour. Covers both a substituted photo
  // and the {{PHOTO}} token that is still in the stored markup.
  out = out.replace(/(<img[^>]*\ssrc\s*=\s*)("[^"]*"|'[^']*')/gi, `$1"${BLANK_PIXEL}"`);
  out = out.split("{{PHOTO}}").join(BLANK_PIXEL);

  return { html: out, runs };
}

/**
 * Which run is at (x, y) in a hit-map bitmap?
 *
 * Samples a small neighbourhood rather than the single pixel under the cursor:
 * region edges are antialiased, so one pixel can be a blend of two encodings —
 * or of an encoding and the background. Taking the most common EXACT match in
 * the neighbourhood makes a click near a boundary land on the region it visually
 * belongs to, instead of failing.
 */
export function hitIndexAt(
  rgba: Uint8ClampedArray | Uint8Array,
  imageWidth: number,
  imageHeight: number,
  x: number,
  y: number,
  band: number,
  radius = 3,
): number | null {
  const votes = new Map<number, number>();
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const px = x + dx;
      const py = y + dy;
      if (px < 0 || py < 0 || px >= imageWidth || py >= imageHeight) continue;
      const i = (py * imageWidth + px) * 4;
      const idx = indexFromColour(rgba[i], rgba[i + 1], rgba[i + 2], band);
      if (idx === null) continue;
      votes.set(idx, (votes.get(idx) ?? 0) + 1);
    }
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [idx, count] of votes) {
    if (count > bestCount) {
      best = idx;
      bestCount = count;
    }
  }
  return best;
}
