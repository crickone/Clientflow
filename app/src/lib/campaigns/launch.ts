import "server-only";

import { eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { CampaignAsset } from "@/lib/db/schema";

import { getBlogPost } from "@/lib/blog/posts";
import { setPublishState } from "@/lib/cms/blog";
import { getCampaign as getEmailCampaign } from "@/lib/marketing/campaigns";

import { getCampaign, listAssets, setCampaignStatus } from "./store";

/**
 * Launch (Campaign Engine Slice 1, Task 5): the final step of the
 * build->approve->launch loop. Called by `launchCampaignTool`
 * (@/lib/agents/tools.campaign.ts) once a campaign is "ready" (every asset
 * approved). Walks every APPROVED asset that materialise-on-approve
 * (@/lib/campaigns/materialise) linked to a real external row and does the
 * kind-appropriate real-world thing, honestly:
 *
 *   - blog   -> PUBLISHES for real. The asset itself carries no siteId (a
 *     campaign_assets row has no site_id column — see schema.ts), so it's
 *     re-derived by reading the linked blog_posts row (`getBlogPost`, an
 *     UNSCOPED read — @/lib/blog/posts — which returns the post including
 *     its own siteId), then flipping it live via the real CMS publish path,
 *     `setPublishState(siteId, id, "published")` (@/lib/cms/blog) — the
 *     exact function the Pages editor's "Publish" button calls.
 *
 *   - email  -> Deliberately NEVER auto-sent. @/lib/marketing/send.ts DOES
 *     have a real, wired, throttled send engine (precheckCampaign +
 *     markCampaignSending + runCampaignSend) — it is not a case of "no
 *     scheduler exists". It's a case of "not safe to fire from here":
 *       1. A launched kit's email assets are a 3-part SEQUENCE (Announce /
 *          Proof / Last-chance) meant to go out at different points across
 *          the campaign's run (campaign.startsOn..endsOn), not all at once.
 *          runCampaignSend has no concept of "send later" (campaign_sends
 *          has no scheduled-dispatch reader anywhere in the codebase; the
 *          `scheduledAt` column on email_campaigns is written by nothing and
 *          read by nothing) — it is strictly "send the whole audience right
 *          now". Firing it 3x from one launch_campaign call would blast the
 *          entire contact list with all three emails back-to-back in one
 *          go, which is a product bug dressed up as a feature, not an
 *          honest "launch".
 *       2. It also has real preconditions launch_campaign has no business
 *          silently gating on — a verified sending domain, EMAIL_TOKEN_SECRET,
 *          a non-suspended tenant, and enough prepaid credit balance to
 *          cover the whole list. Those belong to the operator's own,
 *          deliberate "Send" click on /campaigns (which already has a cost
 *          preview + precheck UI for exactly this), not to a kit-launch
 *          side effect.
 *     So: the linked email_campaigns draft is left exactly as
 *     materialise.ts created it — untouched, including a possibly-blank
 *     fromEmail on a tenant that never configured Settings -> Email (the
 *     Task 4 carry-in) — and reported in `queued` with an honest label. No
 *     invented send/schedule call, per the brief's hard rule.
 *
 *   - social -> NEVER auto-posted (Meta App Review for publish permissions
 *     is still pending — a documented Slice-1 deferral). Reported in
 *     `queued` with a label that says so plainly.
 *
 *   - offer / landing_page / ad_copy / video_script, and any blog/social/
 *     email asset that never got a materialised link (e.g. a blog asset on
 *     a 0-or-2+-site tenant — materialiseAsset returns null, so
 *     externalKind/externalId stay null; Task 4 carry-in) -> skipped. Never
 *     crashes, never appears in either summary array. landing_page (Slice 2
 *     Task 1) never materialises to an external row by design (see
 *     materialise.ts), so it always lands here too — Slice 2's launch task
 *     surfaces its live URL separately, from the campaign's assets directly,
 *     not through this publish/queue/skip per-asset action.
 *
 * Never claims a publish/send that didn't happen — see `launchActionFor`
 * (pure, DB-free, independently testable) for the per-kind action decision,
 * and each `publishBlog`/`queueEmail`/`queueSocial` below for the actual
 * (defensive — never-throwing) work. A single asset's unexpected failure is
 * logged and excluded from the summary rather than aborting the whole
 * launch (same "never 500 on an operator action" posture as materialise.ts).
 */

export interface LaunchItem {
  kind: CampaignAsset["kind"];
  title: string;
  where: string;
}

export interface LaunchResult {
  published: LaunchItem[];
  queued: LaunchItem[];
}

/** Thrown by launchCampaign when the campaign isn't "ready" yet. launchCampaignTool guards this itself first (so its error reads naturally in chat) — this is the defense-in-depth backstop for any other caller. */
export class CampaignNotReadyError extends Error {
  constructor(status: string) {
    super(`Campaign is "${status}" — approve every asset first.`);
    this.name = "CampaignNotReadyError";
  }
}

export type LaunchAction = "publish" | "queue" | "skip";

/**
 * PURE — the launch action for ONE asset, decided only from its own
 * kind/status/external-link fields. No DB, no side effects: safe to unit
 * test without a database (see launch.test.ts). Only "approved" assets that
 * materialise-on-approve actually linked to a real external row are ever
 * eligible; everything else (not approved, or no externalKind/externalId)
 * is "skip" — covers both the by-design skips (offer/ad_copy/video_script)
 * and the tolerated no-link cases (Task 4 carry-in).
 */
export function launchActionFor(
  asset: Pick<CampaignAsset, "kind" | "status" | "externalKind" | "externalId">,
): LaunchAction {
  if (asset.status !== "approved") return "skip";
  if (asset.externalId == null || asset.externalKind == null) return "skip";

  switch (asset.kind) {
    case "blog":
      return "publish";
    case "email":
    case "social":
      return "queue";
    case "offer":
    case "landing_page":
    case "ad_copy":
    case "video_script":
      return "skip";
    default: {
      const exhaustive: never = asset.kind;
      void exhaustive;
      return "skip";
    }
  }
}

/** Publish one blog asset for real. Re-derives siteId from the linked blog_posts row (never trusts a siteId the asset doesn't have). Returns null (logged) rather than throwing on any inconsistency — the row vanished, or somehow has no siteId. */
function publishBlog(asset: CampaignAsset): LaunchItem | null {
  const post = getBlogPost(asset.externalId!);
  if (!post) {
    console.error(`[launch] blog asset #${asset.id}: linked blog_posts row ${asset.externalId} not found — skipping.`);
    return null;
  }
  if (post.siteId == null) {
    console.error(`[launch] blog asset #${asset.id}: blog post #${post.id} has no siteId — skipping.`);
    return null;
  }

  setPublishState(post.siteId, post.id, "published");

  const site = db.select({ name: schema.sites.name }).from(schema.sites).where(eq(schema.sites.id, post.siteId)).get();
  return {
    kind: "blog",
    title: asset.title,
    where: site ? `published to the live site (${site.name})` : "published to the live site",
  };
}

/**
 * Report one email asset as queued — never sends (see this file's header
 * comment for why). Confirms the linked email_campaigns row still exists so
 * the label stays honest (e.g. an operator who deleted or already manually
 * sent it from /campaigns before clicking Launch); a vanished row is
 * skipped entirely rather than claiming a draft that no longer exists.
 */
function queueEmail(asset: CampaignAsset): LaunchItem | null {
  const record = getEmailCampaign(asset.externalId!);
  if (!record) {
    console.error(`[launch] email asset #${asset.id}: linked email_campaigns row ${asset.externalId} not found — skipping.`);
    return null;
  }
  const where =
    record.status === "draft"
      ? "email draft ready to send in Email campaigns"
      : `email campaign is "${record.status}" in Email campaigns`;
  return { kind: "email", title: asset.title, where };
}

/** Report one social asset as queued for manual posting — no DB round-trip needed (nothing about a carousel_sets row can invalidate this label). */
function queueSocial(asset: CampaignAsset): LaunchItem {
  return {
    kind: "social",
    title: asset.title,
    where: "social ready to post (auto-posting coming after Meta review)",
  };
}

/**
 * Launch a "ready" campaign: publish what can honestly publish (blog),
 * queue what can't yet (email, social) and skip the rest, then flip the
 * campaign to "active". Returns the truthful {published, queued} summary —
 * see this file's header comment for the full per-kind reasoning.
 */
export function launchCampaign(campaignId: number): LaunchResult {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error(`No campaign with id ${campaignId}.`);
  if (campaign.status !== "ready") throw new CampaignNotReadyError(campaign.status);

  const published: LaunchItem[] = [];
  const queued: LaunchItem[] = [];

  for (const asset of listAssets(campaignId)) {
    const action = launchActionFor(asset);
    if (action === "skip") continue;

    try {
      if (action === "publish") {
        // Only "blog" resolves to "publish" today (see launchActionFor).
        const item = publishBlog(asset);
        if (item) published.push(item);
      } else {
        const item = asset.kind === "email" ? queueEmail(asset) : queueSocial(asset);
        if (item) queued.push(item);
      }
    } catch (err) {
      console.error(`[launch] asset #${asset.id} (${asset.kind}) failed unexpectedly — leaving it out of the summary:`, err);
    }
  }

  setCampaignStatus(campaignId, "active");

  return { published, queued };
}
