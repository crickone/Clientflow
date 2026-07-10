import { guard } from "@/lib/api/guard";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { resolveTrackPath } from "@/lib/video/music";

export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
};

/**
 * Streams a music track for in-browser preview. Used by the music picker on
 * the project page. Path traversal is blocked by resolveTrackPath.
 */
export async function GET(req: Request) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const url = new URL(req.url);
  const filename = url.searchParams.get("file");
  if (!filename) {
    return NextResponse.json(
      { ok: false, error: "Missing file param." },
      { status: 400 },
    );
  }
  const filePath = resolveTrackPath(filename);
  if (!filePath) {
    return NextResponse.json(
      { ok: false, error: "Track not found." },
      { status: 404 },
    );
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.get("range");

  if (range) {
    const match = /bytes=(\d+)-(\d+)?/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : total - 1;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      return new Response(stream as unknown as BodyInit, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
        },
      });
    }
  }

  const stream = fs.createReadStream(filePath);
  return new Response(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
    },
  });
}
