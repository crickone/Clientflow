import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";
import { verifyRenderToken } from "@/lib/social/renderToken";
import { uploadDir } from "@/lib/video/projects";

export const dynamic = "force-dynamic";

/**
 * Serve one rendered video ad to Meta (which fetches it itself when the ad
 * is uploaded), by signed token only -- the same scheme as slide images. The
 * token names "v/<project>/<file>" and only ad output names are accepted.
 */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const claim = verifyRenderToken(decodeURIComponent(params.token));
  const m = claim ? /^v\/(\d+)\/(ad-(?:9x16|1x1)-\d+\.mp4)$/.exec(claim.filename) : null;
  if (!m) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  const file = path.join(uploadDir(Number(m[1]), claim!.tenantId), m[2]);
  if (!fs.existsSync(file)) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  const stat = fs.statSync(file);
  return new Response(fs.createReadStream(file) as unknown as BodyInit, {
    headers: {
      ...mediaSecurityHeaders(),
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Cache-Control": "private, max-age=3600",
    },
  });
}
