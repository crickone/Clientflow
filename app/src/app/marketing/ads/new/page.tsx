import { redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { AdCampaignBuilder } from "@/components/ads/AdCampaignBuilder";
import { requireAdminPage } from "@/lib/auth";
import { builderData } from "@/lib/ads/pageData";
import { getAdCreative } from "@/lib/ads/creatives";
import { GOAL_OBJECTIVE } from "@/lib/ads/adCopy";
import { getBusinessProfile } from "@/lib/businessProfile";
import type { CampaignSpec } from "@/lib/ads/spec";

export const dynamic = "force-dynamic";

/**
 * A campaign started from a Content Studio ad: one ad set whose ads are the
 * ad's versions, each with its own copy, under the objective its goal maps to.
 * Built here as plain data (blankSpec lives in a client module).
 */
function specFromAd(adId: number): CampaignSpec | null {
  const ad = getAdCreative(adId);
  if (!ad || ad.versions.length === 0) return null;
  const objective = GOAL_OBJECTIVE[ad.brief.goal];
  const website = getBusinessProfile().website;
  return {
    name: ad.name,
    objective,
    adSets: [
      {
        name: "Ad set 1",
        dailyBudget: 10,
        startAt: null,
        endAt: null,
        audience: { locations: [{ kind: "country", code: "IE", name: "Ireland" }], ageMin: 18, ageMax: 65, genders: [], interests: [], advantageAudience: false },
        ads: ad.versions.map((v) => ({
          name: `Version ${v.variant}${v.copy?.angle ? ` · ${v.copy.angle}` : ""}`,
          creative: {
            source: "design" as const,
            designId: v.designId,
            format: "single" as const,
            primaryText: v.copy?.primaryText ?? "",
            headline: v.copy?.headline ?? "",
            description: v.copy?.description ?? "",
            cta: v.copy?.cta ?? "LEARN_MORE",
            linkUrl: ad.brief.linkUrl || (/^https:\/\//.test(website) ? website : ""),
          },
        })),
      },
    ],
    leadForm:
      objective === "leads"
        ? { name: `${ad.name} form`, headline: "", fields: ["FULL_NAME", "EMAIL", "PHONE"], privacyPolicyUrl: "", thankYouUrl: /^https:\/\//.test(website) ? website : "" }
        : null,
  };
}

export default async function NewAdCampaignPage({ searchParams }: { searchParams?: { fromAd?: string } }) {
  await requireAdminPage();
  const { adAccounts, designs, photos, brand } = builderData();
  if (adAccounts.length === 0) redirect("/marketing/ads");
  const initialSpec = searchParams?.fromAd ? specFromAd(Number(searchParams.fromAd)) : null;
  return (
    <div className="app-page" style={{ maxWidth: 1280 }}>
      <PageHeader eyebrow="Ads" title="New campaign" subtitle="Saved as a draft until you launch it." />
      {/* initialSpec null: the builder makes the blank spec itself. Calling
          blankSpec here crashed the page -- it is exported from a "use client"
          module, so on the server it is a client reference, not a function. */}
      <AdCampaignBuilder campaignId={null} initialSpec={initialSpec} initialAdAccountId={adAccounts[0].adAccountId} adAccounts={adAccounts} designs={designs} photos={photos} brand={brand} />
    </div>
  );
}
