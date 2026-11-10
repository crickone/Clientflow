import { clientAppHost } from "@/lib/clientAppHost";
import { getClientSession } from "@/lib/clientAuth";
import { renderTenantIcon } from "@/lib/tenantIcon";

export const dynamic = "force-dynamic";

const SIZES = new Set([32, 180, 192, 512]);

/**
 * The member app's home-screen icon (and its browser-tab icon): the
 * business's logo on a square of its background colour, or its initial. See
 * lib/tenantIcon.ts. `m=1` leaves the wider margin a "maskable" icon needs.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const want = Number(url.searchParams.get("s") ?? 180);
  const size = SIZES.has(want) ? want : 180;
  const maskable = url.searchParams.get("m") === "1";
  const tenantId = clientAppHost()?.tenantId ?? getClientSession()?.tenantId ?? null;
  const png = await renderTenantIcon({ tenantId, size, maskable });
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } });
}
