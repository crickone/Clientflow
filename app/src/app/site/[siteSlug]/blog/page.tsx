import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { resolvePublicSite, siteUrl } from "@/lib/cms/resolveHost";
import { listPublishedPosts } from "@/lib/cms/blog";
import { excerptFromMarkdown } from "@/lib/cms/markdown";
import { getSiteChrome, CHROME_CONTENT_CSS } from "@/lib/cms/siteChrome";
import { SiteTracking } from "@/components/cms/SiteTracking";
import { SiteBeacon } from "@/components/cms/SiteBeacon";
import { siteVerificationMeta, resolvePageContext, studioEditZones } from "@/lib/cms/render";

import PublicSitePage, { generateMetadata as pageMetadata } from "../[...slug]/page";
import { siteRequestHost } from "@/lib/cms/requestHost";

export const dynamic = "force-dynamic";

/**
 * The blog index, inside the client's own site chrome.
 *
 * Everything visual comes from the site's stylesheet, navbar and footer (see
 * lib/cms/siteChrome). What is written here is only the SHAPE of a list of
 * articles: a three-across grid of picture, date, title and standfirst,
 * dropping to two and then one as the screen narrows.
 *
 * A stacked list was the first attempt and read as a search results page —
 * the pictures the client had chosen for each article were nowhere, and
 * nothing invited a click.
 */
/**
 * The index had no metadata of its own, so it inherited the app shell's —
 * the CRM's title, on a client's public website. Named here, with the
 * canonical URL and the site's search-console tag.
 */
/**
 * A site that ships its OWN page at /blog gets that page, not this list.
 *
 * This route is static, so Next.js picks it over the [...slug] catch-all for
 * /blog on every site -- which meant a bespoke site's own journal page at
 * /blog (Optimal Health's: a designed index of its articles, imported like any
 * other page) could never be seen. Every link to it landed here instead, on
 * the platform's generic list of CMS blog posts, which for that site is empty.
 *
 * The rule: if the site has a published page at /blog, hand the request to
 * the catch-all exactly as if this route did not exist -- the same render,
 * metadata, tracking and Studio edit canvas every other page gets. A site
 * without one keeps the list below, unchanged.
 */
const BLOG_PATH = ["blog"];
function ownsBlogPage(siteSlug: string, searchParams: { site?: string }): boolean {
  const pc = resolvePageContext({ siteSlug, slug: BLOG_PATH }, searchParams);
  return Boolean(pc && pc.template);
}

export function generateMetadata({
  params,
  searchParams,
}: {
  params: { siteSlug: string };
  searchParams: { site?: string };
}): Metadata {
  if (ownsBlogPage(params.siteSlug, searchParams)) {
    return pageMetadata({ params: { siteSlug: params.siteSlug, slug: BLOG_PATH }, searchParams });
  }
  const host = siteRequestHost();
  const resolved = resolvePublicSite({ host, siteParam: searchParams.site ?? params.siteSlug });
  if (!resolved) return { title: "Not found" };
  return {
    title: `Blog — ${resolved.site.name}`,
    alternates: { canonical: siteUrl(resolved, "/blog", host) },
    verification: siteVerificationMeta(resolved.site),
  };
}

export default async function PublicBlogIndex({
  params,
  searchParams,
}: {
  params: { siteSlug: string };
  searchParams: { site?: string; cmsedit?: string };
}) {
  // The Studio edit canvas resolves through the operator's own tenant, not
  // the host, so it is checked the way the catch-all checks it.
  const delegate =
    (searchParams.cmsedit === "1" && (await studioEditZones(params.siteSlug, "/blog")) !== null) ||
    ownsBlogPage(params.siteSlug, searchParams);
  if (delegate) {
    return PublicSitePage({ params: { siteSlug: params.siteSlug, slug: BLOG_PATH }, searchParams });
  }

  const host = siteRequestHost();
  const resolved = resolvePublicSite({
    host,
    siteParam: searchParams.site ?? params.siteSlug,
  });
  if (!resolved) notFound();

  const { db, site } = resolved;
  const posts = listPublishedPosts(db, site.id);
  const chrome = getSiteChrome(db, site.id);
  // A mapped domain serves the site at its root; everything else at the mount.
  const base = resolved.resolvedVia === "host" ? "" : `/site/${site.slug}`;

  return (
    <>
      <SiteTracking
        siteSlug={resolved.site.slug}
        pixelId={resolved.site.metaPixelId}
        googleTagId={resolved.site.googleTagId}
      />
      <SiteBeacon />
      <div dangerouslySetInnerHTML={{ __html: chrome.head }} />
      <style dangerouslySetInnerHTML={{ __html: CHROME_CONTENT_CSS }} />
      {chrome.header && <div dangerouslySetInnerHTML={{ __html: chrome.header }} />}

      <main className="cms-shell">
        <div className="cms-head">
          <h1>Blog</h1>
          <p>Training, nutrition and recovery, written by the team at {site.name}.</p>
        </div>

        {posts.length === 0 ? (
          <p>No posts published yet.</p>
        ) : (
          <ul className="cms-grid">
            {posts.map((p) => (
              <li className="cms-card" key={p.id}>
                <Link href={`${base}/blog/${p.slug}`}>
                  {p.coverImageUrl ? (
                    <div className="cms-card__media">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.coverImageUrl}
                        alt=""
                        loading="lazy"
                        style={{ objectPosition: p.coverPosition ?? "50% 50%" }}
                      />
                    </div>
                  ) : (
                    // Keeps the card the same height as its neighbours, so one
                    // picture-less article doesn't knock the row out of line.
                    <div className="cms-card__media--empty" />
                  )}
                  {p.publishedAt && (
                    <time dateTime={new Date(p.publishedAt).toISOString()}>
                      {new Date(p.publishedAt).toLocaleDateString("en-IE", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </time>
                  )}
                  <h2>{p.title}</h2>
                  <p>{p.excerpt || excerptFromMarkdown(p.content)}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>

      {chrome.footer && <div dangerouslySetInnerHTML={{ __html: chrome.footer }} />}
      {chrome.tail && <div dangerouslySetInnerHTML={{ __html: chrome.tail }} />}
    </>
  );
}
