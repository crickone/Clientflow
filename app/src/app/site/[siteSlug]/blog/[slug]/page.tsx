import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { resolvePublicSite, siteUrl } from "@/lib/cms/resolveHost";
import { getPublishedPostBySlug } from "@/lib/cms/blog";
import { renderMarkdown, excerptFromMarkdown } from "@/lib/cms/markdown";
import { getSiteChrome, CHROME_CONTENT_CSS } from "@/lib/cms/siteChrome";

export const dynamic = "force-dynamic";

type Params = { siteSlug: string; slug: string };
type Search = { site?: string };

function resolve(params: Params, searchParams: Search) {
  const host = headers().get("host");
  const resolved = resolvePublicSite({
    host,
    siteParam: searchParams.site ?? params.siteSlug,
  });
  if (!resolved) return null;
  const post = getPublishedPostBySlug(resolved.db, resolved.site.id, params.slug);
  if (!post) return null;
  return { resolved, post, host };
}

export function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}): Metadata {
  const r = resolve(params, searchParams);
  if (!r) return { title: "Not found" };
  const { resolved, post, host } = r;
  const title = post.seoTitle || post.title;
  const description =
    post.seoDescription || post.excerpt || excerptFromMarkdown(post.content);
  const canonical = siteUrl(resolved, `/blog/${post.slug}`, host);
  return {
    title: `${title} — ${resolved.site.name}`,
    description,
    alternates: { canonical },
    openGraph: {
      title,
      description,
      type: "article",
      url: canonical,
      siteName: resolved.site.name,
      images: post.coverImageUrl
        ? [siteUrl(resolved, post.coverImageUrl, host)]
        : undefined,
    },
  };
}

export default function PublicBlogPost({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const r = resolve(params, searchParams);
  if (!r) notFound();
  const { resolved, post, host } = r;
  const html = renderMarkdown(post.content);
  const url = siteUrl(resolved, `/blog/${post.slug}`, host);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description:
      post.seoDescription || post.excerpt || excerptFromMarkdown(post.content),
    datePublished: post.publishedAt
      ? new Date(post.publishedAt).toISOString()
      : undefined,
    dateModified: new Date(post.updatedAt).toISOString(),
    mainEntityOfPage: url,
    publisher: { "@type": "Organization", name: resolved.site.name },
  };

  const chrome = getSiteChrome(resolved.db, resolved.site.id);
  // A mapped domain serves the site at its root; everything else at the mount.
  const base = resolved.resolvedVia === "host" ? "" : `/site/${resolved.site.slug}`;

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: chrome.head }} />
      <style dangerouslySetInnerHTML={{ __html: CHROME_CONTENT_CSS }} />
      {chrome.header && <div dangerouslySetInnerHTML={{ __html: chrome.header }} />}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <main className="cms-shell cms-shell--narrow">
        <a className="cms-back" href={`${base}/blog`}>
          &larr; Back to blog
        </a>
        <h1 style={{ fontSize: "clamp(31px,4.6vw,52px)", lineHeight: 1.08, margin: 0 }}>
          {post.title}
        </h1>
        {post.publishedAt && (
          <time className="cms-meta" dateTime={new Date(post.publishedAt).toISOString()}>
            {new Date(post.publishedAt).toLocaleDateString("en-IE", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
        )}
        {post.coverImageUrl && (
          <div className="cms-hero" style={{ aspectRatio: post.coverAspect ?? undefined }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.coverImageUrl}
              alt=""
              style={{ objectPosition: post.coverPosition ?? "50% 50%" }}
            />
          </div>
        )}
        <div className="cms-prose" dangerouslySetInnerHTML={{ __html: html }} />
      </main>

      {chrome.footer && <div dangerouslySetInnerHTML={{ __html: chrome.footer }} />}
      {chrome.tail && <div dangerouslySetInnerHTML={{ __html: chrome.tail }} />}
    </>
  );
}
