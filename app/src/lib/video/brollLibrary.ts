import "server-only";

import fs from "node:fs";
import path from "node:path";

import { probe } from "@/lib/video/ffmpeg";
import { libraryFilePath, listLibraryAssets } from "@/lib/image/library";

export interface LibraryClip {
  filename: string;
  label: string;
  sizeBytes: number;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
}

const LIBRARY_DIR = path.join(process.cwd(), "data", "broll-library");
const ALLOWED_EXT = new Set([".mp4", ".mov", ".webm"]);

// Cache probe results so repeated list calls don't reprobe every video.
// Keyed by mtime so updated files re-probe automatically.
const probeCache = new Map<
  string,
  { mtimeMs: number; durationSeconds: number; width: number | null; height: number | null }
>();

export function libraryDir(): string {
  return LIBRARY_DIR;
}

export function resolveLibraryPath(filename: string): string | null {
  if (!filename) return null;
  const safeName = path.basename(filename);
  if (safeName !== filename) return null;
  const ext = path.extname(safeName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  // 1) the filesystem b-roll library (data/broll-library/).
  const inBroll = path.join(LIBRARY_DIR, safeName);
  if (fs.existsSync(inBroll)) return inBroll;
  // 2) the shared Content Studio media library (uploaded videos).
  const inMedia = libraryFilePath(safeName);
  if (fs.existsSync(inMedia)) return inMedia;
  return null;
}

function toLabel(filename: string): string {
  return filename.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

export async function listClips(): Promise<LibraryClip[]> {
  if (!fs.existsSync(LIBRARY_DIR)) return [];
  const entries = fs.readdirSync(LIBRARY_DIR, { withFileTypes: true });
  const clips: LibraryClip[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;
    const full = path.join(LIBRARY_DIR, entry.name);
    const stat = fs.statSync(full);
    let info: LibraryClip = {
      filename: entry.name,
      label: toLabel(entry.name),
      sizeBytes: stat.size,
      durationSeconds: null,
      width: null,
      height: null,
    };
    const cached = probeCache.get(entry.name);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      info = {
        ...info,
        durationSeconds: cached.durationSeconds,
        width: cached.width,
        height: cached.height,
      };
    } else {
      try {
        const p = await probe(full);
        probeCache.set(entry.name, {
          mtimeMs: stat.mtimeMs,
          durationSeconds: p.durationSeconds,
          width: p.width,
          height: p.height,
        });
        info = {
          ...info,
          durationSeconds: p.durationSeconds,
          width: p.width,
          height: p.height,
        };
      } catch (err) {
        console.warn(
          `[broll-library] probe failed for ${entry.name}:`,
          err,
        );
      }
    }
    clips.push(info);
  }

  // Also surface videos uploaded to the shared Content Studio media library
  // (the Library tab) so they're selectable as b-roll when building a video.
  try {
    const videos = listLibraryAssets().filter((a) => a.kind === "video");
    for (const v of videos) {
      const full = libraryFilePath(v.filename);
      if (!fs.existsSync(full)) continue;
      const stat = fs.statSync(full);
      let info: LibraryClip = {
        filename: v.filename,
        label: v.label || toLabel(v.originalName),
        sizeBytes: stat.size,
        durationSeconds: null,
        width: v.width,
        height: v.height,
      };
      const cached = probeCache.get(v.filename);
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        info = {
          ...info,
          durationSeconds: cached.durationSeconds,
          width: cached.width,
          height: cached.height,
        };
      } else {
        try {
          const p = await probe(full);
          probeCache.set(v.filename, {
            mtimeMs: stat.mtimeMs,
            durationSeconds: p.durationSeconds,
            width: p.width,
            height: p.height,
          });
          info = {
            ...info,
            durationSeconds: p.durationSeconds,
            width: p.width,
            height: p.height,
          };
        } catch (err) {
          console.warn(`[broll-library] probe failed for ${v.filename}:`, err);
        }
      }
      clips.push(info);
    }
  } catch (err) {
    console.warn("[broll-library] media library merge failed:", err);
  }

  clips.sort((a, b) => a.label.localeCompare(b.label));
  return clips;
}
