import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { DomainsManager } from "@/components/cms/DomainsManager";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { listDomains } from "@/lib/cms/domains";

export const dynamic = "force-dynamic";

export default async function SiteDomainsPage({
  params,
}: {
  params: { siteSlug: string };
}) {
  await requireAdminPage();
  const membership = getCurrentMembership();
  const site = await getSiteBySlug(params.siteSlug);
  if (!site || !membership) notFound();

  const domains = listDomains(membership.tenant.id, site.id).map((d) => ({
    id: d.id,
    host: d.host,
    isPrimary: d.isPrimary,
  }));

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={`CMS · ${site.name}`}
        title="Domains"
        subtitle="Map hostnames to this site. The primary host is used for canonical/sitemap URLs."
      />
      <DomainsManager siteSlug={site.slug} domains={domains} />
    </div>
  );
}
