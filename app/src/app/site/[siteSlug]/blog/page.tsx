import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { resolvePublicSite } from "@/lib/cms/resolveHost";
import { listPublishedPosts } from "@/lib/cms/blog";
import { excerptFromMarkdown } from "@/lib/cms/markdown";

export const dynamic = "force-dynamic";

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

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#faf9f6",
        color: "#16161a",
        fontFamily: "var(--font-body), system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "80px 24px 120px" }}>
        <p style={{ letterSpacing: "0.18em", textTransform: "uppercase", fontSize: 12, color: "#ef5a24" }}>
          {site.name}
        </p>
        <h1 style={{ fontSize: "clamp(36px,6vw,56px)", margin: "12px 0 40px", fontWeight: 600 }}>
          Blog
        </h1>

        {posts.length === 0 ? (
          <p style={{ color: "#6b6b70" }}>No posts published yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 28 }}>
            {posts.map((p) => (
              <Link
                key={p.id}
                href={`/site/${params.siteSlug}/blog/${p.slug}`}
                style={{ display: "block", textDecoration: "none", color: "inherit" }}
              >
                <article style={{ borderBottom: "1px solid #e6e4de", paddingBottom: 24 }}>
                  <h2 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>{p.title}</h2>
                  {p.publishedAt && (
                    <time style={{ fontSize: 13, color: "#9a9a9f" }}>
                      {new Date(p.publishedAt).toLocaleDateString("en-IE", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </time>
                  )}
                  <p style={{ color: "#4a4a50", marginTop: 10 }}>
                    {p.excerpt || excerptFromMarkdown(p.content)}
                  </p>
                </article>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
