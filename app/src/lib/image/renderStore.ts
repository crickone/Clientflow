import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Rendered slide PNGs.
 *
 * They live on the volume BESIDE the image library rather than in it: these are
 * output, and mixing machine artefacts into the operator's own photo library
 * would put them in the place they keep their pictures.
 *
 * The filename carries a content hash, which buys two things. Re-rendering
 * identical markup overwrites rather than accumulating, and a changed design
 * always gets a new URL -- so a regenerate can never leave a browser showing the
 * previous render from cache. That is also why the serving route can mark these
 * immutable.
 */
const RENDER_ROOT = path.join(process.cwd(), "data", "renders");

export function renderDir(): string {
  if (!fs.existsSync(RENDER_ROOT)) {
    fs.mkdirSync(RENDER_ROOT, { recursive: true });
  }
  return RENDER_ROOT;
}

/** Absolute path for a stored render. `basename` is deliberate: the filename
 *  reaches this from a URL segment, and must never escape the directory. */
export function renderFilePath(filename: string): string {
  return path.join(renderDir(), path.basename(filename));
}

export function renderFileUrl(filename: string): string {
  return `/api/content-studio/renders/${encodeURIComponent(filename)}`;
}

export function saveRender(png: Buffer): string {
  const hash = crypto.createHash("sha256").update(png).digest("hex").slice(0, 16);
  const filename = `design-${hash}.png`;
  fs.writeFileSync(renderFilePath(filename), png);
  return filename;
}

/**
 * Best-effort removal of a superseded render. Never throws: the file may
 * already be gone, or -- because the name is a content hash -- may still be in
 * use by another slide that happens to have rendered identically. A stray
 * render costs a few hundred kilobytes and nothing else, so failing loudly here
 * would be worse than leaving it.
 */
export function deleteRender(filename: string | null | undefined): void {
  if (!filename) return;
  try {
    fs.unlinkSync(renderFilePath(filename));
  } catch {
    // See above.
  }
}
