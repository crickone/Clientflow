import "server-only";

import crypto from "node:crypto";
import path from "node:path";

import { controlSqlite } from "@/lib/db/control";
import { putObject, deleteObject } from "@/lib/cms/storage";

/**
 * Shared CMS media library — a single global pool of images usable across every
 * site and tenant. Rows live in the control plane (cms_library_assets); bytes go
 * through the storage layer. Public delivery is /library-media/<id>.
 */

export interface LibraryAsset {
  id: number;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  createdAt: number;
}

type Row = {
  id: number;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  alt: string | null;
  created_at: number;
};

const toAsset = (r: Row): LibraryAsset => ({
  id: r.id,
  storageKey: r.storage_key,
  originalName: r.original_name,
  mimeType: r.mime_type,
  sizeBytes: r.size_bytes,
  width: r.width,
  height: r.height,
  alt: r.alt,
  createdAt: r.created_at,
});

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/gif": ".gif",
};

export interface AddLibraryInput {
  originalName: string;
  mimeType: string;
  bytes: Buffer;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}

export async function addLibraryAsset(
  input: AddLibraryInput,
): Promise<LibraryAsset> {
  const ext =
    EXT_BY_MIME[input.mimeType.toLowerCase()] ||
    path.extname(input.originalName) ||
    "";
  const storageKey = `${crypto.randomBytes(8).toString("hex")}${ext}`;
  await putObject(storageKey, input.bytes);

  const info = controlSqlite
    .prepare(
      `INSERT INTO cms_library_assets
         (storage_key, original_name, mime_type, size_bytes, width, height, alt)
       VALUES (?,?,?,?,?,?,?)`,
    )
    .run(
      storageKey,
      input.originalName,
      input.mimeType,
      input.bytes.length,
      input.width ?? null,
      input.height ?? null,
      input.alt ?? null,
    );

  return getLibraryAsset(Number(info.lastInsertRowid))!;
}

export function listLibraryAssets(): LibraryAsset[] {
  return (
    controlSqlite
      .prepare("SELECT * FROM cms_library_assets ORDER BY created_at DESC")
      .all() as Row[]
  ).map(toAsset);
}

export function getLibraryAsset(id: number): LibraryAsset | null {
  const r = controlSqlite
    .prepare("SELECT * FROM cms_library_assets WHERE id=?")
    .get(id) as Row | undefined;
  return r ? toAsset(r) : null;
}

export function updateLibraryAlt(id: number, alt: string): void {
  controlSqlite
    .prepare("UPDATE cms_library_assets SET alt=? WHERE id=?")
    .run(alt, id);
}

export async function deleteLibraryAsset(id: number): Promise<void> {
  const asset = getLibraryAsset(id);
  if (!asset) return;
  await deleteObject(asset.storageKey);
  controlSqlite.prepare("DELETE FROM cms_library_assets WHERE id=?").run(id);
}

/** Public URL for a library asset — works on any site (global serve route). */
export function libraryUrl(id: number): string {
  return `/library-media/${id}`;
}
