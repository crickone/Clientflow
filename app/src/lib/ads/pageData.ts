import "server-only";

import { getCurrentMembership } from "@/lib/auth";
import { getChromeLogoSrc } from "@/lib/branding";
import { getBusinessProfile } from "@/lib/businessProfile";
import { listAdAccounts } from "@/lib/facebook/grants";
import { getPostingPage, listFacebookPages } from "@/lib/facebook/pages";
import { listCarousels } from "@/lib/image/carousels";
import { listLibraryAssets } from "@/lib/image/library";
import { renderFileUrl } from "@/lib/image/renderStore.client";
import { postableRenders } from "@/lib/social/schedule";
import { getPreferredPostingPageId } from "@/lib/social/publisher";
import type { BuilderAdAccount, BuilderBrand, BuilderDesign, BuilderPhoto, BuilderVideoAd } from "@/components/ads/AdCampaignBuilder";
import { adVersionSizes, listAdCreatives } from "@/lib/ads/creatives";

/**
 * What the builder needs: the tenant's ad accounts, the Content Studio designs
 * that have rendered images (a template design has none and would fail at
 * launch, so it is not offered) with their image URLs for the live preview,
 * the photos in the library, and the Page identity the preview shows.
 */
/**
 * What the chat's approval card needs to show an ad Adonis proposes: the
 * Page's name, handle and logo, and each named design's images in order.
 * Unknown or unrendered designs come back with no images.
 */
export function adPreviewData(designIds: number[], adAccountId?: string | null): { brand: BuilderBrand; designs: Record<number, string[]>; currency: string; socialPosts: number[] } {
  const tenantId = getCurrentMembership()!.tenant.id;
  const page = getPostingPage(tenantId, getPreferredPostingPageId(tenantId));
  const designs: Record<number, string[]> = {};
  for (const id of designIds.slice(0, 12)) designs[id] = postableRenders(id).filenames.slice(0, 10).map(renderFileUrl);
  const accounts = listAdAccounts(tenantId);
  const currency = (accounts.find((a) => a.adAccountId === adAccountId) ?? accounts[0])?.currency || "EUR";
  // A design that is not a version of a Content Studio ad was made as a social post.
  const socialPosts = Object.keys(designs).map(Number).filter((id) => adVersionSizes(id) === null);
  return {
    socialPosts,
    currency,
    brand: {
      pageName: page?.pageName || getBusinessProfile().businessName || "Your Page",
      instagramHandle: listFacebookPages(tenantId).find((p) => p.pageId === page?.pageId)?.igUsername ?? null,
      logoUrl: getChromeLogoSrc(),
    },
    designs,
  };
}

export function builderData(): { adAccounts: BuilderAdAccount[]; designs: BuilderDesign[]; photos: BuilderPhoto[]; brand: BuilderBrand; videoAds: BuilderVideoAd[] } {
  const tenantId = getCurrentMembership()!.tenant.id;
  const page = getPostingPage(tenantId, getPreferredPostingPageId(tenantId));
  return {
    adAccounts: listAdAccounts(tenantId).map((a) => ({ adAccountId: a.adAccountId, name: a.name, currency: a.currency })),
    designs: listCarousels({ includeAdVersions: true })
      .filter((c) => c.generationStatus == null && c.slideCount > 0)
      .map((c) => ({ c, files: postableRenders(c.id).filenames }))
      .filter(({ files }) => files.length > 0)
      .map(({ c, files }) => ({ id: c.id, name: c.name, slideCount: c.slideCount, images: files.map(renderFileUrl) })),
    photos: listLibraryAssets()
      .filter((a: { kind?: string | null }) => a.kind !== "video" && a.kind !== "file")
      .map((a: { id: number; filename: string; originalName?: string | null; label?: string | null }) => ({
        id: a.id,
        filename: a.filename,
        name: a.label || a.originalName || `Photo ${a.id}`,
      })),
    videoAds: listAdCreatives()
      .filter((a) => a.kind === "video" && a.status == null && a.videoUrls["9:16"] && a.videoUrls["1:1"])
      .map((a) => ({ id: a.id, name: a.name, videoUrl: a.videoUrls["9:16"]! })),
    brand: {
      pageName: page?.pageName || getBusinessProfile().businessName || "Your Page",
      instagramHandle: listFacebookPages(tenantId).find((p) => p.pageId === page?.pageId)?.igUsername ?? null,
      logoUrl: getChromeLogoSrc(),
    },
  };
}
