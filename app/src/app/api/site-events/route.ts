import crypto from "node:crypto";
import { runWithTenant } from "@/lib/db/tenant";
import { resolvePublicSite, normalizeHost } from "@/lib/cms/resolveHost";
import { clientIp, rateLimit } from "@/lib/rateLimit";
import { cleanPath, cleanUtm, isBot, recordPageView, referrerDomain, visitorHash } from "@/lib/analytics/pageViews";
import { siteRequestHost } from "@/lib/cms/requestHost";

export const dynamic = "force-dynamic";

const NO_CONTENT = () => new Response(null, { status: 204 });
// Stable for the life of the process when no secret is configured: uniques
// then reset on a restart, which only over-counts, never leaks.
const FALLBACK_SECRET = crypto.randomUUID();

// Per-site ceiling, independent of the client-controlled forwarded IP: it
// bounds how far any one site's counts can be inflated whatever IPs the
// sender claims.
const SITE_LIMIT_PER_MIN = 600;
const MAX_BODY_CHARS = 4096;

/** Read the body up to `max` bytes; null when it is larger (the stream is cancelled). */
async function readBounded(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

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
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_BODY_CHARS) return NO_CONTENT();
    const ua = req.headers.get("user-agent");
    if (isBot(ua)) return NO_CONTENT();
    const host = siteRequestHost();
    const site = resolvePublicSite({ host, siteParam: null });
    if (!site || site.resolvedVia !== "host") return NO_CONTENT();
    if (!rateLimit(`site-events:site:${site.site.id}`, SITE_LIMIT_PER_MIN, 60_000).ok) return NO_CONTENT();
    const text = await readBounded(req, MAX_BODY_CHARS);
    if (text === null) return NO_CONTENT();
    let body: { p?: unknown; r?: unknown; u?: unknown } | null = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    const path = cleanPath(body?.p);
    if (!path) return NO_CONTENT();
    const day = new Date().toISOString().slice(0, 10);
    const base = process.env.ANALYTICS_SALT || process.env.EMAIL_TOKEN_SECRET || FALLBACK_SECRET;
    const key = crypto.createHmac("sha256", base).update("adonis:page-views:v1").digest("hex");
    runWithTenant(site.tenantId, () =>
      recordPageView(site.db, {
        siteId: site.site.id,
        day,
        path,
        referrerDomain: referrerDomain(typeof body?.r === "string" ? body.r : null, normalizeHost(host) ?? ""),
        utmSource: cleanUtm(body?.u),
        hash: visitorHash(key, day, site.site.id, ip, ua ?? ""),
      }),
    );
  } catch (err) {
    console.error("[recorder:page_views] beacon failed", err);
  }
  return NO_CONTENT();
}
