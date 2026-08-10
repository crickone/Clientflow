// Run: npm test -- src/lib/image/processUpload.test.ts
//
// Batch 5c (improvement-plan-2026-08.md Theme F4): uploaded raster images
// were being stored and served at full original size — no server-side image
// processing existed anywhere. processImageUpload() is the shared choke
// point every image-upload route now runs bytes through before writing them
// to disk/storage. Verifies:
//   1. a large PNG/JPEG (synthetic, generated in-memory with sharp itself)
//      gets downscaled to <= the 2000px cap and re-encoded smaller, in the
//      SAME format;
//   2. an image already under the cap is NEVER upscaled;
//   3. SVG passes through byte-for-byte UNCHANGED (kept as vector, not
//      rasterized — logos stay real SVG);
//   4. a non-raster mime (e.g. video) also passes through unchanged;
//   5. garbage bytes NEVER throw — the original bytes come back untouched,
//      which is the failure-safety guarantee every upload route relies on.
import assert from "node:assert/strict";
import { randomFillSync } from "node:crypto";
import sharp from "sharp";
import { processImageUpload } from "./processUpload";

/** A real PNG/JPEG encoding of `width`x`height` truly random pixels — this
 * makes the "downscaled output is smaller" assertion robust: random noise
 * doesn't compress away to near-nothing regardless of dimensions the way a
 * flat/solid test image would, so encoded size tracks pixel count. */
async function randomEncodedImage(
  width: number,
  height: number,
  format: "png" | "jpeg",
): Promise<Buffer> {
  const raw = randomFillSync(Buffer.alloc(width * height * 3));
  const pipeline = sharp(raw, { raw: { width, height, channels: 3 } });
  return format === "png" ? pipeline.png().toBuffer() : pipeline.jpeg().toBuffer();
}

(async () => {
  // ── 1a. a large PNG (2:1, well over the cap) gets capped + shrunk ──
  const bigPng = await randomEncodedImage(3000, 1500, "png");
  const pngResult = await processImageUpload(bigPng, "image/png");
  assert.equal(pngResult.mime, "image/png", "PNG keeps its original mime/format (no format conversion)");
  assert.equal(pngResult.width, 2000, "the longest side (3000) is scaled down to exactly the 2000 cap");
  assert.equal(pngResult.height, 1000, "aspect ratio (2:1) is preserved by the proportional downscale");
  assert.ok(
    pngResult.buffer.length < bigPng.length,
    `downscaled+recompressed PNG (${pngResult.buffer.length}b) should be smaller than the original (${bigPng.length}b)`,
  );

  // ── 1b. a large JPEG (2:1, well over the cap) gets capped + shrunk too ──
  const bigJpeg = await randomEncodedImage(4000, 2000, "jpeg");
  const jpegResult = await processImageUpload(bigJpeg, "image/jpeg");
  assert.equal(jpegResult.mime, "image/jpeg", "JPEG keeps its original mime/format (no format conversion)");
  assert.equal(jpegResult.width, 2000, "the longest side (4000) is scaled down to exactly the 2000 cap");
  assert.equal(jpegResult.height, 1000, "aspect ratio (2:1) is preserved by the proportional downscale");
  assert.ok(
    jpegResult.buffer.length < bigJpeg.length,
    `downscaled+recompressed JPEG (${jpegResult.buffer.length}b) should be smaller than the original (${bigJpeg.length}b)`,
  );

  // ── 2. an image already under the cap is never upscaled ──
  const smallPng = await randomEncodedImage(100, 80, "png");
  const smallResult = await processImageUpload(smallPng, "image/png");
  assert.equal(smallResult.width, 100, "an image already under the cap keeps its original width");
  assert.equal(smallResult.height, 80, "an image already under the cap keeps its original height — never upscaled");

  // ── 3. SVG passes through byte-for-byte unchanged ──
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="#f00"/></svg>',
  );
  const svgResult = await processImageUpload(svg, "image/svg+xml");
  assert.ok(svgResult.buffer.equals(svg), "SVG bytes are returned byte-for-byte unchanged, not rasterized");
  assert.equal(svgResult.mime, "image/svg+xml");
  assert.equal(svgResult.width, null, "SVG is a passthrough — no dimensions are extracted");

  // ── 4. a non-raster mime (e.g. video) also passes through unchanged ──
  const fakeVideo = Buffer.from("not really an mp4 — just bytes standing in for one");
  const videoResult = await processImageUpload(fakeVideo, "video/mp4");
  assert.ok(videoResult.buffer.equals(fakeVideo), "non-raster mimes (video/audio/etc.) pass through unchanged");
  assert.equal(videoResult.mime, "video/mp4");

  // ── 5. garbage bytes claiming to be a raster image never throw ──
  const garbage = Buffer.from("definitely not a valid png/jpeg/webp — just garbage bytes");
  let threw = false;
  let garbageResult: Awaited<ReturnType<typeof processImageUpload>> | null = null;
  try {
    garbageResult = await processImageUpload(garbage, "image/png");
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "processImageUpload must NEVER throw, even on undecodable bytes");
  assert.ok(
    garbageResult!.buffer.equals(garbage),
    "undecodable bytes fall back to the ORIGINAL buffer — the upload is never lost",
  );
  assert.equal(garbageResult!.width, null, "no dimensions are reported when decoding failed");

  console.log("lib/image/processUpload.test.ts: all assertions passed");
})();
