import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { resolvePublicSite } from "@/lib/cms/resolveHost";
import { listPublishedPosts } from "@/lib/cms/blog";
import { excerptFromMarkdown } from "@/lib/cms/markdown";
import { getSiteChrome, CHROME_CONTENT_CSS } from "@/lib/cms/siteChrome";

export const dynamic = "force-dynamic";

/**
 * The blog index, inside the client's own site chrome.
 *
 * This page used to hardcode a cream background, an orange accent and a
 * system font — the same look for every tenant on the platform, and nobody's
 * actual brand. On a gym whose site is black and gold it read as a different
 * website, which is exactly what it was.
 *
 * Everything visual now comes from the site's own stylesheet, navbar and
 * footer (see lib/cms/siteChrome). What is written here is only the shape of
 * a list of articles.
 */
export default function PublicBlogIndex({
  params,
  searchParams,
}: {
  params: { siteSlug: string };
  searchParams: { site?: string };
}) {
  const host = headers().get("host");
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
      <div dangerouslySetInnerHTML={{ __html: chrome.head }} />
      <style dangerouslySetInnerHTML={{ __html: CHROME_CONTENT_CSS }} />
      {chrome.header && <div dangerouslySetInnerHTML={{ __html: chrome.header }} />}

      <main className="cms-shell">
        <h1>Blog</h1>
        {posts.length === 0 ? (
          <p>No posts published yet.</p>
        ) : (
          <ul className="cms-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {posts.map((p) => (
              <li key={p.id}>
                <article>
                  <Link href={`${base}/blog/${p.slug}`}>
                    <h2>{p.title}</h2>
                    {p.publishedAt && (
                      <time dateTime={new Date(p.publishedAt).toISOString()}>
                        {new Date(p.publishedAt).toLocaleDateString("en-IE", {
                          year: "numeric",
                          month: "long",
                          day: "numeric",
                        })}
                      </time>
                    )}
                    <p>{p.excerpt || excerptFromMarkdown(p.content)}</p>
                  </Link>
                </article>
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
