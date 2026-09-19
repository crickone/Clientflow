import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";

import { resolvePublicSite, siteUrl } from "@/lib/cms/resolveHost";
import { getPublishedPostBySlug } from "@/lib/cms/blog";

export const dynamic = "force-dynamic";

/**
 * Keep the old blog URLs working after a site migration.
 *
 * Webflow publishes articles under `/blog-posts/<slug>`; this CMS serves them
 * at `/blog/<slug>`. When a client's domain moves over, every link anyone has
 * ever shared and every search result Google holds still points at the old
 * path. Without this they all become 404s on the day of the switch, which is
 * the single most expensive thing a site migration can get wrong: the client
 * loses the ranking they built, and it is slow and painful to win back.
 *
 * The article slugs themselves are carried across unchanged by
 * tools/scrape-webflow-blog.cjs, so only the prefix differs — which means a
 * redirect is all that is needed, and no content has to move.
 *
 * A PERMANENT redirect (308), deliberately. A temporary one tells search
 * engines the old URL is still the real one, so the new address never
 * inherits the ranking. Permanent is also what makes browsers and other sites
 * eventually update their own links.
 *
 * Only redirects to a post that actually EXISTS and is published. Sending a
 * request for a deleted article to a URL that is also a 404 turns one honest
 * missing page into a redirect chain ending in the same place, which is worse
 * for both a reader and a crawler than simply saying it is gone.
 */
export default function LegacyBlogPostUrl({
  params,
  searchParams,
}: {
  params: { siteSlug: string; slug: string };
  searchParams: { site?: string };
}) {
  const host = headers().get("host");
  const resolved = resolvePublicSite({
    host,
    siteParam: searchParams.site ?? params.siteSlug,
  });
  if (!resolved) notFound();

  const post = getPublishedPostBySlug(resolved.db, resolved.site.id, params.slug);
  if (!post) notFound();

  // siteUrl gives a clean domain-root URL once a primary host is mapped, and
  // the /site/<slug> mount before then — so this lands in the right place
  // both on the client's own domain and on the preview host.
  permanentRedirect(siteUrl(resolved, `/blog/${post.slug}`, host));
}
