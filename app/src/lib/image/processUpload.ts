import "server-only";

import sharp from "sharp";

/**
 * Batch 5c (improvement-plan-2026-08.md Theme F4): uploaded images were being
 * stored and served at their full original size — no server-side image
 * processing existed anywhere. This is the single shared choke point every
 * image-upload route runs bytes through before writing them to disk/storage.
 *
 * Policy:
 *   - Raster (JPEG/PNG/WebP) uploads are downscaled to at most
 *     MAX_DIMENSION px on the longest side — `fit: "inside"` preserves
 *     aspect ratio, and `withoutEnlargement: true` means a smaller source
 *     image is NEVER upscaled (a 400px avatar stays 400px). They're then
 *     re-encoded in the SAME format at ~QUALITY — sharp strips EXIF/XMP/ICC
 *     metadata by default (no `.withMetadata()` call), which is also a small
 *     privacy win (GPS tags, camera serial numbers, etc. gone).
 *   - SVG is passed through completely UNCHANGED — we want to keep logos as
 *     real vector SVG, not rasterize them, and they're already neutralized
 *     by the Batch 2a media CSP/sandbox headers.
 *   - GIF is passed through unchanged too, even though it's technically a
 *     raster format: sharp only decodes a GIF's first frame unless told
 *     otherwise, and silently collapsing an animated upload to a static
 *     frame would be a real behaviour change, not a size optimisation.
 *   - Anything else (video, audio, PDFs, office docs, unknown mimes) is
 *     passed through unchanged — this helper only ever touches
 *     image/jpeg, image/jpg, image/png, image/webp.
 *   - NEVER throws. If sharp can't decode the bytes — corrupt upload, a mime
 *     that lied about the content, a truncated stream, a pixel-bomb header
 *     sharp's own decompression-bomb guard rejects — the ORIGINAL bytes are
 *     returned untouched and the failure is logged. An upload must never be
 *     lost, and a route must never 500, just because the resize step choked.
 */

const MAX_DIMENSION = 2000;
const QUALITY = 82;

/** The only mimes this helper ever transforms — everything else passes through. */
const RASTER_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export interface ProcessedImage {
  buffer: Buffer;
  /** Always the INPUT mime — this helper never changes format. */
  mime: string;
  /**
   * Output pixel dimensions, populated only when the image was actually
   * decoded + re-encoded. `null` for passthrough (SVG/GIF/video/etc.) and
   * for decode failures — callers should treat `null` as "unknown", the
   * same as before this helper existed.
   */
  width: number | null;
  height: number | null;
}

export async function processImageUpload(
  buffer: Buffer,
  mime: string,
): Promise<ProcessedImage> {
  const normalizedMime = (mime || "").toLowerCase();
  if (!RASTER_MIME.has(normalizedMime)) {
    return { buffer, mime, width: null, height: null };
  }

  try {
    const pipeline = sharp(buffer, { failOn: "none" }).resize({
      width: MAX_DIMENSION,
      height: MAX_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    });

    // PNG keeps its lossless encoding (a `quality` option only takes effect
    // with `palette: true`, i.e. lossy colour quantisation — a bigger visual
    // change than "re-encode at ~82 quality" implies for e.g. a screenshot
    // logo). Max compressionLevel still shrinks it; the downscale above does
    // most of the real work for PNGs anyway.
    const encoded =
      normalizedMime === "image/png"
        ? pipeline.png({ compressionLevel: 9 })
        : normalizedMime === "image/webp"
          ? pipeline.webp({ quality: QUALITY })
          : pipeline.jpeg({ quality: QUALITY, mozjpeg: true });

    const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      mime,
      width: info.width ?? null,
      height: info.height ?? null,
    };
  } catch (err) {
    console.warn(
      "[processImageUpload] sharp couldn't process the upload — storing original bytes:",
      err,
    );
    return { buffer, mime, width: null, height: null };
  }
}
