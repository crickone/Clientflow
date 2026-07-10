import { guard } from "@/lib/api/guard";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getProject, uploadDir } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;
  const id = Number(params.id);
  const project = getProject(id);
  if (!project || !project.outputFilename) {
    return NextResponse.json(
      { ok: false, error: "No output rendered yet." },
      { status: 404 },
    );
  }
  const filePath = path.join(uploadDir(id), project.outputFilename);
  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { ok: false, error: "Output file missing on disk." },
      { status: 404 },
    );
  }

  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.get("range");
  const download = new URL(req.url).searchParams.get("download") === "1";

  if (range) {
    const match = /bytes=(\d+)-(\d+)?/.exec(range);
    if (match) {
      const start = Number(match[1]);
      let end = match[2] ? Number(match[2]) : total - 1;
      // Guard against stale clients asking for a range past the file end
      // (e.g. after a re-render produced a smaller file). 416 tells the
      // browser to re-request from byte 0.
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
          "Content-Type": "video/mp4",
          "Cache-Control": "no-store",
        },
      });
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Content-Length": String(total),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };
  if (download) {
    headers["Content-Disposition"] = `attachment; filename="${project.name.replace(
      /[^a-zA-Z0-9-_ ]/g,
      "",
    ) || "renova-reel"}.mp4"`;
  }
  const stream = fs.createReadStream(filePath);
  return new Response(stream as unknown as BodyInit, { headers });
}
