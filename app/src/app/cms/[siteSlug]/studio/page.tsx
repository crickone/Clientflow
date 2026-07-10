import { notFound } from "next/navigation";

import { StudioShell } from "@/components/cms/StudioShell";
import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { listPages } from "@/lib/cms/pages";

export const dynamic = "force-dynamic";

export default async function StudioPage({
  params,
  searchParams,
}: {
  params: { siteSlug: string };
  searchParams: { path?: string };
}) {
  await requireAdminPage();
  const site = await getSiteBySlug(params.siteSlug);
  if (!site) notFound();

  const pages = listPages(site.id)
    .filter((p) => p.status === "published")
    .map((p) => ({ path: p.path, title: p.title || p.path }));

  const initialPath = searchParams.path || pages[0]?.path || "/";

  return (
    <StudioShell siteSlug={site.slug} pages={pages} initialPath={initialPath} />
  );
}
