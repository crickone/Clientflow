import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import {
  getBusinessContext,
  SOCIAL_SIGNOFF_RULE,
} from "@/lib/ai/businessContext";
import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreate, type MeterContext } from "@/lib/ai/metered";
import { templatesByCategory } from "@/lib/image/templates";

// Carousel-specific task + format rules. Business identity, services, and voice
// come from getBusinessContext() (venue-aware) and are prepended at call time.
const CAROUSEL_FORMAT_RULES = `You generate Instagram / Facebook carousel slide copy. A carousel is a sequence of slides on one topic. Each slide must build on the last so the series feels cohesive.

Structure rules:
- Slide 1 is the COVER — hook the reader with the main title.
- Slides 2..N-1 are CONTENT slides — one clear idea per slide.
- The final slide is the CTA — send the reader to the link in bio to sign up (see the sign-off rule below).

Format constraints:
- Plain text only. No markdown, no emojis, no hashtags in the slides.
- Headings: short and punchy (3–8 words). They render in uppercase, but write them in normal case.
- Bodies: 1–3 short sentences.
- Numbered tips look great as content slides — phrase them as concrete actions ("Start with the basics").
- Don't quote the brand name on every slide; trust that it's already implied.
- Each slide ALSO carries an "image" field: a concrete photographic scene
  description for that slide's BACKGROUND image (subject, setting, mood,
  composition). Vary the scenes across the carousel while keeping one coherent
  visual world. The background sits behind text drawn by our templates — favour
  calm compositions with clear space, and NEVER describe any text, signage,
  lettering or logos appearing in the scene.

Template options — pick what fits each slide:
- "carousel-cover" — series opener with title + slide indicator. Use only on slide 1.
- "carousel-content" — middle slide with a big number and body. Default for content slides.
- "carousel-tip" — photo top, white card with numbered tip — good for tip lists.
- "carousel-quote-slide" — dark testimonial: warm quote, stars, attribution. Heading = the quote (first person, mixed case), body = who said it.
- "carousel-checklist" — heading + a ticked list. Body = 3-4 checklist lines separated by NEWLINES, each under 7 words.
- "carousel-myth" — myth vs fact. Heading = the myth exactly as believers say it, body = the fact that debunks it.
- "carousel-stat" — one giant number carries the slide. Tagline = the stat itself (short, e.g. "87%" or "3x"), heading = the sentence completing it (lowercase continuation), body = one supporting line. Only use stats grounded in the business context or common knowledge — never invent a figure.
- "carousel-cta" — closing slide, the link-in-bio sign-up. Use only on the last slide.
- "carousel-save" — closing save-and-share prompt. Use as the last slide when the carousel is pure value with no booking angle.
- "question-hook" — provocative question opener. Use only on slide 1 when the cover is question-led.

The dark editorial family (near-black, documentary tone — use them together, never mixed with the light templates in one carousel):
- "carousel-bold-cover" — opener: huge headline on a dark photo, proof line pinned at the bottom. Use only on slide 1.
- "carousel-versus" — a winner and a loser as bars. Body starts with EXACTLY two lines "Label: number"; the rest of the body is prose. Tagline = the margin figure (e.g. "5x") or leave it blank to auto-compute from the two numbers.
- "carousel-timeline" — 3-4 checkpoints on a line. Body starts with 3-4 lines "Label: number" (e.g. "48h: 1.51"); the rest is prose. The largest magnitude gets the accent.
- "carousel-split" — photo up the left, panel right. Tagline = a short section label eyebrow (e.g. "THE MECHANISM"), body = 2-4 explanatory sentences.
- "carousel-statement" — big claim with a thin ring. Body = one paragraph, then a BLANK line, then a 1-2 sentence bold kicker that lands the point.

On every dark-editorial slide, wrap ONE key phrase of the heading in *asterisks* — it renders in the accent colour (e.g. "Massage beat the *cold plunge* by five times"). Any numbers on versus/timeline slides must come from the business context or common knowledge, with the source named in the prose — NEVER invent a figure.

Some templates read a "tagline" field (the stat on "carousel-stat", the "TIP 02" label on "carousel-tip", the margin figure and section label above). Include "tagline" on a slide when its template uses one; omit it elsewhere.

You ALSO write the Instagram / Facebook caption that goes with this carousel when it's posted. The caption should:
- Open with a hook (one short sentence that earns the second line).
- Expand with 2–4 short paragraphs of real value tied to the slides.
- End with the sign-off below, mentioning the business by name.
- Be 80–200 words total. Plain text, no markdown. No emojis, no hashtag spam.
- (Optional: 3–5 relevant hashtags at the very end, only if useful.)

Output format — return ONLY a JSON object inside <slides>...</slides> tags, no other text:
<slides>
{
  "caption": "...",
  "slides": [
    { "template": "carousel-cover", "heading": "...", "body": "...", "image": "..." },
    { "template": "carousel-content", "heading": "...", "body": "...", "image": "..." },
    { "template": "carousel-cta", "heading": "...", "body": "...", "image": "..." }
  ]
}
</slides>

The "slides" array must contain exactly the number of slides requested, in order. The "caption" string accompanies the whole carousel.

${SOCIAL_SIGNOFF_RULE}`;

