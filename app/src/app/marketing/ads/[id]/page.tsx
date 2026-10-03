import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { AdCampaignBuilder } from "@/components/ads/AdCampaignBuilder";
import { AdCampaignDetail } from "@/components/ads/AdCampaignDetail";
import { requireAdminPage } from "@/lib/auth";
import { getAdCampaign } from "@/lib/ads/service";
import { builderData } from "@/lib/ads/pageData";

export const dynamic = "force-dynamic";

/** A draft opens in the builder; a launched campaign shows its results and controls. */
export default async function AdCampaignPage({ params }: { params: { id: string } }) {
  await requireAdminPage();
  const campaign = getAdCampaign(Number(params.id));
  if (!campaign) notFound();
  const { adAccounts, designs } = builderData();
  const editable = campaign.status === "draft" || campaign.status === "error";
  const currency = adAccounts.find((a) => a.adAccountId === campaign.adAccountId)?.currency ?? "EUR";

  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <PageHeader eyebrow="Ads" title={campaign.name} subtitle={editable ? "Draft: nothing is live until you launch it." : undefined} />
      {campaign.status === "error" && campaign.error && (
        <div style={{ marginBottom: 16, padding: 14, border: "1px solid var(--danger)", borderRadius: "var(--radius)", fontSize: 13.5, color: "var(--text-secondary)" }}>
          <strong style={{ color: "var(--text-primary)" }}>The last launch did not go through.</strong> Meta said: {campaign.error} Nothing was left running. Fix the plan below and launch again.
        </div>
      )}
      {editable ? (
        <AdCampaignBuilder campaignId={campaign.id} initialSpec={campaign.spec} initialAdAccountId={campaign.adAccountId} adAccounts={adAccounts} designs={designs} />
      ) : (
        <AdCampaignDetail
          id={campaign.id}
          status={campaign.status}
          objective={campaign.objective}
          currency={currency}
          adSets={campaign.spec.adSets.map((s) => ({ name: s.name, dailyBudget: s.dailyBudget }))}
          insights={campaign.insights}
          insightsAt={campaign.insightsAt ? campaign.insightsAt.toISOString() : null}
          launchedAt={campaign.launchedAt ? campaign.launchedAt.toISOString() : null}
          adAccountId={campaign.adAccountId}
          metaCampaignId={campaign.metaIds.campaignId ?? null}
        />
      )}
    </div>
  );
}
