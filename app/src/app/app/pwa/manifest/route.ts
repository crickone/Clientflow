import { clientAppHost } from "@/lib/clientAppHost";
import { getClientSession } from "@/lib/clientAuth";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getThemeForTenant } from "@/lib/settings";
import { DEFAULT_THEME } from "@/lib/theme";

export const dynamic = "force-dynamic";

/**
 * "Add to home screen" details for the member app: the business's name and
 * colours, opening straight into /app. The business is the domain's (on its
 * own domain) or the signed-in member's.
 */
export function GET() {
  const tenantId = clientAppHost()?.tenantId ?? getClientSession()?.tenantId ?? null;
  const name = tenantId ? getBusinessProfileForTenant(tenantId).businessName || "Member app" : "Member app";
  const bg = tenantId ? getThemeForTenant(tenantId).bg : DEFAULT_THEME.bg;
  const manifest = {
    name,
    short_name: name.length > 12 ? name.split(/\s+/)[0] : name,
    start_url: "/app",
    scope: "/app",
    display: "standalone",
    background_color: bg,
    theme_color: bg,
    icons: [
      { src: "/app/pwa/icon?s=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app/pwa/icon?s=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app/pwa/icon?s=512&m=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-store" },
  });
}
