import "server-only";

import { db, schema } from "@/lib/db";
import type { Campaign, CampaignAsset } from "@/lib/db/schema";

import { createSiteBlogPost } from "@/lib/cms/blog";
import { updateBlogContent } from "@/lib/blog/posts";

import { createCarousel, addSlide } from "@/lib/image/carousels";
import { queueSlideImages, type SlideImageJob } from "@/lib/image/autoImages";
import { isImageGenConfigured } from "@/lib/ai/image/falClient";
import { buildImagePrompt, defaultImageStyle, fallbackScene } from "@/lib/ai/image/prompt";
import { getBrandImageStyle } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";

import { createCampaign as createEmailCampaign } from "@/lib/marketing/campaigns";
import { getEmailSenderForTenant } from "@/lib/email";

import { parseSocialBody, parseEmailBody } from "./assetBody";

/**
 * Materialise-on-approve (Campaign Engine Slice 1, Task 4): when the operator
 * approves a campaign asset, turn its drafted content into a REAL row in its
 * real home — a blog_posts / carousel_sets / email_campaigns record — as a
 * DRAFT (never published/sent), and hand back a `{externalKind, externalId}`
 * link for the asset to carry. Called by `approveCampaignAssetTool`
 * (@/lib/agents/tools.campaign.ts) BEFORE `approveAsset`; the result is
 * threaded straight into `approveAsset(assetId, result ?? undefined)`.
 *
 * Reuses EXISTING persistence exactly as-is — no new tables, no new
 * generation:
 *   - blog: @/lib/cms/blog's createSiteBlogPost + @/lib/blog/posts's
 *     updateBlogContent, the same two-call idiom tools.marketing.ts's
 *     saveBlogPostTool already uses.
 *   - social: @/lib/image/carousels's createCarousel/addSlide (the same
 *     persistence api/content-studio/carousels/[id]/generate/route.ts calls),
 *     then @/lib/image/autoImages's queueSlideImages so backgrounds (and the
 *     logo, already `showLogo:true` by carousel_sets' own DB default) land
 *     exactly like a manually-generated carousel's.
 *   - email: @/lib/marketing/campaigns's createCampaign (an email_campaigns
 *     DRAFT row) — the exact function the /campaigns composer's
 *     createCampaignAction calls, just invoked with a tenant-derived sender
 *     identity instead of an operator-typed one.
 *   - offer/ad_copy/video_script: no external home — returns null, content
 *     stays on the campaign_assets row itself.
 *
 * Robustness — approve must NEVER 500: `asset.body` for social/email is
 * parsed via ./assetBody's `parseSocialBody`/`parseEmailBody`, both total
 * (never throw); an unparseable body degrades to `null` (logged) rather than
 * blocking the approval. A second, outer try/catch below is a
 * belt-and-braces net around genuinely unexpected failures (a DB write
 * erroring, a lookup coming back empty) for every kind — same "log it and
 * approve without a materialised link" degradation, never a throw that could
 * surface as a 500 on the approve_campaign_asset tool call.
 *
 * tenantId is an explicit third parameter (the plan's interface sketch only
 * lists `(asset, campaign)`) — required for two things a plain ambient `db`
 * read can't cover: `queueSlideImages(tenantId, jobs)` captures the tenant
 * BEFORE detaching into a background continuation that outlives this
 * request (same reason the Content Studio generate route passes it), and
 * `getEmailSenderForTenant(tenantId)` reads the tenant's configured sender
 * identity explicitly rather than relying on ambient request state. The
 * caller (approveCampaignAssetTool) already has `ctx.tenantId` in hand.
 */

export interface MaterialiseResult {
  externalKind: NonNullable<CampaignAsset["externalKind"]>;
  externalId: number;
}

/**
 * The tenant's one CMS site, or null if there isn't exactly one (no sites
 * yet, or more than one with nothing to disambiguate on — a campaign asset
 * has no siteId of its own to pick with). Mirrors the single-site
 * convenience `resolveSite` (@/lib/agents/tools.marketing) applies for the
 * agent's own blog tools, kept local here rather than imported so
 * lib/campaigns doesn't reach into lib/agents (the dependency runs the other
 * way everywhere else in this codebase). Reads via the ambient `db` — safe
 * because materialiseAsset only ever runs inside approve_campaign_asset's
 * executor, itself always called within `runWithTenant(ctx.tenantId, ...)`
 * (see tools.campaign.ts's header comment).
 */
function resolveSingleSiteId(): number | null {
  const rows = db.select({ id: schema.sites.id }).from(schema.sites).all();
  return rows.length === 1 ? rows[0].id : null;
}