export interface GeneratedSlide {
  template: string;
  heading: string;
  body: string;
  image: string;
  /** Optional — read by templates that use one (the stat, the tip label). */
  tagline?: string;
}

export interface GenerateInput {
  topic: string;
  slideCount: number;
  tone: string | null;
  /**
   * Slot the user generated from — drives the visual style of the carousel.
   * Each slot maps to a primary template used for the middle slides.
   */
  styleSlot?: string;
}

export interface GenerateResult {
  slides: GeneratedSlide[];
  caption: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

// Derived from templates.ts — the single source of truth for which template
// ids are carousel slides — instead of a hand-mirrored list here, so a
// template rename/add in templates.ts can't silently desync from what this
// generator's post-processing will accept.
const ALLOWED_TEMPLATES = new Set(
  templatesByCategory("carousels").map((t) => t.id),
);

/**
 * Map each slot key to a distinct visual recipe. The slot is the template tab
 * the user clicked — each must produce a visibly different carousel so users
 * see why they'd pick one slot vs another. coverTemplate / middleTemplate are
 * enforced in post-processing.
 */
const SLOT_STYLES: Record<
  string,
  {
    label: string;
    rule: string;
    coverTemplate: string;
    middleTemplate: string;
    /**
     * When set, the model may pick any of these for a middle slide and its
     * choice survives post-processing; anything else falls back to
     * middleTemplate. This is what lets one deck vary its layouts while
     * staying inside a family.
     */
    middleTemplates?: string[];
    /** Template for the final slide. Defaults to "carousel-cta". */
    closingTemplate?: string;
    contentNotes: string;
  }
> = {
  "carousel-cover": {
    label: "Hero carousel",
    coverTemplate: "carousel-cover",
    middleTemplate: "carousel-cover",
    rule:
      "EVERY slide (except the final CTA) uses 'carousel-cover' — each slide is a hero card with one big punchy heading on a photo background. Treat it like a magazine highlight reel where every slide is the main image.",
    contentNotes:
      "Headings should be ultra-punchy, 3–5 words each, all completely standalone. Body text on each slide is one short sentence.",
  },
  "carousel-content": {
    label: "Info carousel",
    coverTemplate: "carousel-cover",
    middleTemplate: "carousel-content",
    rule:
      "Slide 1 is 'carousel-cover'. EVERY middle slide is 'carousel-content' (big numeric indicator + heading + body). Final slide is 'carousel-cta'. This is an information deep-dive.",
    contentNotes:
      "Each middle slide expands on ONE distinct concept in depth. Body text is 2–4 sentences explaining the idea.",
  },
  "carousel-tip": {
    label: "Numbered tip list",
    coverTemplate: "carousel-cover",
    middleTemplate: "carousel-tip",
    rule:
      "Slide 1 is 'carousel-cover'. EVERY middle slide is 'carousel-tip' — each is exactly ONE actionable tip in imperative voice. Final slide is 'carousel-cta'.",
    contentNotes:
      "Each tip heading starts with an imperative verb (e.g. 'Start with the basics', 'Track your progress weekly'). Body is 1–2 sentences explaining the why.",
  },
  "carousel-quote-slide": {
    label: "Testimonial series",
    coverTemplate: "carousel-cover",
    middleTemplate: "carousel-quote-slide",
    rule:
      "Slide 1 is 'carousel-cover'. EVERY middle slide is 'carousel-quote-slide' — each is a distinct first-person client testimonial quote. Final slide is 'carousel-cta'.",
    contentNotes:
      "Write fictional but believable customer quotes in the FIRST PERSON for the heading. The body is the attribution (e.g. 'Aoife M., 4 months in'). Each quote must be about a different result or aspect of their experience — base the specifics on the business context, never assume an industry.",
  },
  "carousel-cta": {
    label: "Action-step carousel",
    coverTemplate: "carousel-cover",
    middleTemplate: "carousel-cta",
    rule:
      "Slide 1 is 'carousel-cover'. EVERY middle slide is 'carousel-cta' — bold accent-coloured action cards. Final slide is also 'carousel-cta'. The whole carousel is a series of action steps on the accent background.",
    contentNotes:
      "Each slide is ONE clear action statement. Headings start with an imperative verb (e.g. 'Book your first session', 'Get started this week'). Body explains the next step in one short sentence. Final slide is the strongest CTA — booking, calling, or visiting.",
  },
  "question-hook": {
    label: "Question-led Q&A",
    coverTemplate: "question-hook",
    middleTemplate: "carousel-content",
    rule:
      "Slide 1 is 'question-hook' — open with a provocative question. Middle slides are 'carousel-content' — each answers part of that question. Final slide is 'carousel-cta'.",
    contentNotes:
      "The cover heading MUST be phrased as a question (e.g. 'Why does this actually work?'). Each middle slide answers one facet of the question.",
  },
  "carousel-checklist": {
    label: "Checklist carousel",
    coverTemplate: "carousel-cover",
    middleTemplate: "carousel-checklist",
    rule:
      "Slide 1 is 'carousel-cover'. EVERY middle slide is 'carousel-checklist' — a heading plus a ticked list. Final slide is 'carousel-cta'.",
    contentNotes:
      "Each middle slide's BODY is 3-4 checklist lines separated by NEWLINES (\\n), each an imperative under 7 words. The heading names what the checklist is for.",
  },
  "carousel-myth": {
    label: "Myth vs fact",
    coverTemplate: "carousel-cover",
    middleTemplate: "carousel-myth",
    rule:
      "Slide 1 is 'carousel-cover'. EVERY middle slide is 'carousel-myth' — one myth debunked per slide. Final slide is 'carousel-cta'.",
    contentNotes:
      "Each middle slide: heading = the myth stated exactly as believers say it (no 'Myth:' prefix), body = the fact that debunks it in 1-3 sentences. Pick myths people in this business's audience actually believe.",
  },
  "carousel-stat": {
    label: "Stat-led carousel",
    coverTemplate: "carousel-cover",
    middleTemplate: "carousel-stat",
    rule:
      "Slide 1 is 'carousel-cover'. EVERY middle slide is 'carousel-stat' — one number carries each slide. Final slide is 'carousel-cta'.",
    contentNotes:
      "Each middle slide: tagline = the stat itself (short — '87%', '3x', '12 weeks'), heading = the sentence completing it as a lowercase continuation, body = one supporting line. Only stats grounded in the business context or common knowledge — NEVER invent a figure.",
  },
  "carousel-bold-cover": {
    label: "Editorial deck",
    coverTemplate: "carousel-bold-cover",
    middleTemplate: "carousel-split",
    middleTemplates: [
      "carousel-versus",
      "carousel-timeline",
      "carousel-split",
      "carousel-statement",
    ],
    rule:
      "Slide 1 is 'carousel-bold-cover'. Middle slides VARY across the dark editorial family — 'carousel-versus', 'carousel-timeline', 'carousel-split', 'carousel-statement' — picking whichever layout fits each slide's content, like a documentary breakdown. Final slide is 'carousel-cta'.",
    contentNotes:
      "This is a deep, evidence-led breakdown of ONE topic. Wrap one key phrase of every heading in *asterisks*. Data slides (versus/timeline) only where real numbers exist in the business context or common knowledge, with the source named in the prose.",
  },
  "carousel-versus": {
    label: "Head-to-head",
    coverTemplate: "carousel-bold-cover",
    middleTemplate: "carousel-versus",
    rule:
      "Slide 1 is 'carousel-bold-cover'. EVERY middle slide is 'carousel-versus' — one comparison per slide. Final slide is 'carousel-cta'.",
    contentNotes:
      "Each middle slide compares two things with two 'Label: number' body lines plus prose naming the source. Wrap one key phrase of every heading in *asterisks*. Never invent a figure.",
  },
  "carousel-timeline": {
    label: "Over-time story",
    coverTemplate: "carousel-bold-cover",
    middleTemplate: "carousel-timeline",
    rule:
      "Slide 1 is 'carousel-bold-cover'. EVERY middle slide is 'carousel-timeline' — one progression per slide. Final slide is 'carousel-cta'.",
    contentNotes:
      "Each middle slide shows 3-4 'Label: number' checkpoints plus prose naming the source. Wrap one key phrase of every heading in *asterisks*. Never invent a figure.",
  },
  "carousel-split": {
    label: "Photo-led explainer",
    coverTemplate: "carousel-bold-cover",
    middleTemplate: "carousel-split",
    rule:
      "Slide 1 is 'carousel-bold-cover'. EVERY middle slide is 'carousel-split' — photo left, explanation right. Final slide is 'carousel-cta'.",
    contentNotes:
      "Each middle slide explains ONE idea: tagline = a short section label (e.g. 'THE MECHANISM'), heading with one phrase in *asterisks*, body = 2-4 clear sentences.",
  },
  "carousel-statement": {
    label: "Claim series",
    coverTemplate: "carousel-bold-cover",
    middleTemplate: "carousel-statement",
    rule:
      "Slide 1 is 'carousel-bold-cover'. EVERY middle slide is 'carousel-statement' — one bold claim per slide. Final slide is 'carousel-cta'.",
    contentNotes:
      "Each middle slide: heading = the claim with one phrase in *asterisks*, body = one supporting paragraph, then a BLANK line, then a 1-2 sentence kicker that lands it.",
  },
  "carousel-save": {
    label: "Value series (save-led)",
    coverTemplate: "carousel-cover",
    middleTemplate: "carousel-content",
    closingTemplate: "carousel-save",
    rule:
      "Slide 1 is 'carousel-cover'. Middle slides are 'carousel-content'. The FINAL slide is 'carousel-save' — a save-and-share prompt, not a booking pitch.",
    contentNotes:
      "Pure value throughout — no selling in the middle slides. The final slide invites the reader to save the post and share it with someone who needs it.",
  },
};

function buildUserPrompt(input: GenerateInput): string {
  const lines: string[] = [];
  lines.push(`Topic: ${input.topic.trim()}`);
  lines.push(`Total slides: ${input.slideCount}`);
  if (input.tone && input.tone.trim()) {
    lines.push(`Tone notes: ${input.tone.trim()}`);
  }

  const style = input.styleSlot ? SLOT_STYLES[input.styleSlot] : null;
  if (style) {
    lines.push("");
    lines.push(`Carousel style: ${style.label}`);
    lines.push(`Layout rule (must follow exactly): ${style.rule}`);
    lines.push(`Content guidance: ${style.contentNotes}`);
  }

  lines.push("");
  lines.push(
    `Write the carousel. Return ONLY the JSON in <slides>...</slides>. Every slide's "template" field must match the layout rule above. Make the heading and body text concrete and specific — avoid generic phrasing.`,
  );
  return lines.join("\n");
}

export function extractPayload(text: string): {
  slides: GeneratedSlide[];
  caption: string;
} {
  const match = text.match(/<slides>([\s\S]*?)<\/slides>/i);
  const jsonText = (match ? match[1] : text).trim();
  // Strip any markdown fences if Claude wrapped them
  const cleaned = jsonText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as { slides?: unknown; caption?: unknown };
  if (!Array.isArray(parsed.slides)) {
    throw new Error("Generator did not return a slides array.");
  }
  const caption =
    typeof parsed.caption === "string" ? parsed.caption.trim() : "";
  const slides = parsed.slides.map((s, i): GeneratedSlide => {
    if (!s || typeof s !== "object") {
      throw new Error(`Slide ${i + 1} is not an object.`);
    }
    const obj = s as Record<string, unknown>;
    const template =
      typeof obj.template === "string" && ALLOWED_TEMPLATES.has(obj.template)
        ? obj.template
        : i === 0
          ? "carousel-cover"
          : "carousel-content";
    const heading = typeof obj.heading === "string" ? obj.heading.trim() : "";
    const body = typeof obj.body === "string" ? obj.body.trim() : "";
    const image = typeof obj.image === "string" ? obj.image.trim() : "";
    const tagline =
      typeof obj.tagline === "string" && obj.tagline.trim()
        ? obj.tagline.trim()
        : undefined;
    return { template, heading, body, image, tagline };
  });
  return { slides, caption };
}

/**
 * `meter` ({tenantId, agentKey}) is required because this generator is the
 * actual paid model call — it goes through `meteredCreate`, which enforces the
 * tenant's monthly AI cap and records the spend, so no caller can invoke it
 * unmetered. Callers pass their own agentKey — "carousel" (Content Studio's
 * Generate route) or "marketing" (the Marketing agent's draft_carousel tool).
 *
 * `model` defaults to CONTENT_MODEL (both of those callers never pass it);
 * the campaign kit (lib/campaigns/generate.ts) is the one caller that
 * overrides it with the tenant's chosen campaign build model.
 */
export async function generateCarouselSlides(
  input: GenerateInput,
  meter: MeterContext,
  model: string = CONTENT_MODEL,
): Promise<GenerateResult> {
  if (input.slideCount < 2 || input.slideCount > 10) {
    throw new Error("Slide count must be between 2 and 10.");
  }

  const message = await meteredCreate(meter, () => ({
    model,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: `${getBusinessContext()}\n\n${CAROUSEL_FORMAT_RULES}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: buildUserPrompt(input),
      },
    ],
  }));

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  const { slides, caption } = extractPayload(text);

  // Enforce the slot's visual recipe even if Claude deviates. Each slot is a
  // distinct visual style — see SLOT_STYLES for the per-slot recipe.
  if (slides.length > 0) {
    const style = input.styleSlot ? SLOT_STYLES[input.styleSlot] : null;
    const coverTemplate = style?.coverTemplate ?? "carousel-cover";
    const middleTemplate = style?.middleTemplate ?? "carousel-content";

    // For the 'carousel-cover' slot, every slide is a hero — final stays as
    // carousel-cover too. For every other slot, the final slide closes the
    // series (a booking CTA unless the slot says otherwise, e.g. save).
    const allHero = input.styleSlot === "carousel-cover";

    slides[0].template = coverTemplate;
    if (slides.length > 2 && !allHero) {
      slides[slides.length - 1].template =
        style?.closingTemplate ?? "carousel-cta";
    }
    const lastMiddleIdx = allHero ? slides.length - 1 : slides.length - 2;
    for (let i = 1; i <= lastMiddleIdx; i++) {
      // A slot with a middle FAMILY keeps the model's pick when it's in the
      // family — that's what lets an editorial deck vary its layouts — and
      // falls back to the slot's default otherwise.
      slides[i].template =
        style?.middleTemplates?.includes(slides[i].template)
          ? slides[i].template
          : middleTemplate;
    }
  }

  return {
    slides,
    caption,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}
