import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";

import { resolvePublicSite } from "@/lib/cms/resolveHost";
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
 *
 * ALWAYS STAYS ON THE HOST THE REQUEST ARRIVED ON, which is why it builds the
 * path by hand instead of calling siteUrl. siteUrl returns an absolute URL on
 * the site's `primary_host`, and that column is set as soon as a domain is
 * planned — long before DNS actually points anywhere. The first version of
 * this file used it, and on the preview host it issued a 308 to
 * inspirehealthandfitness.ie, which still serves the OLD site: a redirect
 * that pushed previewers off our platform and onto a 404 on the site we are
 * replacing. Fixing the path is this route's whole job; moving someone
 * between domains is a different concern and not one to do by accident.
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

  // A root-relative target keeps the browser on whatever host it is already
  // talking to. `resolvedVia` says which shape that host expects: a mapped
  // domain serves the site at its root, everything else at the /site/<slug>
  // mount.
  const prefix = resolved.resolvedVia === "host" ? "" : `/site/${resolved.site.slug}`;
  permanentRedirect(`${prefix}/blog/${post.slug}`);
}
