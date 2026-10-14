import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { getBusinessContext } from "@/lib/ai/businessContext";
import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreate, meteredComplete, type MeterContext } from "@/lib/ai/metered";
import { draftBlogPost } from "@/lib/ai/draftBlog";
import { generateCarouselSlides } from "@/lib/ai/generateCarousel";
import { refreshSlidesContent } from "@/lib/ai/refreshSlides";
import { DEFAULT_SINGLE_TEMPLATE } from "@/lib/image/slots";
import { socialFormatFromTitle } from "./plan";
import { draftCampaignEmail } from "@/lib/ai/draftCampaign";
import { getCampaignBuildModel } from "@/lib/campaigns/buildModel";
import type { Campaign, CampaignAsset } from "@/lib/db/schema";

import { adCopyPrompt, landingPagePrompt, offerPrompt, videoScriptPrompt } from "./prompts";
import { landingGaps, parseLandingBody, type ParsedLandingBody } from "./assetBody";

/**
 * Per-asset generation dispatch (Campaign Engine Slice 1 + Slice 2) — turns a
 * `CampaignAsset` row into real content, reusing the SAME generators the
 * rest of Content Studio/campaigns already ship (`draftBlogPost`,
 * `generateCarouselSlides`, `draftCampaignEmail`) for the kinds that map
 * onto them, and a direct `meteredCreate` call — mirroring those
 * generators' own house/format-rules shape exactly — for the four kinds
 * that don't have an existing generator (offer / landing_page / ad_copy /
 * video_script).
 *
 * House rules ride in EVERY branch: getBusinessContext() (injecting the
 * tenant's Marketing Brain) is either supplied by the reused generator
 * itself (blog/social/email) or prepended here (offer/landing_page/ad_copy/
 * video_script); the offer/landing_page/ad_copy/video_script user prompts
 * additionally restate HOUSE_RULES_CLAUSE (see ./prompts) as a
 * belt-and-braces reminder never to invent a guarantee or free offer the
 * Brain hasn't sanctioned.
 *
 * landing_page (Slice 2) is the one branch that additionally has to turn the
 * model's raw text back into structured JSON itself — offer/ad_copy/
 * video_script return raw text as-is, and blog/social/email's reused
 * generators already hand back structured data — so its branch parses the
 * model's output with ./assetBody's `parseLandingBody` (tolerant; never
 * throws) and falls back to a safe default object if that fails, rather
 * than letting a malformed model response take the whole draft down.
 *
 * Every branch is metered — there is no path here that calls the model
 * without going through `meteredCreate` (directly, or inside the reused
 * generator), and every call forwards the CALLER's `meter` verbatim, so the
 * agentKey (e.g. "marketing") the tool layer passes in is what the spend
 * gets recorded under.
 */

export interface GeneratedAsset {
  title: string;
  body: string;
}

// ── Format rules for the four kinds with no existing generator ────────────
// Mirrors BLOG_FORMAT_RULES / CAROUSEL_FORMAT_RULES / CAMPAIGN_FORMAT_RULES
// in draftBlog.ts / generateCarousel.ts / draftCampaign.ts: the business
// identity + Marketing Brain come from getBusinessContext(), prepended at
// call time in generateRaw() below; these consts supply just the task +
// output-format rules for that one asset kind.

/**
 * A compact, always-applied offer-construction rubric (the Alex Hormozi "$100M
 * Offers" value-equation method) baked into the OFFER asset — so every tenant
 * gets systematic offer design even when their Marketing Brain field doesn't
 * spell it out. IMPORTANT (client confidentiality): the method is described in
 * plain language, the framework/author is deliberately NOT named in the prompt
 * string, and the rubric HARD-BANS naming any framework or using playbook
 * jargon in the OUTPUT — so it can never surface to a reader. The tenant's own
 * Marketing Brain (via getBusinessContext) still supplies the specifics — the
 * outcome, sanctioned mechanics, the house rules.
 */
