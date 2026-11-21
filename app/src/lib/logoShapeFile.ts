import "server-only";

import fs from "node:fs";
import path from "node:path";

import { logoShape } from "@/lib/logoShape";

/**
 * The one-colour shape of a business logo, cached next to it:
 * `logo.shape.png` (white, logo in alpha), or `logo.shape.none` when the
 * logo has a busy background and none can be made. Both are re-made when the
 * logo is newer. The upload route already clears every `logo.*` file on a new
 * upload. Never throws: null means "show the logo as uploaded".
 */

const SHAPE = "logo.shape.png";
const NONE = "logo.shape.none";
const MAX_PX = 1024;

function fresh(file: string, logoMtime: number): boolean {
  try {
    return fs.statSync(file).mtimeMs >= logoMtime;
  } catch {
    return false;
  }
}

/** Rasterise an SVG so its long side lands near this many pixels (then fit to MAX_PX). */
const SVG_TARGET_PX = 2048;

/**
 * The density to rasterise an SVG at. A fixed high density makes a large
 * design-tool export (thousands of user units) blow past sharp's pixel limit,
 * so it scales with the SVG's own size: small marks render crisp, large ones
 * stay within bounds.
 */
export function svgDensity(width: number | undefined, height: number | undefined): number {
  const long = Math.max(width ?? 0, height ?? 0);
  if (!long) return 72;
  return Math.min(300, Math.max(1, (72 * SVG_TARGET_PX) / long));
}

export async function ensureLogoShape(logoPath: string): Promise<string | null> {
  let none: string | null = null;
  try {
    const dir = path.dirname(logoPath);
    const out = path.join(dir, SHAPE);
    const logoMtime = fs.statSync(logoPath).mtimeMs;
    none = path.join(dir, NONE);
    if (fresh(out, logoMtime)) return out;
    if (fresh(none, logoMtime)) return null;

    const sharp = (await import("sharp")).default;
    const isSvg = path.extname(logoPath).toLowerCase() === ".svg";
    const buf = fs.readFileSync(logoPath);
    let density: number | undefined;
    if (isSvg) {
      const meta = await sharp(buf).metadata();
      density = svgDensity(meta.width, meta.height);
    }
    const { data, info } = await sharp(buf, density ? { density } : {})
      .resize(MAX_PX, MAX_PX, { fit: "inside", withoutEnlargement: !isSvg })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const shape = logoShape({ data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height });
    if (!shape) {
      fs.writeFileSync(none, "");
      fs.rmSync(out, { force: true });
      return null;
    }
    // Write beside it, then rename: a reader never sees a half-written file,
    // and a failed write leaves nothing that would later pass as fresh.
    const tmp = `${out}.${process.pid}.${Date.now()}.tmp`;
    try {
      await sharp(Buffer.from(shape.data), { raw: { width: shape.width, height: shape.height, channels: 4 } }).png().toFile(tmp);
      fs.renameSync(tmp, out);
    } finally {
      fs.rmSync(tmp, { force: true });
    }
    fs.rmSync(none, { force: true });
    return out;
  } catch {
    // The logo exists but can't be made one-colour (undecodable, too large):
    // remember that, so the public route doesn't retry it on every request.
    if (none) {
      try {
        fs.writeFileSync(none, "");
      } catch {
        // best effort
      }
    }
    return null;
  }
}

export function removeLogoShape(logoPath: string): void {
  const dir = path.dirname(logoPath);
  for (const f of [SHAPE, NONE]) {
    try {
      fs.rmSync(path.join(dir, f), { force: true });
    } catch {
      // best effort
    }
  }
}
