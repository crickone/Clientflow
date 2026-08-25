import "server-only";

import { getCampaign as getEmailCampaign } from "@/lib/marketing/campaigns";
import type { CampaignAsset } from "@/lib/campaigns/store";

/**
 * Send/open/click metrics for a Campaign-Engine campaign's EMAIL asset(s),
 * resolved through the marketing side's own `email_campaigns` +
 * `campaign_sends` (Part 2 of this task). A campaign_assets row of
 * kind='email' that's been approved gets materialised into a real marketing
 * email campaign (materialiseAsset -> materialiseEmail,
 * lib/campaigns/materialise.ts:171-190, which stamps `externalKind =
 * "email_campaign"` / `externalId = <email campaign id>` back onto the
 * asset) — this is the read side of that link.
 */
export interface CampaignEmailMetrics {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  /** null when nothing has delivered yet (divide-by-zero guard) — UI shows "—". */
  openRatePct: number | null;
  /** null when nothing has delivered yet (divide-by-zero guard) — UI shows "—". */
  clickRatePct: number | null;
}

/**
 * Pull `{counts}` out of a marketing CampaignRecord's `stats` field — the
 * JSON blob recomputeCampaignStats (lib/marketing/events.ts) writes as
 * `{counts: Record<status, number>, note?: string}` every time a Mailgun
 * event lands. `stats` is already parsed to `Record<string, unknown> | null`
 * by lib/marketing/campaigns.ts's own toRecord/parseStats, so this just reads
 * the nested `counts` object defensively — `null` (never sent), a malformed
 * blob, or a missing `counts` key all degrade to `{}` rather than throwing.
 */
function extractCounts(stats: Record<string, unknown> | null): Record<string, unknown> {
  if (!stats) return {};
  const counts = (stats as { counts?: unknown }).counts;
  return counts && typeof counts === "object" && !Array.isArray(counts) ? (counts as Record<string, unknown>) : {};
}

function numAt(counts: Record<string, unknown>, key: string): number {
  const v = counts[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Sum every bucket in a `campaign_sends` status-counts object — i.e. every
 * row that was ever created for this email campaign, regardless of which
 * status it currently sits in. This is what "sent" means here (total
 * recipients attempted), NOT the literal `counts.sent` bucket: a
 * `campaign_sends` row is a SINGLE mutable status field that moves forward
 * through the funnel (sent -> delivered -> opened -> clicked, or sideways
 * into bounced/complained/unsubscribed/failed — see events.ts's
 * shouldApplyStatus/PROGRESS_RANK), so a fully-opened send has already left
 * the `sent` bucket entirely. Reading `counts.sent` alone would make "Sent"
 * shrink toward 0 as a campaign performs BETTER, which reads as broken next
 * to a healthy open/click rate. Summing every bucket instead gives a stable
 * total that only grows, matching how "Sent" reads on the /campaigns email
 * list itself (every bucket on that page's own stat grid is a subset of the
 * same total universe of rows).
 */
function totalSent(counts: Record<string, unknown>): number {
  let total = 0;
  for (const v of Object.values(counts)) {
    if (typeof v === "number" && Number.isFinite(v)) total += v;
  }
  return total;
}

/**
 * Resolve a campaign's email send/open/click metrics from its materialised
 * email asset(s), or `null` when there's nothing to show — either no email
 * asset has been materialised yet (not approved / materialise failed), or
 * one has but nothing has actually been SENT yet (still 'draft', so
 * `stats` is still null). Both cases render the same "no campaign email sent
 * yet" line in the panel, so both fold to the same `null` here. Sums across
 * every qualifying asset (DEFAULT_ASSET_PLAN seeds 3 email assets per
 * campaign — Announce/Proof/Last chance — any subset of which may end up
 * approved+materialised+sent independently), so a campaign with more than
 * one sent email still gets one combined total. Never throws.
 */
export function getCampaignEmailMetrics(campaignAssets: CampaignAsset[]): CampaignEmailMetrics | null {
  try {
    const emailAssets = campaignAssets.filter(
      (a): a is CampaignAsset & { externalId: number } =>
        a.kind === "email" && a.externalKind === "email_campaign" && a.externalId != null,
    );
    if (emailAssets.length === 0) return null;

    let sent = 0;
    let delivered = 0;
    let opened = 0;
    let clicked = 0;

    for (const asset of emailAssets) {
      const emailCampaign = getEmailCampaign(asset.externalId);
      if (!emailCampaign) continue; // dangling link (deleted email campaign) — contributes nothing
      const counts = extractCounts(emailCampaign.stats);
      sent += totalSent(counts);
      delivered += numAt(counts, "delivered");
      opened += numAt(counts, "opened");
      clicked += numAt(counts, "clicked");
    }

    if (sent === 0) return null; // materialised but never actually sent — same "—" treatment as not-materialised

    return {
      sent,
      delivered,
      opened,
      clicked,
      openRatePct: delivered > 0 ? (opened / delivered) * 100 : null,
      clickRatePct: delivered > 0 ? (clicked / delivered) * 100 : null,
    };
  } catch (err) {
    console.error("[emailMetrics] getCampaignEmailMetrics failed:", err);
    return null;
  }
}
