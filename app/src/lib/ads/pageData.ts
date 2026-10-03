import "server-only";

import { getCurrentMembership } from "@/lib/auth";
import { listAdAccounts } from "@/lib/facebook/grants";
import { listCarousels } from "@/lib/image/carousels";
import type { BuilderAdAccount, BuilderDesign } from "@/components/ads/AdCampaignBuilder";

/** What the builder needs: the tenant's ad accounts and its finished Content Studio designs. */
export function builderData(): { adAccounts: BuilderAdAccount[]; designs: BuilderDesign[] } {
  const tenantId = getCurrentMembership()!.tenant.id;
  return {
    adAccounts: listAdAccounts(tenantId).map((a) => ({ adAccountId: a.adAccountId, name: a.name, currency: a.currency })),
    designs: listCarousels()
      .filter((c) => c.generationStatus == null && c.slideCount > 0)
      .map((c) => ({ id: c.id, name: c.name, slideCount: c.slideCount })),
  };
}
