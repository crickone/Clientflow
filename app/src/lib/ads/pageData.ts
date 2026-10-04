import "server-only";

import { getCurrentMembership } from "@/lib/auth";
import { listAdAccounts } from "@/lib/facebook/grants";
import { listCarousels } from "@/lib/image/carousels";
import { listLibraryAssets } from "@/lib/image/library";
import { postableRenders } from "@/lib/social/schedule";
import type { BuilderAdAccount, BuilderDesign, BuilderPhoto } from "@/components/ads/AdCampaignBuilder";

/**
 * What the builder needs: the tenant's ad accounts, the Content Studio designs
 * that have rendered images (a template design has none and would fail at
 * launch, so it is not offered), and the photos in the library.
 */
export function builderData(): { adAccounts: BuilderAdAccount[]; designs: BuilderDesign[]; photos: BuilderPhoto[] } {
  const tenantId = getCurrentMembership()!.tenant.id;
  return {
    adAccounts: listAdAccounts(tenantId).map((a) => ({ adAccountId: a.adAccountId, name: a.name, currency: a.currency })),
    designs: listCarousels()
      .filter((c) => c.generationStatus == null && c.slideCount > 0 && postableRenders(c.id).filenames.length > 0)
      .map((c) => ({ id: c.id, name: c.name, slideCount: c.slideCount })),
    photos: listLibraryAssets()
      .filter((a: { kind?: string | null }) => a.kind !== "video" && a.kind !== "file")
      .map((a: { id: number; filename: string; originalName?: string | null; label?: string | null }) => ({
        id: a.id,
        filename: a.filename,
        name: a.label || a.originalName || `Photo ${a.id}`,
      })),
  };
}
