import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import {
  addLibraryAsset,
  libraryDir,
  listLibraryAssets,
} from "@/lib/image/library";
import { processImageUpload } from "@/lib/image/processUpload";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_IMAGE = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);
const ALLOWED_VIDEO = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const VIDEO_EXT: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
};

export async function GET() {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const assets = listLibraryAssets();
  return NextResponse.json({ ok: true, assets });
}

export async function POST(req: Request) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid form data.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  const files = form
    .getAll("file")
    .filter((v): v is File => v instanceof File && v.size > 0);

  if (files.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No files supplied." },
      { status: 400 },
    );
  }

  const label = String(form.get("label") ?? "").trim() || null;
  const widthsRaw = form.getAll("width").map((v) => Number(v));
  const heightsRaw = form.getAll("height").map((v) => Number(v));

  const dir = libraryDir();
  const created: Array<ReturnType<typeof addLibraryAsset>> = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const mime = (file.type || "").toLowerCase();
    const isVideo = ALLOWED_VIDEO.has(mime);
    const isImage = ALLOWED_IMAGE.has(mime);
    if (mime && !isVideo && !isImage) {
      return NextResponse.json(
        {
          ok: false,
          error: `Unsupported file type: ${file.type}. Use JPEG, PNG, WebP, MP4, MOV or WebM.`,
        },
        { status: 400 },
      );
    }
    const prefix = isVideo ? "vid" : "img";
    const ext = (isVideo ? VIDEO_EXT[mime] : path.extname(file.name)) || (isVideo ? ".mp4" : ".jpg");
    const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`;
    const dest = path.join(dir, filename);
    const rawBuf = Buffer.from(await file.arrayBuffer());
    // Batch 5c: downscale + re-encode image uploads (background photos for
    // the carousel/card designer). Video/broll clips are left completely
    // untouched. Failure-safe — falls back to rawBuf if sharp can't decode.
    const { buffer: buf, width: procWidth, height: procHeight } = isVideo
      ? { buffer: rawBuf, width: null as number | null, height: null as number | null }
      : await processImageUpload(rawBuf, mime || "image/jpeg");
    fs.writeFileSync(dest, buf);
    // Prefer the actual (post-resize) dimensions; fall back to the client-
    // reported ones (measured pre-upload) for video, or if sharp couldn't
    // decode the image.
    const clientWidth = Number.isFinite(widthsRaw[i]) ? widthsRaw[i] : null;
    const clientHeight = Number.isFinite(heightsRaw[i]) ? heightsRaw[i] : null;
    const width = procWidth ?? clientWidth;
    const height = procHeight ?? clientHeight;
    const row = addLibraryAsset({
      filename,
      originalName: file.name,
      mimeType: mime || "image/jpeg",
      kind: isVideo ? "video" : "image",
      sizeBytes: buf.length,
      width,
      height,
      label,
    });
    created.push(row);
  }

  return NextResponse.json({ ok: true, assets: created });
}
