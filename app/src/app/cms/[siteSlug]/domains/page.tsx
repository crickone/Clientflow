import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { DomainsManager } from "@/components/cms/DomainsManager";
import { TrackingCard } from "@/components/cms/TrackingCard";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { isApexHost, listDomains, pointsAt } from "@/lib/cms/domains";
import { cnameTarget, getCustomHostname, hostnameConfig } from "@/lib/cms/customHostnames";

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

  const target = cnameTarget();
  const configured = hostnameConfig() !== null;
  // Live status per domain: Cloudflare's certificate state and whether the
  // DNS already points here. Both are network calls, run side by side.
  const domains = await Promise.all(
    listDomains(membership.tenant.id, site.id).map(async (d) => {
      const [cf, dns] = await Promise.all([configured ? getCustomHostname(d.host) : null, pointsAt(d.host, target)]);
      return {
        id: d.id,
        host: d.host,
        isPrimary: d.isPrimary,
        verified: Boolean(d.verifiedAt),
        verifyToken: d.verifyToken,
        apex: isApexHost(d.host),
        pointed: dns,
        https: cf ? { state: cf.state, detail: cf.detail } : null,
      };
    }),
  );

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={`CMS · ${site.name}`}
        title="Domains"
        subtitle="Connect the business's own web address to this site. The main address is the one used in links and by search engines."
      />
      <DomainsManager siteSlug={site.slug} domains={domains} target={target} configured={configured} />
      {/* The pixel lives beside the domain because they are one decision in
          practice: the day a client's domain points here is the day their old
          site stops reporting conversions. It is also on the site dashboard,
          but this is the screen an operator is on when they do the switch —
          and the visual editor's own sidebar links here, not there. */}
      <TrackingCard
        siteSlug={site.slug}
        initialPixelId={site.metaPixelId}
        initialGoogleTagId={site.googleTagId}
        initialSiteVerification={site.googleSiteVerification}
      />
    </div>
  );
}
