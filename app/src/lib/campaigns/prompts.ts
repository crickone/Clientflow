/**
 * Pure prompt builders for the three campaign-kit asset kinds that don't
 * reuse an existing Content Studio generator (offer / ad_copy /
 * video_script — see ./generate for the dispatch that pairs each of these
 * with its own system-level format rules and calls meteredCreate directly).
 * blog/social/email reuse draftBlogPost/generateCarouselSlides/
 * draftCampaignEmail's own prompt building instead.
 *
 * One runtime import — ./ai/signoff, itself a pure zero-import module holding
 * the per-format CTA rules shared with the Content Studio generators — plus a
 * type-only import from @/lib/db/schema, erased at compile time. Mirrors
 * src/lib/campaigns/plan.ts and src/lib/pipeline/roles.ts: prompts.test.ts
 * still loads under the plain tsx test runner with no DB/server-only module
 * graph behind it.
 */
import { signoffRule } from "@/lib/ai/signoff";

import type { Campaign } from "@/lib/db/schema";

/**
 * Restated verbatim inside every one of these three prompts as a belt-and-braces
 * guardrail (getBusinessContext() already injects the tenant's Marketing Brain as
 * the system prompt for every generator — see ./generate and the reused
 * draftBlog/generateCarousel/draftCampaign generators it dispatches to).
 *
 * The AI MAY propose discount/promotional OFFERS the Marketing Brain sanctions
 * (bundle deals, referral offers, seasonal specials, value-add bonuses) — the
 * operator approves each before it runs (updated 2026-08-25 per the tenant's
 * request to leverage Hormozi-style offers). What it must still NOT invent is a
 * money-back guarantee, a free consultation/trial, or a specific standard price
 * the Marketing Brain keeps private.
 */
export const HOUSE_RULES_CLAUSE =
  "House rules: build offers from what the Marketing Brain sanctions — you MAY propose discount and promotional mechanics it allows (bundle deals like \"8 weeks for the price of 6\", referral offers, seasonal or limited-time specials, value-add bonuses), and the operator approves each before it runs. Never invent a money-back guarantee or a free consultation/trial that isn't sanctioned there, and don't state a specific standard price the Marketing Brain keeps private.";

/** Campaign framing shared by all three prompts below: name, season, dates, offer, and the optional operator tweak. */
function campaignContextLines(campaign: Campaign, tweak?: string): string[] {
  const lines: string[] = [];
  lines.push(`Campaign: ${campaign.name}`);
  lines.push(`Season: ${campaign.season || "(not set)"}`);
  if (campaign.startsOn || campaign.endsOn) {
    lines.push(`Runs: ${campaign.startsOn ?? "?"} to ${campaign.endsOn ?? "?"}`);
  }
  lines.push(
    `Offer: ${campaign.offer || "(not yet defined — propose one, grounded only in what the Marketing Brain sanctions)"}`,
  );
  if (tweak && tweak.trim()) {
    lines.push(`Operator tweak for this draft: ${tweak.trim()}`);
  }
  return lines;
}

/**
 * The campaign's core "offer" asset — the polished, single source-of-truth
 * description of what's actually on the table (mechanism, inclusions,
 * dates/terms) that every other asset in the kit (blog, social, email,
 * ads, video) is written from.
 */
export function offerPrompt(campaign: Campaign, tweak?: string): string {
  const lines = campaignContextLines(campaign, tweak);
  lines.push("");
  lines.push(
    "Write the campaign's core offer: a short, concrete description of exactly what's on the table for this campaign — the mechanism, what's included, and any dates or terms — that every other asset in this campaign kit will be built from.",
  );
  lines.push("");
  lines.push(HOUSE_RULES_CLAUSE);
  return lines.join("\n");
}

/** Short-form paid social ad copy (Facebook/Instagram) built around the offer above. */
export function adCopyPrompt(campaign: Campaign, tweak?: string): string {
  const lines = campaignContextLines(campaign, tweak);
  lines.push("");
  lines.push(
    "Write paid social ad copy (Facebook/Instagram) for this campaign: a short attention-grabbing headline, punchy primary text, and one clear call to action — all built around the offer above.",
  );
  lines.push("");
  lines.push(signoffRule("ad"));
  lines.push("");
  lines.push(HOUSE_RULES_CLAUSE);
  return lines.join("\n");
}

/** A short (30-45s) promotional video script (hook, beats, CTA) built around the offer above. */
export function videoScriptPrompt(campaign: Campaign, tweak?: string): string {
  const lines = campaignContextLines(campaign, tweak);
  lines.push("");
  lines.push(
    "Write a short (30-45 second) promotional video script for this campaign: an opening hook, 2-3 beats grounded in the offer above, and a closing call to action. Note brief on-screen action / voiceover direction for each beat.",
  );
  lines.push("");
  lines.push(signoffRule("ad"));
  lines.push("");
  lines.push(HOUSE_RULES_CLAUSE);
  return lines.join("\n");
}

/**
 * The campaign's landing-page copy, in the fixed structure every campaign
 * page follows (CampaignLanding; LANDING_FORMAT_RULES in ./generate): hero,
 * three benefits, good-to-know facts, questions, and the search snippet.
 * Prices and Buy buttons come from the campaign's offers, shown only to
 * visitors from the ad, so the copy must read right with or without them.
 */
export function landingPagePrompt(campaign: Campaign, tweak?: string): string {
  const lines = campaignContextLines(campaign, tweak);
  lines.push("");
  lines.push(
    "Write this campaign's landing page copy in the fixed structure from your instructions: headline, subhead, ctaLabel, exactly 3 benefits, 3 to 6 good-to-know facts (bullets), 3 to 5 questions with answers (faqs), metaTitle and metaDescription. Ground every line in the offer above and the business details you were given.",
  );
  lines.push(
    "The page shows prices and Buy buttons only to people who came through the ad; everyone else sees an enquiry form. Write copy that is right for both: never state a price, a guarantee or a fabricated result, and never say \"buy on this page\" or \"at checkout\".",
  );
  lines.push("");
  lines.push(HOUSE_RULES_CLAUSE);
  return lines.join("\n");
}
