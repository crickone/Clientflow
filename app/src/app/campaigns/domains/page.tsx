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
    <div className="app-page">
      <PageHeader
        eyebrow="Email marketing"
        title="Sending domain"
        subtitle="The domain your email campaigns send from."
      />
      <DomainConnectCard domain={domain} />
    </div>
  );
}
