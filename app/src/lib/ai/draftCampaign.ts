import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getBusinessContext } from "@/lib/ai/businessContext";
import { MODELS } from "@/lib/ai/client";

/**
 * Campaign-specific task + format rules. The business identity, services,
 * and voice are supplied by getBusinessContext() (venue-aware) and prepended
 * at call time — mirrors draftBlog.ts exactly, just for a marketing-email
 * body instead of a blog post.
 *
 * IMPORTANT: the output is PLAIN TEXT, not markdown or HTML. The composer
 * (CampaignEditor) stores this draft verbatim as the campaign's raw body;
 * the later send task pipes it through textToParagraphs -> renderEmailShell
 * (lib/email.ts) to build the actual outbound HTML (see
 * lib/automations/scheduler.ts's birthday email for the same chaining).
 * textToParagraphs HTML-escapes its input and only understands blank-line-
 * separated paragraphs — any markdown/HTML syntax in the draft would show up
 * literally to the reader, so the rules below forbid it.
 */
const CAMPAIGN_FORMAT_RULES = `You write the BODY of a marketing email — a short, direct message sent to
the business's own mailing list (people who already opted in: existing
leads and customers). It is NOT a blog post: keep it scannable and built to
be read on a phone in a few seconds, not a long-form article.

Formatting:
- Return PLAIN TEXT ONLY. No markdown (no #, *, _, -, [links](...)) and no
  HTML tags — the output is inserted into an email template verbatim, so any
  markdown/HTML syntax would show up literally to the reader instead of
  being rendered.
- Separate paragraphs with a single blank line. Keep paragraphs short (1-4
  sentences).
- No emojis. No clickbait. The subject line is decided separately — do not
  restate it as a heading at the top of the body.
- End with one clear, understated call to action (book, reply, call, visit)
  that names the business.

Output format:
- Return ONLY the plain-text email body. Do not add a preamble, sign-off
  block, or notes about the writing process.`;

export interface CampaignDraftInput {
  /** The email's subject line — given as context so the body doesn't repeat it, not restated as a heading. */
  subject: string;
  /** What this email is about / the angle to take. */
  topic: string;
  tone?: string | null;
  /** Free-text description of who this is going to (e.g. "existing clients who haven't booked in 3 months") — helps the model pitch the copy right. Distinct from the campaign's structured audience targeting. */
  audience?: string | null;
  targetWords: number;
}

export interface CampaignDraftResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

function buildUserPrompt(input: CampaignDraftInput): string {
  const lines: string[] = [];
  lines.push(`Email subject line (already decided — do not restate it as a heading): ${input.subject}`);
  lines.push(`Topic / what this email is about: ${input.topic}`);
  lines.push(`Target length: roughly ${input.targetWords} words.`);
  if (input.tone && input.tone.trim()) {
    lines.push(`Tone notes: ${input.tone.trim()}`);
  }
  if (input.audience && input.audience.trim()) {
    lines.push(`Who this is going to: ${input.audience.trim()}`);
  }
  lines.push("");
  lines.push("Write the full plain-text email body now.");
  return lines.join("\n");
}

export async function draftCampaignEmail(
  input: CampaignDraftInput,
): Promise<CampaignDraftResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local in the app/ folder.",
    );
  }

  const client = new Anthropic();

  const systemPrompt = `${getBusinessContext()}\n\n${CAMPAIGN_FORMAT_RULES}`;

  const message = await client.messages.create({
    model: MODELS.opus,
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

  const content = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();

  return {
    content,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      cacheCreationInputTokens: message.usage.cache_creation_input_tokens ?? 0,
      cacheReadInputTokens: message.usage.cache_read_input_tokens ?? 0,
    },
  };
}
