import { NextResponse } from "next/server";

import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";
import { resolvePublicSite } from "@/lib/cms/resolveHost";
import { siteRequestHost } from "@/lib/cms/requestHost";
import { siteIconResponse } from "@/lib/cms/siteIcon";

export const dynamic = "force-dynamic";

/**
 * A business website's favicon (lib/cms/siteIcon.ts). Resolved like every
 * public site route: by the verified domain first, so on a client's own
 * domain the slug in the path does not matter.
 */
export async function GET(_req: Request, props: { params: Promise<{ siteSlug: string }> }) {
  const params = await props.params;
  const resolved = resolvePublicSite({ host: siteRequestHost(), siteParam: params.siteSlug });
  if (!resolved) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const icon = await siteIconResponse(resolved);
  return new NextResponse(new Uint8Array(icon.body), {
    status: 200,
    headers: {
      "Content-Type": icon.type,
      // The link carries a version, so a long cache is safe.
      "Cache-Control": "public, max-age=86400",
      ...mediaSecurityHeaders(),
    },
  });
}
