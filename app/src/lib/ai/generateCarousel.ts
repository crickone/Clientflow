import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getBusinessContext } from "@/lib/ai/businessContext";

// Carousel-specific task + format rules. Business identity, services, and voice
// come from getBusinessContext() (venue-aware) and are prepended at call time.
const CAROUSEL_FORMAT_RULES = `You generate Instagram / Facebook carousel slide copy. A carousel is a sequence of slides on one topic. Each slide must build on the last so the series feels cohesive.

Structure rules:
- Slide 1 is the COVER — hook the reader with the main title.
- Slides 2..N-1 are CONTENT slides — one clear idea per slide.
- The final slide is the CTA — invite the reader to book or get in touch.

Format constraints:
- Plain text only. No markdown, no emojis, no hashtags in the slides.
- Headings: short and punchy (3–8 words). They render in uppercase, but write them in normal case.
- Bodies: 1–3 short sentences.
- Numbered tips look great as content slides — phrase them as concrete actions ("Start with the basics").
- Don't quote the brand name on every slide; trust that it's already implied.

Template options — pick what fits each slide:
- "carousel-cover" — series opener with title + slide indicator. Use only on slide 1.
- "carousel-content" — middle slide with a big number and body. Default for content slides.
- "carousel-tip" — photo top, white card with numbered tip — good for tip lists.
- "carousel-quote-slide" — dark slide with a big accent quote. Use for testimonial-style content.
- "carousel-cta" — closing slide with a clear CTA. Use only on the last slide.
- "question-hook" — provocative question opener. Use only on slide 1 when the cover is question-led.

You ALSO write the Instagram / Facebook caption that goes with this carousel when it's posted. The caption should:
- Open with a hook (one short sentence that earns the second line).
- Expand with 2–4 short paragraphs of real value tied to the slides.
- End with a soft call to action mentioning the business by name.
- Be 80–200 words total. Plain text, no markdown. No emojis, no hashtag spam.
- (Optional: 3–5 relevant hashtags at the very end, only if useful.)

Output format — return ONLY a JSON object inside <slides>...</slides> tags, no other text:
<slides>
{
  "caption": "...",
  "slides": [
    { "template": "carousel-cover", "heading": "...", "body": "..." },
    { "template": "carousel-content", "heading": "...", "body": "..." },
    { "template": "carousel-cta", "heading": "...", "body": "..." }
  ]
}
</slides>

The "slides" array must contain exactly the number of slides requested, in order. The "caption" string accompanies the whole carousel.`;

export interface GeneratedSlide {
  template: string;
  heading: string;
  body: string;
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

const ALLOWED_TEMPLATES = new Set([
  "carousel-cover",
  "carousel-content",
  "carousel-tip",
  "carousel-quote-slide",
  "carousel-cta",
  "question-hook",
]);

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

function extractPayload(text: string): {
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
    return { template, heading, body };
  });
  return { slides, caption };
}

export async function generateCarouselSlides(
  input: GenerateInput,
): Promise<GenerateResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local in the app/ folder.",
    );
  }
  if (input.slideCount < 2 || input.slideCount > 10) {
    throw new Error("Slide count must be between 2 and 10.");
  }

  const client = new Anthropic();

  const systemPrompt = `${getBusinessContext()}\n\n${CAROUSEL_FORMAT_RULES}`;

  const message = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: buildUserPrompt(input),
      },
    ],
  });

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
    // carousel-cover too. For every other slot, the final slide is a CTA.
    const allHero = input.styleSlot === "carousel-cover";

    slides[0].template = coverTemplate;
    if (slides.length > 2 && !allHero) {
      slides[slides.length - 1].template = "carousel-cta";
    }
    const lastMiddleIdx = allHero ? slides.length - 1 : slides.length - 2;
    for (let i = 1; i <= lastMiddleIdx; i++) {
      slides[i].template = middleTemplate;
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
