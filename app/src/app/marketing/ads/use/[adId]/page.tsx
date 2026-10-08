import { notFound } from "next/navigation";

import { UseAdChooser, type ChooserCampaign, type ChooserVersion } from "@/components/ads/UseAdChooser";
import { AdsNotConnected } from "@/components/ads/AdsNotConnected";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { getAdCreative, ctaWords } from "@/lib/ads/creatives";
import { listAdCampaigns } from "@/lib/ads/service";
import { builderData } from "@/lib/ads/pageData";
import { getGrantInfo, listAdAccounts } from "@/lib/facebook/grants";
import { isMetaConnected } from "@/lib/social/publisher";
import { getBusinessProfile } from "@/lib/businessProfile";
import { renderFileUrl } from "@/lib/image/renderStore.client";
import { GOAL_OBJECTIVE } from "@/lib/ads/adCopy";

export const dynamic = "force-dynamic";

/**
 * Run a Content Studio ad: see it as people will, then start a new campaign
 * with it or add it to one that exists. Content Studio makes the ad; this is
 * where it goes to work.
 */
export default async function UseAdPage({ params }: { params: { adId: string } }) {
  await requireAdminPage();
  const ad = getAdCreative(Number(params.adId));
  if (!ad) notFound();
  const tenantId = getCurrentMembership()!.tenant.id;
  const adAccounts = listAdAccounts(tenantId);
  const ready = Boolean(getGrantInfo(tenantId)) && adAccounts.length > 0 && isMetaConnected(tenantId);
  const website = getBusinessProfile().website;
  const linkHost = (() => {
    try {
      return new URL(ad.brief.linkUrl || website).host.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();

  const versions: ChooserVersion[] =
    ad.kind === "video"
      ? ad.videoCopies.map((c, i) => ({
          label: `Text ${i + 1}`,
          angle: c.angle,
          primaryText: c.primaryText,
          headline: c.headline,
          description: c.description,
          ctaLabel: ctaWords(c.cta),
          images: [],
          video: ad.videoUrls["1:1"] ?? ad.videoUrls["9:16"] ?? null,
          story: ad.videoUrls["9:16"] ? { kind: "video" as const, url: ad.videoUrls["9:16"]! } : null,
        }))
      : ad.versions.map((v) => {
          const feed = v.images["4:5"]?.renderFilename ?? v.images["1:1"]?.renderFilename ?? null;
          const tall = v.images["9:16"]?.renderFilename ?? null;
          return {
            label: `Version ${v.variant}`,
            angle: v.copy?.angle ?? "",
            primaryText: v.copy?.primaryText ?? "",
            headline: v.copy?.headline ?? "",
            description: v.copy?.description ?? "",
            ctaLabel: ctaWords(v.copy?.cta ?? "LEARN_MORE"),
            images: feed ? [renderFileUrl(feed)] : [],
            video: null,
            story: tall ? { kind: "image" as const, url: renderFileUrl(tall) } : null,
          };
        });

  const currency = Object.fromEntries(adAccounts.map((a) => [a.adAccountId, a.currency ?? ""]));
  const campaigns: ChooserCampaign[] = listAdCampaigns()
    .filter((c) => c.status === "draft" || c.status === "error" || c.status === "active" || c.status === "paused")
    .map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status as ChooserCampaign["status"],
      objective: c.objective,
      currency: currency[c.adAccountId] ?? "",
      adSets: c.spec.adSets.map((s) => ({ name: s.name, ads: s.ads.length, dailyBudget: Number(s.dailyBudget) || 0 })),
    }));

  const { brand } = ready ? builderData() : { brand: { pageName: getBusinessProfile().businessName || "Your Page", instagramHandle: null, logoUrl: null } };
  const finished = ad.status == null && versions.length > 0;

  return (
    <div className="app-page" style={{ maxWidth: 1180 }}>
      {ready ? (
        <UseAdChooser
          ad={{ id: ad.id, name: ad.name, kind: ad.kind, goalObjective: GOAL_OBJECTIVE[ad.brief.goal], finished }}
          versions={versions}
          brand={{ ...brand, linkHost }}
          campaigns={campaigns}
        />
      ) : (
        <AdsNotConnected hasPage={isMetaConnected(tenantId)} hasAdAccount={adAccounts.length > 0} />
      )}
    </div>
  );
}
