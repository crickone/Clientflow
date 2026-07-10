import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { MediaManager, type MediaItem } from "@/components/cms/MediaManager";
import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { listMedia, mediaUrl } from "@/lib/cms/media";

export const dynamic = "force-dynamic";

export default async function SiteMediaPage({
  params,
}: {
  params: { siteSlug: string };
}) {
  await requireAdminPage();
  const site = await getSiteBySlug(params.siteSlug);
  if (!site) notFound();

  const items: MediaItem[] = listMedia(site.id).map((m) => ({
    id: m.id,
    url: mediaUrl(site.slug, m.id),
    originalName: m.originalName,
    alt: m.alt ?? "",
    mimeType: m.mimeType,
  }));

  return (
    <div className="app-page">
      <PageHeader eyebrow={`CMS · ${site.name}`} title="Media library" />
      <MediaManager siteSlug={site.slug} items={items} />
    </div>
  );
}
