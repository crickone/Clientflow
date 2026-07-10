import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { NewPostForm } from "@/components/cms/NewPostForm";
import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";

export const dynamic = "force-dynamic";

export default async function NewPostPage({
  params,
}: {
  params: { siteSlug: string };
}) {
  await requireAdminPage();
  const site = await getSiteBySlug(params.siteSlug);
  if (!site) notFound();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow={`CMS · ${site.name}`}
        title="New post"
        subtitle="Claude drafts a markdown post you can edit, optimise and publish."
      />
      <NewPostForm siteSlug={site.slug} />
    </div>
  );
}