function materialiseBlog(asset: CampaignAsset, campaign: Campaign): MaterialiseResult | null {
  const siteId = resolveSingleSiteId();
  if (siteId == null) {
    console.error(
      `[materialise] blog asset #${asset.id}: no single resolvable site (need exactly one) — approving without a materialised link.`,
    );
    return null;
  }

  const title = asset.title || campaign.name;
  const wordCount = asset.body.split(/\s+/).filter(Boolean).length;

  const post = createSiteBlogPost({
    siteId,
    title,
    inputMode: "prompt",
    prompt: null,
    tone: null,
    targetWords: wordCount || 700,
    sourceTherapyId: null,
    sourceVideoProjectId: null,
  });
  // createSiteBlogPost always defaults status:"generating" (designed for the
  // async-generation flow) — we already HAVE the content (this asset was
  // already drafted+approved), so flip it to "ready" immediately, same as
  // saveBlogPostTool does.
  updateBlogContent(post.id, { content: asset.body, status: "ready" });

  return { externalKind: "blog_post", externalId: post.id };
}

function materialiseSocial(asset: CampaignAsset, campaign: Campaign, tenantId: number): MaterialiseResult | null {
  const parsed = parseSocialBody(asset.body);
  if (!parsed) {
    console.error(
      `[materialise] social asset #${asset.id}: body is not valid {caption,slides} JSON — approving without a materialised link.`,
    );
    return null;
  }

  const carousel = createCarousel({ name: `${campaign.name} — ${asset.title}` });

  // Same house-style + per-slide prompt logic as
  // api/content-studio/carousels/[id]/generate/route.ts, so a materialised
  // carousel's images look identical to a manually-generated one's. showLogo
  // needs no extra call — carousel_sets defaults it to true at insert time.
  const imageGen = isImageGenConfigured();
  const houseStyle = imageGen ? (getBrandImageStyle() ?? defaultImageStyle(getBusinessProfile())) : null;
  const jobs: SlideImageJob[] = [];

  for (const slide of parsed.slides) {
    const prompt = houseStyle
      ? buildImagePrompt({
          houseStyle,
          scene: slide.image || fallbackScene({ heading: slide.heading, body: slide.body }),
        })
      : null;
    const row = addSlide({
      carouselSetId: carousel.id,
      slotKey: "default",
      templateId: slide.template || "carousel-content",
      aspectRatio: "1:1",
      headingText: slide.heading,
      bodyText: slide.body,
      caption: parsed.slides.indexOf(slide) === 0 ? parsed.caption : "",
      imagePrompt: prompt,
      imageStatus: prompt ? "generating" : null,
    });
    if (prompt) jobs.push({ slideId: row.id, prompt, aspectRatio: "1:1" });
  }

  if (jobs.length > 0) queueSlideImages(tenantId, jobs);

  return { externalKind: "carousel_set", externalId: carousel.id };
}

function materialiseEmail(asset: CampaignAsset, campaign: Campaign, tenantId: number): MaterialiseResult | null {
  const parsed = parseEmailBody(asset.body);
  if (!parsed) {
    console.error(
      `[materialise] email asset #${asset.id}: body is not valid {subject,content} JSON — approving without a materialised link.`,
    );
    return null;
  }

  const sender = getEmailSenderForTenant(tenantId);
  const emailCampaign = createEmailCampaign({
    name: `${campaign.name} — ${asset.title}`,
    subject: parsed.subject,
    fromName: sender.fromName,
    fromEmail: sender.fromEmail,
    bodyHtml: parsed.content,
  });

  return { externalKind: "email_campaign", externalId: emailCampaign.id };
}

/**
 * Materialise ONE approved campaign asset into its real home. Returns null
 * (no external link — content stays on the asset row) for offer/ad_copy/
 * video_script by design, or for blog/social/email when materialisation
 * couldn't safely proceed (unparseable body, no resolvable site, or any
 * other unexpected failure) — every failure path logs and returns null
 * rather than throwing, so the caller's approve can always proceed.
 */
export function materialiseAsset(asset: CampaignAsset, campaign: Campaign, tenantId: number): MaterialiseResult | null {
  try {
    switch (asset.kind) {
      case "blog":
        return materialiseBlog(asset, campaign);
      case "social":
        return materialiseSocial(asset, campaign, tenantId);
      case "email":
        return materialiseEmail(asset, campaign, tenantId);
      case "offer":
      case "ad_copy":
      case "video_script":
        return null;
      default: {
        const exhaustive: never = asset.kind;
        console.error(`[materialise] unknown asset kind "${exhaustive as string}" on asset #${asset.id} — no materialisation.`);
        return null;
      }
    }
  } catch (err) {
    console.error(`[materialise] asset #${asset.id} (${asset.kind}) failed unexpectedly — approving without a materialised link:`, err);
    return null;
  }
}
