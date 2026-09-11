import "server-only";

import fs from "node:fs";
import path from "node:path";
import { db, schema } from "@/lib/db";
import { desc, eq } from "drizzle-orm";

const LIBRARY_ROOT = path.join(process.cwd(), "data", "image-library");

export function libraryDir(): string {
  if (!fs.existsSync(LIBRARY_ROOT)) {
    fs.mkdirSync(LIBRARY_ROOT, { recursive: true });
  }
  return LIBRARY_ROOT;
}

export function libraryFilePath(filename: string): string {
  // Block path traversal — only accept basenames.
  const safe = path.basename(filename);
  return path.join(libraryDir(), safe);
}

export function listLibraryAssets() {
  return db
    .select()
    .from(schema.imageLibraryAssets)
    .orderBy(desc(schema.imageLibraryAssets.createdAt))
    .all();
}

export function getLibraryAsset(id: number) {
  return (
    db
      .select()
      .from(schema.imageLibraryAssets)
      .where(eq(schema.imageLibraryAssets.id, id))
      .get() ?? null
  );
}

/**
 * The tenant's photographs, as the renderer wants them: an id and a path.
 *
 * Videos are excluded -- a designed slide embeds a still. The id travels with
 * the path so a slide can RECORD which photograph it used, which is what makes
 * re-rendering one stable and re-photographing it possible. Every caller goes
 * through here so they cannot drift apart: they did, and the result was a
 * seven-slide set with `listLibraryAssets()[0]` on every photo slide.
 */
export function photoChoices(): { id: number; path: string }[] {
  return listLibraryAssets()
    .filter((a: { kind?: string | null }) => a.kind !== "video")
    .map((a: { id: number; filename: string }) => ({
      id: a.id,
      path: libraryFilePath(a.filename),
    }));
}

/** One photograph by asset id, or the first available when there is no id. */
export function photoChoiceFor(
  assetId: number | null | undefined,
): { id: number; path: string } | null {
  const all = photoChoices();
  if (assetId != null) {
    const found = all.find((p) => p.id === assetId);
    if (found) return found;
  }
  return all[0] ?? null;
}

export function addLibraryAsset(input: {
  filename: string;
  originalName: string;
  mimeType: string;
  kind?: "image" | "video";
  sizeBytes: number;
  width: number | null;
  height: number | null;
  label: string | null;
}) {
  const [row] = db
    .insert(schema.imageLibraryAssets)
    .values(input)
    .returning()
    .all();
  return row;
}

export function deleteLibraryAsset(id: number) {
  const row = getLibraryAsset(id);
  if (!row) return;
  const filePath = libraryFilePath(row.filename);
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn(`[image-library] couldn't delete ${filePath}:`, err);
  }
  db.delete(schema.imageLibraryAssets)
    .where(eq(schema.imageLibraryAssets.id, id))
    .run();
}
