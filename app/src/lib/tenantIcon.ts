import "server-only";

import sharp from "sharp";

import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { resolveLogoPathForTenant } from "@/lib/branding";
import { getThemeForTenant } from "@/lib/settings";
import { DEFAULT_THEME } from "@/lib/theme";

/**
 * A square icon for a business: its logo centred on a square of its
 * background colour (logos are usually wide, icons are square), or its first
 * initial when it has no logo. `maskable` leaves the wider margin a
 * "maskable" Android icon needs.
 *
 * Used by the member app's home-screen icon and as the fallback favicon of a
 * business's website (lib/cms/siteIcon.ts), so a business never shows the
 * platform's mark on its own pages.
 */
export async function renderTenantIcon(opts: {
  tenantId: number | null;
  size: number;
  maskable?: boolean;
}): Promise<Buffer> {
  const { tenantId, size } = opts;
  const theme = tenantId ? getThemeForTenant(tenantId) : DEFAULT_THEME;
  const box = Math.round(size * (opts.maskable ? 0.6 : 0.74));
  const logo = tenantId ? resolveLogoPathForTenant(tenantId) : null;
  try {
    if (!logo) throw new Error("no logo");
    const inner = await sharp(logo, { density: 300 }).resize(box, box, { fit: "inside" }).png().toBuffer();
    return await sharp({ create: { width: size, height: size, channels: 4, background: theme.bg } })
      .composite([{ input: inner, gravity: "center" }])
      .png()
      .toBuffer();
  } catch {
    const name = tenantId ? getBusinessProfileForTenant(tenantId).businessName : "";
    const letter = (name.trim()[0] ?? "A").toUpperCase().replace(/[<>&"']/g, "");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${theme.bg}"/><text x="50%" y="50%" dy="0.35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="700" font-size="${Math.round(box * 0.7)}" fill="${theme.accent}">${letter}</text></svg>`;
    return await sharp(Buffer.from(svg)).png().toBuffer();
  }
}
