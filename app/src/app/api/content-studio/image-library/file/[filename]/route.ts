import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { libraryFilePath } from "@/lib/image/library";

export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
};
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm"]);

export async function GET(
  req: Request,
  { params }: { params: { filename: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const filename = decodeURIComponent(params.filename);
  const filePath = libraryFilePath(filename);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 },
    );
  }
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? "application/octet-stream";
  const size = fs.statSync(filePath).size;

  // Videos: honour HTTP Range so the browser can scrub / stream smoothly.
  const range = req.headers.get("range");
  if (VIDEO_EXT.has(ext) && range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m && m[1] ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (start >= size || end >= size || start > end) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const chunk = fs.readFileSync(filePath).subarray(start, end + 1);
    return new NextResponse(chunk, {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk.length),
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  const buf = fs.readFileSync(filePath);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Cache-Control": "private, max-age=300",
      ...(VIDEO_EXT.has(ext) ? { "Accept-Ranges": "bytes" } : {}),
    },
  });
}
