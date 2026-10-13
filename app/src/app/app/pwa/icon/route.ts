import sharp from "sharp";

import { clientAppHost } from "@/lib/clientAppHost";
import { getClientSession } from "@/lib/clientAuth";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { resolveLogoPathForTenant } from "@/lib/branding";
import { getThemeForTenant } from "@/lib/settings";
import { DEFAULT_THEME } from "@/lib/theme";

export const dynamic = "force-dynamic";

const SIZES = new Set([180, 192, 512]);

/**
 * The member app's home-screen icon: the business's logo centred on a square
 * of its background colour (logos are usually wide, icons are square), or its
 * first initial when it has no logo. `m=1` leaves the wider margin a
 * "maskable" Android icon needs.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const want = Number(url.searchParams.get("s") ?? 180);
  const size = SIZES.has(want) ? want : 180;
  const maskable = url.searchParams.get("m") === "1";
  const tenantId = clientAppHost()?.tenantId ?? getClientSession()?.tenantId ?? null;
  const bg = tenantId ? getThemeForTenant(tenantId).bg : DEFAULT_THEME.bg;
  const accent = tenantId ? getThemeForTenant(tenantId).accent : DEFAULT_THEME.accent;
  const box = Math.round(size * (maskable ? 0.6 : 0.74));

  let png: Buffer;
  const logo = tenantId ? resolveLogoPathForTenant(tenantId) : null;
  try {
    if (!logo) throw new Error("no logo");
    const inner = await sharp(logo, { density: 300 }).resize(box, box, { fit: "inside" }).png().toBuffer();
    png = await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
      .composite([{ input: inner, gravity: "center" }])
      .png()
      .toBuffer();
  } catch {
    const name = tenantId ? getBusinessProfileForTenant(tenantId).businessName : "";
    const letter = (name.trim()[0] ?? "A").toUpperCase().replace(/[<>&"']/g, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${Math.round(box * 0.7)}" fill="${accent}">${letter}</text></svg>`;
    png = await sharp(Buffer.from(svg)).png().toBuffer();
  }
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
}
