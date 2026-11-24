import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { listTenants } from "@/lib/tenants";
import { resolveLogoPathForTenant } from "@/lib/branding";
import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";

export const dynamic = "force-dynamic";

const RASTER = new Set([".png", ".jpg", ".jpeg", ".webp"]);
/** Average brightness (0-255) of the visible pixels above which a logo is "light". */
const LIGHT = 180;

const cache = new Map<string, Buffer>();

/**
 * The logo as it should sit on a white email: unchanged when it is dark, and
 * recoloured to near-black (shape and transparency kept) when it is light --
 * a white logo made for a dark website would otherwise vanish in the inbox.
 */
async function logoForWhite(file: string, mtimeMs: number): Promise<Buffer> {
  const key = `${file}:${mtimeMs}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let seen = 0;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 128) {
      seen++;
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
  }
  const light = seen > 0 && sum / seen > LIGHT;
  if (light) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 17;
      data[i + 1] = 17;
      data[i + 2] = 17;
    }
  }
  const out = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  cache.set(key, out);
  return out;
}

/**
 * A business's uploaded logo for the emails it sends. An inbox loads images
 * with no session and from no business domain, so /api/branding/logo (which
 * finds the business from the session or the host) can't serve it. Public
 * by design: it is the same logo the business shows on its own website.
 * Raster only: Gmail drops SVG.
 */
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("t") ?? "";
  const tenant = listTenants().find((t) => t.slug === slug && t.isActive !== false);
  const file = tenant ? resolveLogoPathForTenant(tenant.id) : null;
  if (!file || !RASTER.has(path.extname(file).toLowerCase()) || !fs.existsSync(file)) {
    return new Response("Not found", { status: 404 });
  }
  let png: Buffer;
  try {
    png = await logoForWhite(file, fs.statSync(file).mtimeMs);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(png.length),
      // The URL carries the file's mtime (?v=), so a changed logo is a new URL.
      "Cache-Control": "public, max-age=86400",
      ...mediaSecurityHeaders(),
    },
  });
}
