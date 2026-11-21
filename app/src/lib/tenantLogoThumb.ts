import "server-only";
import sharp from "sharp";

import { runWithTenant } from "@/lib/db/tenant";
import { resolveLogoPath } from "@/lib/branding";
import { ensureLogoShape } from "@/lib/logoShapeFile";

/**
 * A business's logo as a small inline PNG, for screens that list several
 * businesses at once (the account picker). Each is resolved inside its own
 * tenant, so there is no cross-tenant logo route to secure.
 *
 * It prefers the one-colour shape (`oneColour: true`): the caller paints it
 * in the theme's text colour, so it reads on light and dark. If there is no
 * shape, it is the logo as uploaded. Anything that fails is null, and the
 * caller shows an initial.
 */
export async function tenantLogoThumb(tenantId: number, px = 72): Promise<{ src: string; oneColour: boolean } | null> {
  try {
    const file = runWithTenant(tenantId, () => resolveLogoPath());
    if (!file) return null;
    const shape = await ensureLogoShape(file);
    const png = await sharp(shape ?? file, { density: 200 })
      .resize(px, px, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    return { src: `data:image/png;base64,${png.toString("base64")}`, oneColour: shape !== null };
  } catch {
    return null;
  }
}
