import "server-only";

import fs from "node:fs";
import path from "node:path";

export interface MusicTrack {
  filename: string;
  label: string;
  sizeBytes: number;
}

const MUSIC_DIR = path.join(process.cwd(), "data", "music");
const ALLOWED_EXT = new Set([".mp3", ".m4a", ".wav"]);

export function musicDir(): string {
  return MUSIC_DIR;
}

/**
 * Resolve a track filename to its on-disk path, guarding against path
 * traversal. Returns null if the file doesn't exist or sits outside MUSIC_DIR.
 */
export function resolveTrackPath(filename: string): string | null {
  if (!filename) return null;
  const safeName = path.basename(filename);
  if (safeName !== filename) return null;
  const ext = path.extname(safeName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;
  const full = path.join(MUSIC_DIR, safeName);
  if (!fs.existsSync(full)) return null;
  return full;
}

export function listTracks(): MusicTrack[] {
  if (!fs.existsSync(MUSIC_DIR)) return [];
  const entries = fs.readdirSync(MUSIC_DIR, { withFileTypes: true });
  const tracks: MusicTrack[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;
    const stat = fs.statSync(path.join(MUSIC_DIR, entry.name));
    tracks.push({
      filename: entry.name,
      label: entry.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
      sizeBytes: stat.size,
    });
  }
  tracks.sort((a, b) => a.label.localeCompare(b.label));
  return tracks;
}
