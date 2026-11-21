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

export async function ensureLogoShape(logoPath: string): Promise<string | null> {
  try {
    const dir = path.dirname(logoPath);
    const out = path.join(dir, SHAPE);
    const none = path.join(dir, NONE);
    const logoMtime = fs.statSync(logoPath).mtimeMs;
    if (fresh(out, logoMtime)) return out;
    if (fresh(none, logoMtime)) return null;

    const sharp = (await import("sharp")).default;
    const isSvg = path.extname(logoPath).toLowerCase() === ".svg";
    const { data, info } = await sharp(fs.readFileSync(logoPath), isSvg ? { density: 300 } : {})
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
    await sharp(Buffer.from(shape.data), { raw: { width: shape.width, height: shape.height, channels: 4 } }).png().toFile(out);
    fs.rmSync(none, { force: true });
    return out;
  } catch {
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
