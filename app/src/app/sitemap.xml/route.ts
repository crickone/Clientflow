import { headers } from "next/headers";

import { resolvePublicSite, siteUrl } from "@/lib/cms/resolveHost";
import { listPublishedPagesForSitemap } from "@/lib/cms/pages";
import { listPublishedPosts } from "@/lib/cms/blog";

export const dynamic = "force-dynamic";

/**
 * Per-host sitemap. Resolves the site from the request Host (production) or the
 * ?site=<slug> dev fallback, and lists its published pages + blog posts using
 * the site's canonical (primary) host for <loc>.
 */
export async function GET(req: Request) {
  const host = headers().get("host");
  const url = new URL(req.url);
  const resolved = resolvePublicSite({
    host,
    siteParam: url.searchParams.get("site"),
  });
  if (!resolved) {
    return new Response("Site not found", { status: 404 });
  }

  const pages = listPublishedPagesForSitemap(resolved.db, resolved.site.id);
  const posts = listPublishedPosts(resolved.db, resolved.site.id);

  const urls: { loc: string; lastmod?: string }[] = [];
  for (const p of pages) {
    if (!p.showInSitemap) continue;
    urls.push({
      loc: siteUrl(resolved, p.path, host),
      lastmod: new Date(p.updatedAt).toISOString(),
    });
  }
  for (const post of posts) {
    urls.push({
      loc: siteUrl(resolved, `/blog/${post.slug}`, host),
      lastmod: new Date(post.updatedAt).toISOString(),
    });
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`,
      )
      .join("\n") +
    `\n</urlset>\n`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
