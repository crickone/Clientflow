import { headers } from "next/headers";
import { runWithTenant } from "@/lib/db/tenant";
import { resolvePublicSite, normalizeHost } from "@/lib/cms/resolveHost";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { cleanPath, cleanUtm, isBot, recordPageView, referrerDomain, visitorHash } from "@/lib/analytics/pageViews";

export const dynamic = "force-dynamic";

const NO_CONTENT = () => new Response(null, { status: 204 });
// Stable for the life of the process when no secret is configured: uniques
// then reset on a restart, which only over-counts, never leaks.
const FALLBACK_SECRET = crypto.randomUUID();

/**
 * First-party, cookieless page-view beacon for tenant websites (dashboard
 * slice 2). Always 204: a visitor's browser must never see an error from
 * analytics. Counted only when the request host maps to a verified site
 * domain, so dev previews and forged hosts count nothing.
 */
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    if (!rateLimit(`site-events:${ip}`, 120, 60_000).ok) return NO_CONTENT();
    const ua = req.headers.get("user-agent");
    if (isBot(ua)) return NO_CONTENT();
    const host = headers().get("host");
    const site = resolvePublicSite({ host, siteParam: null });
    if (!site || site.resolvedVia !== "host") return NO_CONTENT();
    const body = (await req.json().catch(() => null)) as { p?: unknown; r?: unknown; u?: unknown } | null;
    const path = cleanPath(body?.p);
    if (!path) return NO_CONTENT();
    const day = new Date().toISOString().slice(0, 10);
    const secret = process.env.ANALYTICS_SALT || process.env.EMAIL_TOKEN_SECRET || FALLBACK_SECRET;
    runWithTenant(site.tenantId, () =>
      recordPageView(site.db, {
        siteId: site.site.id,
        day,
        path,
        referrerDomain: referrerDomain(typeof body?.r === "string" ? body.r : null, normalizeHost(host) ?? ""),
        utmSource: cleanUtm(body?.u),
        hash: visitorHash(secret, day, site.site.id, ip, ua ?? ""),
      }),
    );
  } catch (err) {
    console.error("[recorder:page_views] beacon failed", err);
  }
  return NO_CONTENT();
}
