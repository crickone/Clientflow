// Run: npx tsx src/lib/logoShape.test.ts
import assert from "node:assert/strict";

import { logoShape, type RawImage } from "./logoShape";

/** A w x h image filled with one RGBA colour. */
function canvas(w: number, h: number, rgba: [number, number, number, number]): RawImage {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(rgba, i * 4);
  return { data, width: w, height: h };
}
function paint(img: RawImage, x0: number, y0: number, x1: number, y1: number, rgba: [number, number, number, number]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set(rgba, (y * img.width + x) * 4);
}
const alphaAt = (img: RawImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3];
const rgbAt = (img: RawImage, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));

// 1. Transparent PNG: alpha passes through, colour becomes white, trimmed to the logo (+2px margin).
{
  const img = canvas(100, 50, [0, 0, 0, 0]);
  paint(img, 20, 10, 80, 40, [212, 175, 55, 255]); // gold block
  paint(img, 30, 20, 40, 30, [255, 255, 255, 128]); // half-see-through detail
  const s = logoShape(img)!;
  assert.ok(s);
  assert.equal(s.width, 64); // 60 + 2*2
  assert.equal(s.height, 34); // 30 + 2*2
  assert.equal(alphaAt(s, 2, 2), 255);
  assert.deepEqual(rgbAt(s, 2, 2), [255, 255, 255]);
  assert.equal(alphaAt(s, 12, 12), 128);
  assert.equal(alphaAt(s, 0, 0), 0);
}

// 2. Dark logo on a white JPG-style background: background removed, logo solid.
{
  const img = canvas(100, 60, [255, 255, 255, 255]);
  paint(img, 25, 15, 75, 45, [20, 20, 20, 255]);
  const s = logoShape(img)!;
  assert.ok(s);
  assert.equal(s.width, 54);
  assert.equal(s.height, 34);
  assert.equal(alphaAt(s, 10, 10), 255);
  assert.equal(alphaAt(s, 0, 0), 0);
}

// 3. Light logo on a dark background: same.
{
  const img = canvas(80, 80, [12, 13, 16, 255]);
  paint(img, 30, 30, 50, 50, [240, 240, 240, 255]);
  const s = logoShape(img)!;
  assert.ok(s);
  assert.equal(alphaAt(s, 10, 10), 255);
}

// 4. Soft edge: alpha tracks edge coverage against the logo's own contrast.
{
  const img = canvas(60, 60, [255, 255, 255, 255]);
  paint(img, 20, 20, 40, 40, [0, 0, 0, 255]); // full contrast: distance ~441.7
  paint(img, 19, 20, 20, 40, [128, 128, 128, 255]); // half coverage: distance ~220
  const s = logoShape(img)!;
  // Edge pixel against the black beside it: (221.7 - 24) / (441.7 - 24) = 0.47 -> ~121
  const a = alphaAt(s, 2, 10); // column 19 sits at x=2 after trimming with a 2px margin
  assert.ok(Math.abs(a - 121) <= 5, `half-coverage edge alpha was ${a}`);
  assert.equal(alphaAt(s, 12, 10), 255); // inside the logo stays solid
}

// 4a. Two-tone logo: the lighter tone stays solid, and a dark speck doesn't dim the rest.
{
  const img = canvas(80, 60, [255, 255, 255, 255]);
  paint(img, 10, 10, 40, 50, [0, 0, 0, 255]); // black half
  paint(img, 40, 10, 70, 50, [212, 175, 55, 255]); // gold half
  paint(img, 75, 5, 76, 6, [0, 0, 0, 255]); // a stray speck
  const s = logoShape(img)!;
  assert.ok(s);
  // Interior of the gold half (original x=55, y=30) -> trimmed origin is (8, 3).
  assert.equal(alphaAt(s, 55 - 8, 30 - 3), 255);
  assert.equal(alphaAt(s, 25 - 8, 30 - 3), 255);
  // Gold's own outer edge is solid too: nothing stronger is beside it but the black half, 30px away.
  assert.equal(alphaAt(s, 69 - 8, 30 - 3), 255);
}

// 4b. An opaque logo with one stray see-through pixel is still treated as opaque (background removed, not a solid block).
{
  const img = canvas(60, 60, [255, 255, 255, 255]);
  paint(img, 20, 20, 40, 40, [0, 0, 0, 255]);
  paint(img, 59, 30, 60, 31, [255, 255, 255, 0]);
  const s = logoShape(img)!;
  assert.ok(s);
  assert.equal(s.width, 24); // the 20px logo + 2*2 margin, not the 60px tile
  assert.equal(alphaAt(s, 0, 0), 0);
}

// 4c. Tiny images don't throw.
assert.equal(logoShape(canvas(1, 1, [0, 0, 0, 255])), null);
assert.ok(logoShape((() => { const i = canvas(3, 3, [255, 255, 255, 255]); paint(i, 1, 1, 2, 2, [0, 0, 0, 255]); return i; })()));

// 5. Corners that disagree (a photo): no shape.
{
  const img = canvas(60, 60, [255, 255, 255, 255]);
  paint(img, 0, 0, 10, 10, [200, 30, 30, 255]);
  paint(img, 50, 50, 60, 60, [30, 30, 200, 255]);
  assert.equal(logoShape(img), null);
}

// 6. Nothing but background (or nothing visible): no shape.
assert.equal(logoShape(canvas(40, 40, [255, 255, 255, 255])), null);
assert.equal(logoShape(canvas(40, 40, [0, 0, 0, 0])), null);

console.log("logoShape: ok");
