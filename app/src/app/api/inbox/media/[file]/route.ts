import fs from "node:fs";

import { NextResponse, type NextRequest } from "next/server";

import { guard } from "@/lib/api/guard";
import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";
import { getCurrentTenant } from "@/lib/db/tenant";
import { inboxMediaPath } from "@/lib/inbox/media";
import { serveInfoForFile } from "@/lib/inbox/mediaModel";

export const dynamic = "force-dynamic";

/**
 * A photo, video, voice note or file from an inbox message:
 * /api/inbox/media/<file>. Signed-in staff only, and only from their own
 * business's folder (the name is looked up under the CURRENT business, so
 * another business's file is simply not there). Images, video and audio are
 * shown in place; everything else downloads. Range requests are answered so
 * video and voice notes can seek (Safari needs them to play at all).
 */
export async function GET(req: NextRequest, props: { params: Promise<{ file: string }> }) {
  const denied = await guard("user");
  if (denied) return denied;

  const { file } = await props.params;
  const full = inboxMediaPath(getCurrentTenant().slug, file);
  if (!full) return NextResponse.json({ ok: false, error: "Bad file name." }, { status: 400 });
  let size: number;
  try {
    const st = fs.statSync(full);
    if (!st.isFile()) throw new Error("not a file");
    size = st.size;
  } catch {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const { contentType, inline } = serveInfoForFile(file);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": inline ? "inline" : "attachment",
    "Cache-Control": "private, max-age=86400",
    "Accept-Ranges": "bytes",
    ...mediaSecurityHeaders(),
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    }
    return new Response(fs.createReadStream(full, { start, end }) as unknown as BodyInit, {
      status: 206,
      headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
    });
  }

  return new Response(fs.createReadStream(full) as unknown as BodyInit, {
    headers: { ...headers, "Content-Length": String(size) },
  });
}
