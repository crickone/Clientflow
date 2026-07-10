import "server-only";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { and, desc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { MediaAsset } from "@/lib/db/schema";
import type { TenantDb } from "@/lib/db/tenant";

const { mediaAssets } = schema;

// CMS media lives under data/cms/<siteId>/media. (CMS content is scoped to the
// agency tenant DB, so siteId is unique here.)
const ROOT = path.join(process.cwd(), "data", "cms");

export function mediaDir(siteId: number): string {
  return path.join(ROOT, String(siteId), "media");
}

export function mediaFilePath(siteId: number, filename: string): string {
  return path.join(mediaDir(siteId), path.basename(filename));
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/gif": ".gif",
};

export interface AddMediaInput {
  siteId: number;
  originalName: string;
  mimeType: string;
  bytes: Buffer;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}

export function addMediaAsset(input: AddMediaInput): MediaAsset {
  const dir = mediaDir(input.siteId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = EXT_BY_MIME[input.mimeType.toLowerCase()] ?? path.extname(input.originalName) ?? "";
  const filename = `${crypto.randomBytes(8).toString("hex")}${ext}`;
  fs.writeFileSync(path.join(dir, filename), input.bytes);

  return db
    .insert(mediaAssets)
    .values({
      siteId: input.siteId,
      filename,
      originalName: input.originalName,
      mimeType: input.mimeType,
      sizeBytes: input.bytes.length,
      width: input.width ?? null,
      height: input.height ?? null,
      alt: input.alt ?? null,
    })
    .returning()
    .get();
}

export function listMedia(siteId: number): MediaAsset[] {
  return db
    .select()
    .from(mediaAssets)
    .where(eq(mediaAssets.siteId, siteId))
    .orderBy(desc(mediaAssets.createdAt))
    .all();
}

export function updateMediaAlt(siteId: number, id: number, alt: string): void {
  db.update(mediaAssets)
    .set({ alt })
    .where(and(eq(mediaAssets.siteId, siteId), eq(mediaAssets.id, id)))
    .run();
}

export function deleteMediaAsset(siteId: number, id: number): void {
  const row = db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.siteId, siteId), eq(mediaAssets.id, id)))
    .get();
  if (!row) return;
  try {
    fs.rmSync(mediaFilePath(siteId, row.filename), { force: true });
  } catch {
    /* ignore fs errors */
  }
  db.delete(mediaAssets)
    .where(and(eq(mediaAssets.siteId, siteId), eq(mediaAssets.id, id)))
    .run();
}

/** PUBLIC read (explicit TenantDb). */
export function getMediaAssetPublic(
  publicDb: TenantDb,
  siteId: number,
  id: number,
): MediaAsset | null {
  return (
    publicDb
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.siteId, siteId), eq(mediaAssets.id, id)))
      .get() ?? null
  );
}

/** Build the public URL for a media asset (used in <img>, OG images). */
export function mediaUrl(siteSlug: string, id: number): string {
  return `/site-media/${siteSlug}/${id}`;
}
