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
import type { BuilderAdAccount, BuilderBrand, BuilderDesign, BuilderPhoto } from "@/components/ads/AdCampaignBuilder";

/**
 * What the builder needs: the tenant's ad accounts, the Content Studio designs
 * that have rendered images (a template design has none and would fail at
 * launch, so it is not offered) with their image URLs for the live preview,
 * the photos in the library, and the Page identity the preview shows.
 */
export function builderData(): { adAccounts: BuilderAdAccount[]; designs: BuilderDesign[]; photos: BuilderPhoto[]; brand: BuilderBrand } {
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
    brand: {
      pageName: page?.pageName || getBusinessProfile().businessName || "Your Page",
      instagramHandle: listFacebookPages(tenantId).find((p) => p.pageId === page?.pageId)?.igUsername ?? null,
      logoUrl: getChromeLogoSrc(),
    },
  };
}
