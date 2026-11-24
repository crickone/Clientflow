import fs from "node:fs";
import path from "node:path";

import { listTenants } from "@/lib/tenants";
import { resolveLogoPathForTenant } from "@/lib/branding";
import { mediaSecurityHeaders } from "@/lib/api/mediaSecurityHeaders";

export const dynamic = "force-dynamic";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/**
 * A business's uploaded logo for the emails it sends. An inbox loads images
 * with no session and from no business domain, so /api/branding/logo (which
 * finds the business from the session or the host) can't serve it. Public
 * by design: it is the same logo the business shows on its own website.
 * Raster only: Gmail drops SVG.
 */
export function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("t") ?? "";
  const tenant = listTenants().find((t) => t.slug === slug && t.isActive !== false);
  const file = tenant ? resolveLogoPathForTenant(tenant.id) : null;
  const type = file ? MIME[path.extname(file).toLowerCase()] : undefined;
  if (!file || !type || !fs.existsSync(file)) return new Response("Not found", { status: 404 });
  const stat = fs.statSync(file);
  return new Response(fs.createReadStream(file) as unknown as BodyInit, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(stat.size),
      // The URL carries the file's mtime (?v=), so a changed logo is a new URL.
      "Cache-Control": "public, max-age=86400",
      ...mediaSecurityHeaders(),
    },
  });
}
