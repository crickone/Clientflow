import "server-only";

import fs from "node:fs";
import path from "node:path";

import { getBrandingLogoFilename } from "@/lib/settings";
import { getCurrentTenant } from "@/lib/db/tenant";

const DATA_DIR = path.join(process.cwd(), "data");
const ALLOWED_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);
export const LOGO_BASENAME = "logo";

/**
 * Branding files live per tenant. Renova keeps the legacy `data/branding/` path
 * (so its live logo file never moves); provisioned tenants use
 * `data/tenants/<slug>/branding/`. The logo *filename* is already per-tenant
 * (stored in that tenant's settings).
 */
export function brandingDir(): string {
  const tenant = getCurrentTenant();
  if (tenant.slug === "renova") return path.join(DATA_DIR, "branding");
  return path.join(DATA_DIR, "tenants", tenant.slug, "branding");
}

export function ensureBrandingDir(): string {
  const dir = brandingDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function isAllowedLogoExt(ext: string): boolean {
  return ALLOWED_EXT.has(ext.toLowerCase());
}

/**
 * Resolve the on-disk path of the currently-configured logo (or null when no
 * logo has been uploaded / the file is missing). Used by the cards renderer
 * and the preview endpoint.
 */
export function resolveLogoPath(): string | null {
  const filename = getBrandingLogoFilename();
  if (!filename) return null;
  const safe = path.basename(filename);
  if (safe !== filename) return null;
  if (!isAllowedLogoExt(path.extname(safe))) return null;
  const full = path.join(brandingDir(), safe);
  if (!fs.existsSync(full)) return null;
  return full;
}

/**
 * Logo path guaranteed to be a RASTER file, for consumers that can't read SVG
 * (the ffmpeg video pipeline). Raster uploads pass through unchanged; an SVG
 * logo is rasterised to a cached PNG (`logo.raster.png`, cleared alongside the
 * logo on upload/delete). Returns null when no logo is set or rasterisation
 * fails — the video then renders without a logo rather than crashing on an SVG.
 */
export async function resolveRasterLogoPath(): Promise<string | null> {
  const src = resolveLogoPath();
  if (!src) return null;
  if (path.extname(src).toLowerCase() !== ".svg") return src;
  try {
    const out = path.join(brandingDir(), `${LOGO_BASENAME}.raster.png`);
    const svgMtime = fs.statSync(src).mtimeMs;
    if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < svgMtime) {
      const sharp = (await import("sharp")).default;
      await sharp(fs.readFileSync(src))
        .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
        .png()
        .toFile(out);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * The logo to show in the app chrome (sidebar, login, marketing header).
 *
 * For now this is always the AdonisAgent Nebula wordmark — the Logo component
 * renders the wordmark when the src is null. The current branding upload only
 * chrome. When the tenant has uploaded a business logo it's shown at the top of
 * the app; otherwise the Logo component falls back to the AdonisAgent wordmark
 * (src === null). The `?v=<mtime>` cache-buster makes the sidebar pick up a
 * replaced logo. The same logo also drives the Content Studio intro/outro cards.
 */
export function getChromeLogoSrc(): string | null {
  if (resolveLogoPath()) return `/api/branding/logo?v=${logoMtime()}`;
  return null;
}

/**
 * Mtime of the current logo, used as a cache-buster so the intro/outro
 * cards re-render when the logo is replaced.
 */
export function logoMtime(): number {
  const full = resolveLogoPath();
  if (!full) return 0;
  try {
    return fs.statSync(full).mtimeMs;
  } catch {
    return 0;
  }
}
