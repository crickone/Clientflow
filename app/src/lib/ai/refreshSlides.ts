import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getBusinessContext } from "@/lib/ai/businessContext";
import { MODELS } from "@/lib/ai/client";
import { assertUnderCap, recordUsage } from "@/lib/ai/usage";

// Slide-refresh task + format rules. Business identity, services, and voice come
// from getBusinessContext() (venue-aware) and are prepended at call time.
const REFRESH_FORMAT_RULES = `You are REWRITING the copy on slides that are already laid out. The user wants fresh wording — different from what's currently there — while keeping the same structure, slide count, and visual style.

Format constraints:
- Plain text only. No markdown, no emojis, no hashtags.
- Headings: short and punchy (3–8 words). They render in uppercase — write in normal case.
- Bodies: 1–3 short sentences.
- Each slide's tone should match its template:
    * carousel-cover / question-hook → hook the reader
    * carousel-content → expand on one concept
    * carousel-tip → an imperative actionable tip
    * carousel-quote-slide → a first-person customer testimonial; body is the attribution
    * carousel-cta → a clear next step (book, call, visit)
    * Any other template → keep the existing tone

Coherence rules:
- The whole carousel must stay on the SAME topic — use the original first slide as the anchor.
- Each slide's new copy must be DIFFERENT from what was there before — don't regurgitate.
- Vary across slides — don't repeat the same point twice.

You ALSO write a fresh Instagram / Facebook caption for the whole carousel. The caption should:
- Open with a hook (one short sentence).
- Expand with 2–4 short paragraphs of real value tied to the new slide copy.
- End with a soft call to action mentioning the business by name.
- Be 80–200 words total. Plain text, no markdown, no emojis.

Output format — return ONLY a JSON object inside <slides>...</slides> tags:
<slides>
{
  "caption": "...",
  "slides": [
    { "heading": "...", "body": "..." },
    { "heading": "...", "body": "..." }
  ]
}
</slides>

The "slides" array must contain exactly the same number of entries as slides given, in order. The "caption" string is the new caption for the whole post.`;

export interface ExistingSlideInput {
  template: string;
  heading: string;
  body: string;
}

export interface RefreshInput {
  slides: ExistingSlideInput[];
  /** Optional context: the design name (e.g. "Strength tips · IG carousel") */
  designName?: string | null;
  /** Optional tone override */
  tone?: string | null;
  /** The real current tenant — required so the €25/month AI cap is checked and metered against the right gym. */
  tenantId: number;
}

export interface RefreshedSlide {
  heading: string;
  body: string;
}

export interface RefreshResult {
  slides: RefreshedSlide[];
  caption: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

function buildUserPrompt(input: RefreshInput): string {
  const lines: string[] = [];
  if (input.designName) {
    lines.push(`Design name: ${input.designName}`);
  }
  if (input.tone && input.tone.trim()) {
    lines.push(`Tone notes: ${input.tone.trim()}`);
  }
  lines.push(`Number of slides to rewrite: ${input.slides.length}`);
  lines.push("");
  lines.push("Existing slides (rewrite each with FRESH wording):");
  input.slides.forEach((slide, i) => {
    lines.push("");
    lines.push(`Slide ${i + 1} (template: ${slide.template})`);
    lines.push(`  Current heading: ${slide.heading || "(empty)"}`);
    lines.push(`  Current body: ${slide.body || "(empty)"}`);
  });
  lines.push("");
  lines.push(
    `Rewrite EVERY slide. Keep the same topic as slide 1, but produce new wording that's clearly different from what's there now. Each slide must vary from the others. Return ONLY the JSON in <slides>...</slides>.`,
  );
  return lines.join("\n");
}

function extractPayload(
  text: string,
  expected: number,
): { slides: RefreshedSlide[]; caption: string } {
  const match = text.match(/<slides>([\s\S]*?)<\/slides>/i);
  const jsonText = (match ? match[1] : text).trim();
  const cleaned = jsonText
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(cleaned) as {
    slides?: unknown;
    caption?: unknown;
  };
  if (!Array.isArray(parsed.slides)) {
    throw new Error("Refresh generator did not return a slides array.");
  }
  const caption =
    typeof parsed.caption === "string" ? parsed.caption.trim() : "";
  const out: RefreshedSlide[] = parsed.slides.map((s, i): RefreshedSlide => {
    if (!s || typeof s !== "object") {
      throw new Error(`Slide ${i + 1} is not an object.`);
    }
    const obj = s as Record<string, unknown>;
    return {
      heading: typeof obj.heading === "string" ? obj.heading.trim() : "",
      body: typeof obj.body === "string" ? obj.body.trim() : "",
    };
  });
  if (out.length !== expected) {
    throw new Error(
      `Refresh returned ${out.length} slides, expected ${expected}.`,
    );
  }
  return { slides: out, caption };
}

/**
 * Generates JUST a new Instagram / Facebook caption for an existing carousel
 * without rewriting any slide copy. Cheaper than refreshSlidesContent — used
 * by the "Refresh caption" button.
 */
export async function refreshCaptionOnly(
  input: RefreshInput,
): Promise<{ caption: string; usage: RefreshResult["usage"] }> {
  // Checked first — see the matching comment on refreshSlidesContent below.
  assertUnderCap(input.tenantId);

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set.");
  }
  if (input.slides.length === 0) {
    throw new Error("No slides supplied.");
  }

  const client = new Anthropic();

  const lines: string[] = [];
  if (input.designName) lines.push(`Design name: ${input.designName}`);
  if (input.tone && input.tone.trim()) {
    lines.push(`Tone notes: ${input.tone.trim()}`);
  }
  lines.push("");
  lines.push("Existing carousel slides:");
  input.slides.forEach((s, i) => {
    lines.push("");
    lines.push(`Slide ${i + 1} (${s.template})`);
    lines.push(`  Heading: ${s.heading || "(empty)"}`);
    lines.push(`  Body: ${s.body || "(empty)"}`);
  });
  lines.push("");
  lines.push(
    `Write a fresh Instagram / Facebook caption for this carousel, different from anything you might have written before. 80–200 words, hook + 2–4 short paragraphs of real value + a soft call to action mentioning the business by name. Plain text, no emojis. Return ONLY the caption text — no JSON, no markdown, no preamble.`,
  );

  const message = await client.messages.create({
    model: MODELS.opus,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: `${getBusinessContext()}\n\n${REFRESH_FORMAT_RULES}`,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: lines.join("\n") }],
  });

  const caption = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  recordUsage(input.tenantId, "carousel", MODELS.opus, {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheCreateTokens: message.usage.cache_creation_input_tokens ?? 0,
  });

  return {
    caption,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}

export async function refreshSlidesContent(
  input: RefreshInput,
): Promise<RefreshResult> {
  // Checked first (before the API-key/input-shape guards below) so a capped
  // tenant never burns a token and the cap trips deterministically regardless
  // of environment/input state.
  assertUnderCap(input.tenantId);

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local in the app/ folder.",
    );
  }
  if (input.slides.length === 0) {
    throw new Error("No slides supplied.");
  }
  if (input.slides.length > 12) {
    throw new Error("Too many slides — refresh up to 12 at a time.");
  }

  const client = new Anthropic();

  const message = await client.messages.create({
    model: MODELS.opus,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: `${getBusinessContext()}\n\n${REFRESH_FORMAT_RULES}`,
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

  const { slides, caption } = extractPayload(text, input.slides.length);

  recordUsage(input.tenantId, "carousel", MODELS.opus, {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheCreateTokens: message.usage.cache_creation_input_tokens ?? 0,
  });

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
