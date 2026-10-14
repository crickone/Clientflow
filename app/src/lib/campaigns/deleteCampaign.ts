import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { deletePipeline, pipelineForCampaign } from "@/lib/pipeline/pipelineRepo";

/**
 * Delete a campaign the operator no longer wants (a test, a false start like
 * "Black Friday Massage 2025"). Refused when it has sales: those are payment
 * records and stay; switch its offers off instead.
 *
 * Removes: the campaign, its asset list, its offers and their unpaid
 * checkouts, its scheduled posts that haven't gone out, and its pipeline
 * (leads move to the matching column on the main pipeline, none lost).
 * Leaves: drafts it already made in other places (a blog post, email
 * drafts, post designs), which are ordinary items there now.
 */
export function deleteCampaign(id: number): { ok: true; leadsMoved: number } | { ok: false; error: string } {
  const campaign = db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!campaign) return { ok: false, error: "Campaign not found." };

  const offerIds = db.select({ id: schema.offers.id }).from(schema.offers).where(eq(schema.offers.campaignId, id)).all().map((o) => o.id);
  if (offerIds.length) {
    const sold = db
      .select({ id: schema.offerOrders.id })
      .from(schema.offerOrders)
      .where(and(inArray(schema.offerOrders.offerId, offerIds), inArray(schema.offerOrders.status, ["paid", "refunded"])))
      .get();
    if (sold) return { ok: false, error: "This campaign has sales, so it can't be deleted. Switch its offers off instead." };
  }

  const pipeline = pipelineForCampaign(id);
  const leadsMoved = pipeline ? deletePipeline(pipeline.id).moved : 0;

  db.transaction((tx) => {
    if (offerIds.length) {
      tx.delete(schema.offerOrders).where(inArray(schema.offerOrders.offerId, offerIds)).run();
      tx.delete(schema.offers).where(inArray(schema.offers.id, offerIds)).run();
    }
    tx.delete(schema.scheduledPosts)
      .where(and(eq(schema.scheduledPosts.campaignId, id), inArray(schema.scheduledPosts.status, ["scheduled", "failed", "cancelled"])))
      .run();
    // Posts that already went out stay in the history, no longer tied to a campaign.
    tx.update(schema.scheduledPosts).set({ campaignId: null }).where(eq(schema.scheduledPosts.campaignId, id)).run();
    tx.delete(schema.campaignAssets).where(eq(schema.campaignAssets.campaignId, id)).run();
    tx.delete(schema.campaigns).where(eq(schema.campaigns.id, id)).run();
  });
  return { ok: true, leadsMoved };
}
