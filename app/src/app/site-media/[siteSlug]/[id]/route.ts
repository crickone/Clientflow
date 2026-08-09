import { NextResponse } from "next/server";
import fs from "node:fs";
import { headers } from "next/headers";

import { resolvePublicSite } from "@/lib/cms/resolveHost";
import { getMediaAssetPublic, mediaFilePath } from "@/lib/cms/media";
import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { siteSlug: string; id: string } },
) {
  const host = headers().get("host");
  const resolved = resolvePublicSite({ host, siteParam: params.siteSlug });
  if (!resolved) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const asset = getMediaAssetPublic(resolved.db, resolved.site.id, Number(params.id));
  if (!asset) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const fp = mediaFilePath(resolved.site.id, asset.filename);
  if (!fs.existsSync(fp)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const buf = fs.readFileSync(fp);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": asset.mimeType || "application/octet-stream",
      "Cache-Control": "public, max-age=3600",
      ...mediaSecurityHeaders(),
    },
  });
}