const OFFER_CONSTRUCTION_RUBRIC = `How to construct the offer — apply this method:
- An offer gets more compelling as you raise the felt OUTCOME the reader wants and their belief it will actually work for them, and lower the time, effort and hassle it takes to get there.
- Assemble it in this order: (1) lead with the OUTCOME — the felt transformation, not the service; (2) SPELL OUT THE VALUE — what's included and why each piece matters; (3) sweeten with the DEAL — a value bundle (e.g. "8 weeks for the price of 6"), a seasonal or limited-time special, a referral offer, or a value-add bonus; (4) add real urgency or scarcity — an intake date or limited spots — ONLY when it is genuinely true; (5) give the offer a specific NAME.
- Prefer value-adds and bonuses over deep discounts: bonuses plus urgency raise perceived value, while heavy discounting erodes it (discounts are allowed — but lead with value).
- This is INTERNAL method only: NEVER name a marketing framework, method or author, and never use playbook jargon, anywhere in what you output. The copy must read as natural, on-brand marketing a reader could never trace back to a template.`;

const OFFER_FORMAT_RULES = `You are writing the CORE OFFER for a marketing campaign — the single source-of-truth description every other asset in the kit (blog post, social carousel, emails, ad copy, video script) is written from.

${OFFER_CONSTRUCTION_RUBRIC}

Formatting:
- Plain text only. No markdown, no emojis.
- 2-4 short sentences: what the offer actually is, what's included, and any dates or terms that matter.
- Be concrete and specific — a reader should know exactly what they get and how to claim it.
- You MAY design a promotional offer using mechanics the Marketing Brain sanctions — a value bundle (e.g. "8 weeks for the price of 6"), a referral offer, a seasonal or limited-time special, or a value-add bonus. Build it using the method above. The operator approves the offer before it runs. Do NOT invent a money-back guarantee or a free consultation/trial the Marketing Brain hasn't sanctioned, and do NOT state a specific standard price it keeps private — express the deal as the mechanic (a ratio, a % off, weeks free), not the underlying price list.

Output format:
- Return ONLY the offer description. No heading, no preamble, no notes about the writing process.`;

const LANDING_FORMAT_RULES = `You write the copy for a campaign landing page: a short sales page on the business's own website, built around one offer. Every campaign page has the same fixed structure, and you fill each part of it.

The page, top to bottom (the platform lays it out; you write the words):
1. Hero: headline, subhead, and a button (ctaLabel) that takes the visitor to the prices.
2. The prices and Buy buttons (the platform fills these from the offer; write nothing for them).
3. "Why": exactly three benefits, each a short title and one sentence.
4. Photographs (the platform picks them).
5. "Good to know": 3 to 6 plain facts about the offer and the visit.
6. "How it works" after buying (the platform writes it).
7. Questions: 3 to 5 questions people ask before buying, each with a short answer.
8. An enquiry form and the address (the platform adds them).

Formatting:
- Return ONLY a single JSON object: no markdown, no code fences, no preamble, no notes.
- Shape exactly: {"headline": string, "subhead": string, "ctaLabel": string, "benefits": [{"title": string, "text": string}], "bullets": string[], "faqs": [{"q": string, "a": string}], "metaTitle": string, "metaDescription": string}.
- headline: under 60 characters. Says what the offer is, plainly (e.g. "20% off every massage this Black Friday"). No wordplay.
- subhead: one sentence, under 160 characters, with the most useful facts (what, where, when).
- ctaLabel: 2 to 4 words naming what the visitor picks, e.g. "Choose your massage" or "See prices". Never a price.
- benefits: exactly 3. title 2 to 5 words; text one sentence of fact about this business or offer.
- bullets: 3 to 6 short facts: what's included, how long sessions are, where it is and parking, who it's for. One fact each.
- faqs: 3 to 5. Only questions you can answer from the offer and the business details you were given (when to use it by, how to book, where it is, how long a session takes, whether it can be a gift). Never invent a policy, price or fact; leave a question out rather than guess.
- metaTitle: 50 to 60 characters: the service and the town, with the business name shortened at the end (e.g. "Black Friday Massage Offer Clonmel | Optimal Health").
- metaDescription: 140 to 160 characters: names the service and town, states facts from the offer, and ends with an action ("Book online or call ...").

The copy must read right for EVERY visitor: some see the prices and Buy buttons, others (who didn't come through the ad) see only an enquiry form. So never write "buy on this page", "at checkout" or "click below to buy", and never state a price.

Plain copy: short factual sentences. No "X rather than Y", no "not just X", no poetic or punning lines, no warm filler, no exclamation marks, no emojis. Cut any sentence that states no fact.
Represent the offer faithfully: don't add discounts, guarantees, bonuses or deadlines it doesn't state.`;

