import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { AdCampaignBuilder, blankSpec } from "@/components/ads/AdCampaignBuilder";
import { requireAdminPage } from "@/lib/auth";
import { builderData } from "@/lib/ads/pageData";

export const dynamic = "force-dynamic";

export default async function NewAdCampaignPage() {
  await requireAdminPage();
  const { adAccounts, designs } = builderData();
  if (adAccounts.length === 0) redirect("/marketing/ads");
  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <PageHeader eyebrow="Ads" title="New campaign" subtitle="Saved as a draft until you launch it." />
      <AdCampaignBuilder campaignId={null} initialSpec={blankSpec(designs)} initialAdAccountId={adAccounts[0].adAccountId} adAccounts={adAccounts} designs={designs} />
    </div>
  );
}
