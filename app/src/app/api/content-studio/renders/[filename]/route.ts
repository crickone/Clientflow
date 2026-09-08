import { guard } from "@/lib/api/guard";
import { NextResponse } from "next/server";
import fs from "node:fs";

import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";
import { renderFilePath } from "@/lib/image/renderStore";

export const dynamic = "force-dynamic";

/**
 * Serve a rendered slide PNG.
 *
 * These are always PNGs this app produced, never an upload, so there is no MIME
 * table here -- but the shared media security headers still apply, because a
 * file-serving route is a file-serving route.
 *
 * The filename is a content hash, so the bytes behind a URL can never change
 * and the response is cached hard. `private` because a render is a tenant's
 * work, not public.
 */
export async function GET(
  _req: Request,
  { params }: { params: { filename: string } },
) {
  const __auth = await guard("user");
  if (__auth) return __auth;

  const filename = decodeURIComponent(params.filename);
  const file = renderFilePath(filename);
  if (!fs.existsSync(file)) {
    return NextResponse.json(
      { ok: false, error: "Render not found." },
      { status: 404 },
    );
  }

  return new NextResponse(fs.readFileSync(file), {
    headers: {
      ...mediaSecurityHeaders(),
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