const AD_COPY_FORMAT_RULES = `You write paid social ad copy (Facebook/Instagram) for a marketing campaign, built around a specific offer.

Formatting:
- Plain text only. No markdown, no emojis, no hashtags.
- Structure as three clearly labelled parts, each on its own line:
    Headline: (short and attention-grabbing, under 40 characters)
    Primary text: (2-4 short sentences, scannable, builds on the headline)
    CTA: (one short call to action, e.g. "Book your first session")
- Represent the campaign's offer faithfully — don't add discounts, guarantees, bonuses or deadlines the offer doesn't already state, and don't publish a specific standard price.

Output format:
- Return ONLY the three labelled lines above. No extra preamble or sign-off.`;

const VIDEO_SCRIPT_FORMAT_RULES = `You write short promotional video scripts (30-45 seconds) for a marketing campaign, built around a specific offer.

Formatting:
- Plain text only. No markdown, no emojis.
- Structure as a numbered list of beats, each formatted as:
    1. [on-screen / voiceover direction] Line of dialogue or narration.
- Open with a hook in beat 1, develop 2-3 beats grounded in the offer, and close with a clear call to action naming the business.
- Keep total narration tight enough to fit 30-45 seconds (roughly 70-110 words of spoken narration).
- Represent the campaign's offer faithfully — don't add discounts, guarantees, bonuses or deadlines the offer doesn't already state, and don't publish a specific standard price.

Output format:
- Return ONLY the numbered beat list. No heading, no preamble, no notes about the writing process.`;

/** SDK `Message` -> plain text, the exact `.content.filter(...).map(...).join("\n").trim()` shape draftBlog/generateCarousel/draftCampaign each duplicate. */
function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

/**
 * One metered, non-streaming call for the four "raw text" kinds - same
 * shape as draftBlogPost/generateCarouselSlides/draftCampaignEmail's own
 * meteredCreate call. `model` defaults to CONTENT_MODEL but every call site
 * in generateAsset below passes the tenant's chosen campaign build model
 * explicitly.
 */
async function generateRaw(
  meter: MeterContext,
  formatRules: string,
  prompt: string,
  model: string = CONTENT_MODEL,
): Promise<string> {
  const system = `${getBusinessContext()}\n\n${formatRules}`;

  // An OpenRouter build model goes through the provider-neutral one-shot
  // (meteredComplete): meteredCreate below calls native Anthropic directly and
  // would reject an OpenRouter id. Native Anthropic models keep meteredCreate's
  // adaptive thinking + ephemeral system-prompt caching, unchanged.
  if (model.startsWith("openrouter:")) {
    return meteredComplete(meter, { model, system, prompt, maxTokens: 4096 });
  }

  const message = await meteredCreate(meter, () => ({
    model,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: prompt }],
  }));
  return extractText(message);
}

