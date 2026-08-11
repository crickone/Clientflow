import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { getSendingDomain } from "@/lib/marketing/domains";
import { PageHeader } from "@/components/layout/PageHeader";
import { DomainConnectCard } from "@/components/campaigns/DomainConnectCard";

export const dynamic = "force-dynamic";

export default async function SendingDomainsPage() {
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;
  const domain = getSendingDomain(tenantId);

  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader
        eyebrow="Email marketing"
        title="Sending domain"
        subtitle="Connect a domain to send campaigns from your own address instead of a shared one."
      />
      <DomainConnectCard domain={domain} />
    </div>
  );
}
