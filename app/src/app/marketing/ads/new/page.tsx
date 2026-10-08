import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { AdCampaignBuilder } from "@/components/ads/AdCampaignBuilder";
import { requireAdminPage } from "@/lib/auth";
import { builderData } from "@/lib/ads/pageData";
import { campaignSpecFromCreative } from "@/lib/ads/fromCreative";
import { getBusinessProfile } from "@/lib/businessProfile";

export const dynamic = "force-dynamic";

export default async function NewAdCampaignPage({ searchParams }: { searchParams?: { fromAd?: string } }) {
  await requireAdminPage();
  const { adAccounts, designs, photos, brand, videoAds } = builderData();
  if (adAccounts.length === 0) redirect("/marketing/ads");
  const initialSpec = searchParams?.fromAd ? campaignSpecFromCreative(Number(searchParams.fromAd), getBusinessProfile().website) : null;
  return (
    <div className="app-page" style={{ maxWidth: 1280 }}>
      <PageHeader eyebrow="Ads" title="New campaign" subtitle="Saved as a draft until you launch it." />
      {/* initialSpec null: the builder makes the blank spec itself. Calling
          blankSpec here crashed the page -- it is exported from a "use client"
          module, so on the server it is a client reference, not a function. */}
      <AdCampaignBuilder campaignId={null} initialSpec={initialSpec} initialAdAccountId={adAccounts[0].adAccountId} adAccounts={adAccounts} designs={designs} photos={photos} brand={brand} videoAds={videoAds} />
    </div>
  );
}