// ── Email sequence angle, derived from the asset's title ──────────────────
// DEFAULT_ASSET_PLAN (./plan) titles the 3 email assets "Email — Announce" /
// "Email — Proof" / "Email — Last chance"; matched case-insensitively by
// keyword so an operator-renamed title still resolves sensibly (falls back
// to "announce", the sequence's natural starting point).

type EmailAngle = "announce" | "proof" | "last_chance";

export function emailAngleFromTitle(title: string): EmailAngle {
  const t = title.toLowerCase();
  if (t.includes("proof")) return "proof";
  if (t.includes("last")) return "last_chance";
  return "announce";
}

const EMAIL_ANGLE: Record<EmailAngle, { subject: (campaign: Campaign) => string; topic: string }> = {
  announce: {
    subject: (c) => `${c.name} is here`,
    topic:
      "This is the FIRST email in a 3-part campaign sequence: announce the offer for the first time — what it is, why now, and how to act on it.",
  },
  proof: {
    subject: (c) => `Still time for ${c.name}`,
    topic:
      "This is the SECOND email in a 3-part campaign sequence, a few days after the announce email: reinforce the offer with proof it's worth acting on (results, experience, credibility). Assume the reader already saw the first email — don't re-introduce the offer from scratch.",
  },
  last_chance: {
    subject: (c) => `Last chance: ${c.name} ends soon`,
    topic:
      "This is the FINAL email in a 3-part campaign sequence: a last-chance reminder that the offer is ending. Create genuine urgency without inventing a deadline — use the campaign's real end date if one is set, otherwise keep the urgency general (e.g. 'this week only').",
  },
};

/**
 * Generate (or regenerate, with `tweak`) one campaign asset's draft content.
 * Never persists anything — the caller (`draft_campaign_asset`, Task 3) is
 * responsible for saving the result via `setAssetDraft`.
 */
