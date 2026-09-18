import { NextResponse } from "next/server";
import fs from "node:fs";

import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";
import { renderFilePath } from "@/lib/image/renderStore";
import { verifyRenderToken } from "@/lib/social/renderToken";

export const dynamic = "force-dynamic";

/**
 * Serve one rendered slide to an unauthenticated fetcher (Meta), by signed
 * token only. See lib/social/renderToken.ts for what the token proves. A bad
 * or expired token is a 404, not a 403: there is nothing to tell an outsider
 * about what exists behind this route.
 */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const claim = verifyRenderToken(decodeURIComponent(params.token));
  if (!claim) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  const file = renderFilePath(claim.filename);
  if (!fs.existsSync(file)) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  return new NextResponse(fs.readFileSync(file), {
    headers: {
      ...mediaSecurityHeaders(),
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
