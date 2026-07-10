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
