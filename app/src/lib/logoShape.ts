/**
 * The one-colour "shape" of a logo, from raw pixels. Pure (no sharp, no
 * disk), so it runs under the plain test runner.
 *
 * - A logo with real transparency keeps its alpha.
 * - A logo on a solid background (a JPG, a flattened PNG) has that
 *   background found from the four corners and removed, with a soft ramp so
 *   curves stay smooth.
 * - A busy background (the corners disagree) gives null: the caller shows
 *   the logo as uploaded.
 *
 * The result is white with the logo in the alpha channel, trimmed to the
 * logo plus a small margin. The app paints it with a CSS mask, so the
 * colour here never shows.
 */

export interface RawImage {
  /** RGBA, 4 bytes per pixel, row by row. */
  data: Uint8Array;
  width: number;
  height: number;
}

/** Below this alpha a pixel counts as see-through when deciding "has transparency". */
const TRANSPARENT_BELOW = 250;
/** Colour distance (0-441) within which a corner patch is one flat colour, and patches match each other. */
const FLAT = 24;
/** Background-to-logo ramp: at or under LOW the pixel is background, at or over HIGH it is fully logo. */
const RAMP_LOW = 24;
const RAMP_HIGH = 72;
/** Alpha above this counts when trimming. */
const VISIBLE = 8;
const MARGIN = 2;

function dist(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/** Mean colour of a square patch, or null when the patch is not one flat colour. */
function flatPatch(img: RawImage, x0: number, y0: number, size: number): [number, number, number] | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      const i = (y * img.width + x) * 4;
      r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
    }
  const mean: [number, number, number] = [r / n, g / n, b / n];
  for (let y = y0; y < y0 + size; y++)
    for (let x = x0; x < x0 + size; x++) {
      const i = (y * img.width + x) * 4;
      if (dist(img.data[i], img.data[i + 1], img.data[i + 2], ...mean) > FLAT) return null;
    }
  return mean;
}

function backgroundColour(img: RawImage): [number, number, number] | null {
  const size = Math.max(1, Math.round(Math.min(img.width, img.height) * 0.04));
  const corners = [
    flatPatch(img, 0, 0, size),
    flatPatch(img, img.width - size, 0, size),
    flatPatch(img, 0, img.height - size, size),
    flatPatch(img, img.width - size, img.height - size, size),
  ];
  if (corners.some((c) => c === null)) return null;
  const cs = corners as [number, number, number][];
  for (const a of cs) for (const b of cs) if (dist(...a, ...b) > FLAT) return null;
  return [0, 1, 2].map((k) => cs.reduce((s, c) => s + c[k], 0) / cs.length) as [number, number, number];
}

export function logoShape(img: RawImage): RawImage | null {
  const { width: w, height: h, data } = img;
  if (w < 1 || h < 1 || data.length < w * h * 4) return null;
  const alpha = new Uint8Array(w * h);

  let transparent = false;
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] < TRANSPARENT_BELOW) { transparent = true; break; }

  if (transparent) {
    for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
  } else {
    const bg = backgroundColour(img);
    if (!bg) return null;
    for (let i = 0; i < w * h; i++) {
      const d = dist(data[i * 4], data[i * 4 + 1], data[i * 4 + 2], ...bg);
      const t = Math.min(1, Math.max(0, (d - RAMP_LOW) / (RAMP_HIGH - RAMP_LOW)));
      alpha[i] = Math.round(t * 255);
    }
  }

  let left = w, top = h, right = -1, bottom = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (alpha[y * w + x] > VISIBLE) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) return null;

  const x0 = Math.max(0, left - MARGIN);
  const y0 = Math.max(0, top - MARGIN);
  const x1 = Math.min(w - 1, right + MARGIN);
  const y1 = Math.min(h - 1, bottom + MARGIN);
  const ow = x1 - x0 + 1;
  const oh = y1 - y0 + 1;
  const out = new Uint8Array(ow * oh * 4);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++) {
      const o = (y * ow + x) * 4;
      out[o] = 255; out[o + 1] = 255; out[o + 2] = 255;
      out[o + 3] = alpha[(y + y0) * w + (x + x0)];
    }
  return { data: out, width: ow, height: oh };
}
