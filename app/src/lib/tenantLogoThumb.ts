import "server-only";
import sharp from "sharp";

import { runWithTenant } from "@/lib/db/tenant";
import { resolveLogoPath } from "@/lib/branding";

/**
 * A business's logo as a small inline PNG, for screens that list several
 * businesses at once (the account picker). Each is resolved inside its own
 * tenant, so there is no cross-tenant logo route to secure; anything that
 * fails (no logo, unreadable file) is null and the caller shows an initial.
 */
export async function tenantLogoThumb(tenantId: number, px = 72): Promise<string | null> {
  try {
    const file = runWithTenant(tenantId, () => resolveLogoPath());
    if (!file) return null;
    const png = await sharp(file, { density: 200 })
      .resize(px, px, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}
