import { extractColours } from "./htmlAudit";

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
 * This file holds the PURE half: the colour encoding and the pixel-to-run
 * lookup, with no dependency on satori, sharp or the render module. A CLIENT
 * component (SlideTextEditor.tsx) imports pickBand and hitIndexAt directly, to
 * resolve a click without a round trip. Building the hit-map MARKUP itself
 * (./buildHitMap) needs the render module's photo stand-in, which pulls in
 * `server-only` transitively -- that lives in its own file so this one stays
 * safe to reach from a client bundle.
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
