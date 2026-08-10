import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { BlogPostEditor } from "@/components/cms/BlogPostEditor";
import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { getSiteBlogPost } from "@/lib/cms/blog";

export const dynamic = "force-dynamic";

export default async function EditPostPage({
  params,
}: {
  params: { siteSlug: string; postId: string };
}) {
  await requireAdminPage();
  const site = await getSiteBySlug(params.siteSlug);
  if (!site) notFound();
  const post = getSiteBlogPost(site.id, Number(params.postId));
  if (!post) notFound();

  const siteBaseUrl = site.primaryHost
    ? `https://${site.primaryHost}`
    : `/site/${site.slug}`;

  return (
    <div className="app-page">
      <PageHeader eyebrow={`CMS · ${site.name} · Blog`} title="Edit post" />
      <BlogPostEditor
        siteSlug={site.slug}
        siteBaseUrl={siteBaseUrl}
        post={{
          id: post.id,
          title: post.title,
          slug: post.slug ?? "",
          excerpt: post.excerpt ?? "",
          content: post.content ?? "",
          seoTitle: post.seoTitle ?? "",
          seoDescription: post.seoDescription ?? "",
          coverImageUrl: post.coverImageUrl ?? null,
          coverAspect: post.coverAspect ?? null,
          coverPosition: post.coverPosition ?? null,
          status: post.status,
          publishState: post.publishState,
          scheduledFor: post.scheduledFor ? post.scheduledFor.toISOString() : null,
          error: post.error ?? null,
        }}
      />
    </div>
  );
}
