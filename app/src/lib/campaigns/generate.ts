import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { getBusinessContext } from "@/lib/ai/businessContext";
import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreate, type MeterContext } from "@/lib/ai/metered";
import { draftBlogPost } from "@/lib/ai/draftBlog";
import { generateCarouselSlides } from "@/lib/ai/generateCarousel";
import { draftCampaignEmail } from "@/lib/ai/draftCampaign";
import type { Campaign, CampaignAsset } from "@/lib/db/schema";

import { adCopyPrompt, landingPagePrompt, offerPrompt, videoScriptPrompt } from "./prompts";
import { parseLandingBody, type ParsedLandingBody } from "./assetBody";

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

const OFFER_FORMAT_RULES = `You are writing the CORE OFFER for a marketing campaign — the single source-of-truth description every other asset in the kit (blog post, social carousel, emails, ad copy, video script) is written from.

Formatting:
- Plain text only. No markdown, no emojis.
- 2-4 short sentences: what the offer actually is, what's included, and any dates or terms that matter.
- Be concrete and specific — a reader should know exactly what they get and how to claim it.
- Do not invent a discount, guarantee, bonus or deadline beyond what you've been given.

Output format:
- Return ONLY the offer description. No heading, no preamble, no notes about the writing process.`;

const LANDING_FORMAT_RULES = `You write landing-page copy for a marketing campaign, built around a specific offer — copy for a public page whose only job is to get a visitor to register their interest.

Formatting:
- Return ONLY a single JSON object — no markdown, no code fences, no preamble, no notes about the writing process.
- Shape exactly: {"headline": string, "subhead": string, "bullets": string[], "ctaLabel": string}.
- headline: short and punchy (under 60 characters).
- subhead: one sentence expanding on the headline.
- bullets: 3-5 short, concrete benefit statements grounded in the offer.
- ctaLabel: always exactly "Register your interest" — never a price, a booking action, or a guarantee.
- Do not invent a discount, guarantee, bonus or deadline beyond what you've been given.

Output format:
- Return ONLY the JSON object described above. No heading, no preamble, no code fences, no notes about the writing process.`;

const AD_COPY_FORMAT_RULES = `You write paid social ad copy (Facebook/Instagram) for a marketing campaign, built around a specific offer.

Formatting:
- Plain text only. No markdown, no emojis, no hashtags.
- Structure as three clearly labelled parts, each on its own line:
    Headline: (short and attention-grabbing, under 40 characters)
    Primary text: (2-4 short sentences, scannable, builds on the headline)
    CTA: (one short call to action, e.g. "Book your first session")
- Do not invent a discount, guarantee, bonus or deadline beyond what you've been given.

Output format:
- Return ONLY the three labelled lines above. No extra preamble or sign-off.`;

const VIDEO_SCRIPT_FORMAT_RULES = `You write short promotional video scripts (30-45 seconds) for a marketing campaign, built around a specific offer.

Formatting:
- Plain text only. No markdown, no emojis.
- Structure as a numbered list of beats, each formatted as:
    1. [on-screen / voiceover direction] Line of dialogue or narration.
- Open with a hook in beat 1, develop 2-3 beats grounded in the offer, and close with a clear call to action naming the business.
- Keep total narration tight enough to fit 30-45 seconds (roughly 70-110 words of spoken narration).
- Do not invent a discount, guarantee, bonus or deadline beyond what you've been given.

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

/** One metered, non-streaming call for the three "raw text" kinds — same shape as draftBlogPost/generateCarouselSlides/draftCampaignEmail's own meteredCreate call. */
async function generateRaw(meter: MeterContext, formatRules: string, prompt: string): Promise<string> {
  const message = await meteredCreate(meter, () => ({
    model: CONTENT_MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: `${getBusinessContext()}\n\n${formatRules}`,
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
  switch (asset.kind) {
    case "offer": {
      const body = await generateRaw(meter, OFFER_FORMAT_RULES, offerPrompt(campaign, tweak));
      return { title: asset.title, body };
    }

    case "landing_page": {
      const raw = await generateRaw(meter, LANDING_FORMAT_RULES, landingPagePrompt(campaign, tweak));
      // parseLandingBody never throws; a model response it can't make sense
      // of at all (empty/non-JSON) falls back to a safe, honest default
      // rather than failing the draft outright — same "never 500 the
      // operator's action" posture as materialise.ts.
      const fallback: ParsedLandingBody = {
        headline: campaign.name || campaign.offer || "Register your interest",
        subhead: "",
        bullets: [],
        ctaLabel: "Register your interest",
      };
      const parsed = parseLandingBody(raw) ?? fallback;
      return { title: asset.title, body: JSON.stringify(parsed) };
    }

    case "ad_copy": {
      const body = await generateRaw(meter, AD_COPY_FORMAT_RULES, adCopyPrompt(campaign, tweak));
      return { title: asset.title, body };
    }

    case "video_script": {
      const body = await generateRaw(meter, VIDEO_SCRIPT_FORMAT_RULES, videoScriptPrompt(campaign, tweak));
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
      );
      return { title, body: draft.content };
    }

    case "social": {
      const topicLines = [`Campaign: ${campaign.name}`, `Offer: ${campaign.offer || "(not yet defined)"}`];
      if (tweak && tweak.trim()) topicLines.push(`Operator tweak: ${tweak.trim()}`);

      const draft = await generateCarouselSlides(
        { topic: topicLines.join("\n"), slideCount: 5, tone: null },
        meter,
      );
      return { title: asset.title, body: JSON.stringify({ caption: draft.caption, slides: draft.slides }) };
    }

    case "email": {
      const angle = emailAngleFromTitle(asset.title);
      const spec = EMAIL_ANGLE[angle];
      const subject = spec.subject(campaign);

      const topicLines = [`Campaign offer: ${campaign.offer || "(not yet defined)"}`, spec.topic];
      if (tweak && tweak.trim()) topicLines.push(`Operator tweak: ${tweak.trim()}`);

      const draft = await draftCampaignEmail(
        {
          subject,
          topic: topicLines.join("\n"),
          tone: null,
          audience: null,
          targetWords: 150,
        },
        meter,
      );
      // title stays the stable angle label ("Email — Proof") — emailAngleFromTitle depends on
      // it surviving regeneration; the generated subject lives in body alongside content (mirrors
      // the social branch's body-JSON), and materialise (Task 4) parses {subject, content} from it.
      return { title: asset.title, body: JSON.stringify({ subject, content: draft.content }) };
    }

    default: {
      const exhaustive: never = asset.kind;
      throw new Error(`generateAsset: unknown asset kind "${exhaustive as string}"`);
    }
  }
}
