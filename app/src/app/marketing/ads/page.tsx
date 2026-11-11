import Link from "next/link";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { AdCampaignList } from "@/components/ads/AdCampaignList";
import { AdsNotConnected } from "@/components/ads/AdsNotConnected";
import { AdAccountPerformance } from "@/components/ads/AdAccountPerformance";
import { getAdsOverview } from "@/lib/ads/accountInsights";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { listAdCampaigns } from "@/lib/ads/service";
import { getGrantInfo, listAdAccounts } from "@/lib/facebook/grants";
import { isMetaConnected } from "@/lib/social/publisher";

export const dynamic = "force-dynamic";

/**
 * The ads manager: Facebook and Instagram ad campaigns run on the business's
 * own ad account (Meta bills the business directly). Admin-only: launching
 * and budgets spend real money.
 */
export default async function AdsPage(props: { searchParams?: Promise<{ range?: string; fresh?: string }> }) {
  const searchParams = await props.searchParams;
  await requireAdminPage();
  const tenantId = getCurrentMembership()!.tenant.id;
  const adAccounts = listAdAccounts(tenantId);
  const ready = Boolean(getGrantInfo(tenantId)) && adAccounts.length > 0 && isMetaConnected(tenantId);
  const currency = Object.fromEntries(adAccounts.map((a) => [a.adAccountId, a.currency ?? ""]));

  const campaigns = listAdCampaigns().map((c) => ({
    id: c.id,
    name: c.name,
    objective: c.objective,
    status: c.status,
    dailyBudget: c.spec.adSets.reduce((s, a) => s + (Number(a.dailyBudget) || 0), 0),
    currency: currency[c.adAccountId] ?? "",
    spend: c.insights?.spend ?? null,
    results: c.insights?.results ?? null,
    resultLabel: c.insights?.resultLabel ?? null,
    error: c.error,
  }));

  // Meta's numbers for every campaign on the ad account, Ads Manager ones too.
  const overview = ready ? await getAdsOverview(tenantId, searchParams?.range, { fresh: searchParams?.fresh === "1" }) : null;
  const accountHasCampaigns = Boolean(overview?.accounts.some((a) => a.campaigns.length > 0 || a.quiet > 0 || a.error));

  return (
    <div className="app-page" style={{ maxWidth: 1100 }}>
      <PageHeader
        eyebrow="Marketing"
        title="Ads"
        subtitle="Facebook and Instagram ads on your own ad account. Meta bills your ad account directly; nothing goes live until you launch it."
        actions={
          ready ? (
            <Link href="/marketing/ads/new">
              <Button>
                <Plus size={15} /> New campaign
              </Button>
            </Link>
          ) : null
        }
      />
      {!ready ? (
        <AdsNotConnected hasPage={isMetaConnected(tenantId)} hasAdAccount={adAccounts.length > 0} />
      ) : (
        <>
          {overview && <AdAccountPerformance overview={overview} />}
          {campaigns.length > 0 ? (
            <section style={{ display: "grid", gap: 14 }} aria-labelledby="ads-built-here">
              <h2 id="ads-built-here" className="adp-title">
                Built in AdonisAgent
              </h2>
              <AdCampaignList campaigns={campaigns} />
            </section>
          ) : !accountHasCampaigns ? (
            <AdCampaignList campaigns={campaigns} />
          ) : null}
        </>
      )}
    </div>
  );
}
