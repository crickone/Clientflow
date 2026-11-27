import fs from "node:fs";

import { NextResponse } from "next/server";

import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";
import { verifyPublicFile } from "@/lib/attachments/publicLink";
import { getTenantById } from "@/lib/db/tenant";
import { inboxMediaPath } from "@/lib/inbox/media";
import { serveInfoForFile } from "@/lib/inbox/mediaModel";

export const dynamic = "force-dynamic";

/**
 * Serve one file a staff member is sending on Instagram to Meta, which fetches
 * it with no session, by signed 15-minute link only. See
 * lib/attachments/publicLink.ts for what the token proves. Only the file the
 * token names, only from that token's business's inbox-media folder. A bad,
 * expired or stale link is a 404 (nothing to tell an outsider about what
 * exists). Images, video and audio are served inline; everything else as a
 * download, with nosniff and the sandbox CSP on every answer.
 */
export async function GET(_req: Request, props: { params: Promise<{ token: string }> }) {
  const notFound = () => NextResponse.json({ ok: false, error: "Not found." }, { status: 404, headers: mediaSecurityHeaders() });
  const { token } = await props.params;
  let raw: string;
  try {
    raw = decodeURIComponent(token);
  } catch {
    return notFound();
  }
  const claim = verifyPublicFile(raw);
  if (!claim) return notFound();

  const tenant = getTenantById(claim.tenantId);
  if (!tenant) return notFound();
  let full: string | null;
  try {
    full = inboxMediaPath(tenant.slug, claim.file);
  } catch {
    return notFound();
  }
  if (!full) return notFound();
  let size: number;
  try {
    const st = fs.statSync(full);
    if (!st.isFile()) return notFound();
    size = st.size;
  } catch {
    return notFound();
  }

  const { contentType, inline } = serveInfoForFile(claim.file);
  return new Response(fs.createReadStream(full) as unknown as BodyInit, {
    headers: {
      ...mediaSecurityHeaders(),
      "Content-Type": contentType,
      "Content-Disposition": inline ? "inline" : "attachment",
      "Content-Length": String(size),
      "Cache-Control": "private, no-store",
    },
  });
}
