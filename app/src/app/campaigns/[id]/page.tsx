import { notFound } from "next/navigation";

import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { getCampaign, listContactTags, resolveAudience } from "@/lib/marketing/campaigns";
import { getSendingDomain } from "@/lib/marketing/domains";
import { PageHeader } from "@/components/layout/PageHeader";
import { CampaignEditor } from "@/components/campaigns/CampaignEditor";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdminPage();
  const id = Number(params.id);
  if (!Number.isInteger(id)) notFound();

  const campaign = getCampaign(id);
  if (!campaign) notFound();

  const tenantId = getCurrentMembership()!.tenant.id;
  const domain = getSendingDomain(tenantId);
  const tags = listContactTags();
  // As-of-last-save recipient count (not a live/unsaved preview) — cheap to
  // compute here since resolveAudience just needs the campaign's own
  // (already parsed) audience field.
  const recipientCount = resolveAudience(campaign).emails.length;

  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <PageHeader
        eyebrow="Email marketing"
        title={campaign.name}
        subtitle={`Status: ${campaign.status}`}
      />
      <CampaignEditor
        campaign={campaign}
        availableTags={tags}
        recipientCount={recipientCount}
        sendingDomain={domain?.domain ?? null}
      />
    </div>
  );
}