export async function generateAsset(
  asset: CampaignAsset,
  campaign: Campaign,
  meter: MeterContext,
  tweak?: string,
): Promise<GeneratedAsset> {
  const model = await getCampaignBuildModel();
  switch (asset.kind) {
    case "offer": {
      const body = await generateRaw(meter, OFFER_FORMAT_RULES, offerPrompt(campaign, tweak), model);
      return { title: asset.title, body };
    }

    case "landing_page": {
      let raw = await generateRaw(meter, LANDING_FORMAT_RULES, landingPagePrompt(campaign, tweak), model);
      // Every campaign page follows the same structure; a draft missing a
      // part goes back once with what to fix.
      const first = parseLandingBody(raw);
      const gaps = first ? landingGaps(first) : ["valid JSON in the shape given"];
      if (gaps.length) {
        raw = await generateRaw(
          meter,
          LANDING_FORMAT_RULES,
          `${landingPagePrompt(campaign, tweak)}\n\nYour last draft was missing: ${gaps.join(", ")}. Write the whole page again with every part.\n\nLast draft:\n${raw.slice(0, 6000)}`,
          model,
        );
      }
      // parseLandingBody never throws; a model response it can't make sense
      // of at all (empty/non-JSON) falls back to a safe, honest default
      // rather than failing the draft outright — same "never 500 the
      // operator's action" posture as materialise.ts. fallbackTitle doubles
      // as both headline and metaTitle — with no model output to draw on,
      // the campaign's own name/offer is the only honest thing to show
      // (never the CTA text — a "Sign up"/"Join us" headline would read as
      // the button, not a title).
      const fallbackTitle = campaign.name || campaign.offer || "Join us";
      const fallback: ParsedLandingBody = {
        headline: fallbackTitle,
        subhead: "",
        bullets: [],
        benefits: [],
        faqs: [],
        ctaLabel: "See prices",
        metaTitle: fallbackTitle,
        metaDescription: campaign.offer || "",
      };
      const parsed = parseLandingBody(raw) ?? fallback;
      return { title: asset.title, body: JSON.stringify(parsed) };
    }

    case "ad_copy": {
      const body = await generateRaw(meter, AD_COPY_FORMAT_RULES, adCopyPrompt(campaign, tweak), model);
      return { title: asset.title, body };
    }

    case "video_script": {
      const body = await generateRaw(meter, VIDEO_SCRIPT_FORMAT_RULES, videoScriptPrompt(campaign, tweak), model);
      return { title: asset.title, body };
    }

    case "blog": {
      const promptLines = [
        `Campaign: ${campaign.name}`,
        `Offer: ${campaign.offer || "(not yet defined)"}`,
        "Angle: write this as a blog post that supports the campaign above — give the reader real value related to the offer, and lead them toward it without being a hard sell.",
      ];
      if (tweak && tweak.trim()) promptLines.push(`Operator tweak: ${tweak.trim()}`);

      const title = asset.title || campaign.name;
      const draft = await draftBlogPost(
        {
          title,
          inputMode: "prompt",
          prompt: promptLines.join("\n"),
          tone: null,
          targetWords: 700,
          therapy: null,
          videoTranscript: null,
          videoProjectName: null,
        },
        meter,
        model,
      );
      return { title, body: draft.content };
    }

    case "social": {
      const topicLines = [`Campaign: ${campaign.name}`, `Offer: ${campaign.offer || "(not yet defined)"}`];
      if (tweak && tweak.trim()) topicLines.push(`Operator tweak: ${tweak.trim()}`);

      // A single-image post is one statement, not a short series, so it is
      // written by the single-slide copy writer rather than the carousel
      // generator (which refuses fewer than two slides). Same body shape
      // either way -- one slide in the list -- so materialise reads both.
      if (socialFormatFromTitle(asset.title) === "single") {
        const copy = await refreshSlidesContent({
          slides: [{ template: DEFAULT_SINGLE_TEMPLATE, heading: "", body: "" }],
          designName: topicLines.join("\n"),
          tone: null,
          tenantId: meter.tenantId,
        });
        const slide = copy.slides[0] ?? { heading: "", body: "" };
        return {
          title: asset.title,
          body: JSON.stringify({
            caption: copy.caption,
            slides: [{ template: DEFAULT_SINGLE_TEMPLATE, heading: slide.heading, body: slide.body, image: "" }],
          }),
        };
      }

      const draft = await generateCarouselSlides(
        { topic: topicLines.join("\n"), slideCount: 5, tone: null },
        meter,
        model,
      );
      return { title: asset.title, body: JSON.stringify({ caption: draft.caption, slides: draft.slides }) };
    }

    case "email": {
      const angle = emailAngleFromTitle(asset.title);
      const spec = EMAIL_ANGLE[angle];
      const fallbackSubject = spec.subject(campaign);

      const topicLines = [`Campaign offer: ${campaign.offer || "(not yet defined)"}`, spec.topic];
      if (tweak && tweak.trim()) topicLines.push(`Operator tweak: ${tweak.trim()}`);

      const draft = await draftCampaignEmail(
        {
          subject: fallbackSubject,
          topic: topicLines.join("\n"),
          tone: null,
          audience: null,
          targetWords: 150,
          // The model writes the subject: a fixed "<campaign name> is here"
          // put internal names ("Black Friday Massage 2025") in customers'
          // inboxes, and a redraft could never change it.
          writeSubject: true,
        },
        meter,
        model,
      );
      // title stays the stable angle label ("Email — Proof") — emailAngleFromTitle depends on
      // it surviving regeneration; the generated subject lives in body alongside content (mirrors
      // the social branch's body-JSON), and materialise (Task 4) parses {subject, content} from it.
      const subject = draft.subject || fallbackSubject;
      return { title: asset.title, body: JSON.stringify({ subject, content: draft.content }) };
    }

    default: {
      const exhaustive: never = asset.kind;
      throw new Error(`generateAsset: unknown asset kind "${exhaustive as string}"`);
    }
  }
}
