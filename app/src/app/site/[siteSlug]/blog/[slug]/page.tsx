import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { resolvePublicSite, siteUrl } from "@/lib/cms/resolveHost";
import { getPublishedPostBySlug } from "@/lib/cms/blog";
import { renderMarkdown, excerptFromMarkdown } from "@/lib/cms/markdown";

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

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#faf9f6",
        color: "#16161a",
        fontFamily: "var(--font-body), system-ui, sans-serif",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <article style={{ maxWidth: 720, margin: "0 auto", padding: "80px 24px 120px" }}>
        <a
          href={`/site/${params.siteSlug}/blog`}
          style={{ fontSize: 13, color: "#ef5a24", textDecoration: "none" }}
        >
          ← Back to blog
        </a>
        <h1 style={{ fontSize: "clamp(32px,5vw,52px)", margin: "16px 0 8px", fontWeight: 600 }}>
          {post.title}
        </h1>
        {post.publishedAt && (
          <time style={{ fontSize: 14, color: "#9a9a9f" }}>
            {new Date(post.publishedAt).toLocaleDateString("en-IE", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </time>
        )}
        {post.coverImageUrl && (
          <div
            style={{
              width: "100%",
              aspectRatio: post.coverAspect ?? "16 / 9",
              maxHeight: 460,
              overflow: "hidden",
              borderRadius: 12,
              margin: "28px 0 0",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={post.coverImageUrl}
              alt={post.title}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: post.coverPosition ?? "50% 50%",
                display: "block",
              }}
            />
          </div>
        )}
        <div
          className="cms-prose"
          style={{ marginTop: 32, lineHeight: 1.75, fontSize: 17 }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </article>
    </main>
  );
}
