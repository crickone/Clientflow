import { guard } from "@/lib/api/guard";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { uploadDir } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

/**
 * Serve a single project asset (the main clip or any B-roll) to the browser
 * so the timeline editor can scrub it. Supports HTTP range requests so the
 * <video> element can seek without re-downloading.
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string; assetId: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const projectId = Number(params.id);
  const assetId = Number(params.assetId);

  const asset = db
    .select()
    .from(schema.videoAssets)
    .where(
      and(
        eq(schema.videoAssets.id, assetId),
        eq(schema.videoAssets.projectId, projectId),
      ),
    )
    .get();

  if (!asset) {
    return NextResponse.json(
      { ok: false, error: "Asset not found." },
      { status: 404 },
    );
  }

  const filePath = path.join(uploadDir(projectId), asset.filename);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { ok: false, error: "Asset file missing on disk." },
      { status: 404 },
    );
  }

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.get("range");
  const mime = asset.mimeType || "video/mp4";

  if (range) {
    const match = /bytes=(\d+)-(\d+)?/.exec(range);
    if (match) {
      const start = Number(match[1]);
      let end = match[2] ? Number(match[2]) : total - 1;
      if (start >= total) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${total}`,
            "Accept-Ranges": "bytes",
          },
        });
      }
      if (end >= total) end = total - 1;
      if (end < start) end = start;
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      return new Response(stream as unknown as BodyInit, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": mime,
          "Cache-Control": "private, max-age=300",
        },
      });
    }
  }

  const stream = fs.createReadStream(filePath);
  return new Response(stream as unknown as BodyInit, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(total),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=300",
    },
  });
}
