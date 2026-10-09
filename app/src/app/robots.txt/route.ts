
import { resolvePublicSiteForCrawlers as resolvePublicSite, absoluteUrl } from "@/lib/cms/resolveHost";
import { siteRequestHost } from "@/lib/cms/requestHost";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const host = siteRequestHost();
  const url = new URL(req.url);
  const resolved = resolvePublicSite({
    host,
    siteParam: url.searchParams.get("site"),
  });

  // Unknown host → disallow everything (e.g. the bare admin host).
  if (!resolved) {
    return new Response("User-agent: *\nDisallow: /\n", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const sitemap = absoluteUrl(resolved, "/sitemap.xml", host);
  const body = `User-agent: *\nAllow: /\nSitemap: ${sitemap}\n`;
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
