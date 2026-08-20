import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { Therapy } from "@/lib/db/schema";
import { getBusinessContext } from "@/lib/ai/businessContext";
import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreate, type MeterContext } from "@/lib/ai/metered";

// Blog-specific task + format rules. The business identity, services, and voice
// are supplied by getBusinessContext() (venue-aware) and prepended at call time.
const BLOG_FORMAT_RULES = `You write blog posts that are friendly, informative, and grounded. They are intended to drive curiosity and bookings — not to sell or lecture.

Formatting:
- No emojis. No clickbait. No bullet lists of vague benefits.
- Write in markdown:
    - Start with a single \`# Title\` line (use the title we give you).
    - Use \`##\` for section headings. Keep them concrete and specific (e.g. "How a session feels" not "Benefits").
    - Use \`**bold**\` sparingly for the most important phrases.
    - Use short bullet lists only when listing concrete steps or items.
- End with a short closing paragraph that invites the reader to book or get in touch, mentioning the business by name, but keep it understated — one sentence at most.

Output format:
- Return ONLY the markdown body of the blog post. Begin with the \`# Title\` line.
- Do not add a preamble, sign-off, or notes about the writing process.`;

export interface BlogDraftInput {
  title: string;
  inputMode: "prompt" | "therapy" | "video";
  prompt: string | null;
  tone: string | null;
  targetWords: number;
  therapy: Therapy | null;
  videoTranscript: string | null;
  videoProjectName: string | null;
}

export interface BlogDraftResult {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
  };
}

function buildUserPrompt(input: BlogDraftInput): string {
  const lines: string[] = [];
  lines.push(`Blog post title: ${input.title}`);
  lines.push(`Target length: roughly ${input.targetWords} words.`);
  if (input.tone && input.tone.trim()) {
    lines.push(`Tone notes: ${input.tone.trim()}`);
  }
  lines.push("");

  if (input.inputMode === "prompt") {
    lines.push("Source: a topic prompt from the operator.");
    lines.push(`Topic: ${input.prompt?.trim() || input.title}`);
  } else if (input.inputMode === "therapy") {
    const therapyName = input.therapy?.name ?? "(unknown therapy)";
    lines.push(`Source: focused on a specific therapy — ${therapyName}.`);
    if (input.therapy?.description) {
      lines.push(`Therapy description: ${input.therapy.description}`);
    }
    if (input.therapy) {
      lines.push(
        `Default session: ${input.therapy.defaultDurationMinutes} minutes, €${input.therapy.defaultPriceEur}.`,
      );
    }
    if (input.prompt && input.prompt.trim()) {
      lines.push(`Angle the operator wants: ${input.prompt.trim()}`);
    }
  } else if (input.inputMode === "video") {
    lines.push(
      "Source: repurpose the transcript of a video the clinic owner recorded.",
    );
    if (input.videoProjectName) {
      lines.push(`Original video: "${input.videoProjectName}"`);
    }
    lines.push(
      "Use the transcript as raw material — pull out the key ideas, restructure for a reader (not a viewer), and tighten the language. Do not quote the transcript verbatim.",
    );
    if (input.prompt && input.prompt.trim()) {
      lines.push(`Angle the operator wants: ${input.prompt.trim()}`);
    }
    lines.push("");
    lines.push("Transcript:");
    lines.push(input.videoTranscript?.trim() || "(transcript missing)");
  }

  lines.push("");
  lines.push(
    "Write the full blog post in markdown, starting with the `# Title` line.",
  );
  return lines.join("\n");
}

/**
 * `meter` ({tenantId, agentKey}) is required because this generator is the
 * actual paid model call — it goes through `meteredCreate`, which enforces the
 * tenant's monthly AI cap and records the spend, so no caller can invoke it
 * unmetered. The two callers pass different agentKeys — "blog" (the CMS blog
 * editor's Generate button, via runBlogGeneration) and "marketing" (the
 * Marketing agent's draft_blog_post tool) — so the per-agent spend breakdown
 * stays meaningful.
 *
 * `model` defaults to CONTENT_MODEL (Content Studio / the marketing tool
 * never pass it); the campaign kit (lib/campaigns/generate.ts) is the one
 * caller that overrides it with the tenant's chosen campaign build model.
 */
export async function draftBlogPost(
  input: BlogDraftInput,
  meter: MeterContext,
  model: string = CONTENT_MODEL,
): Promise<BlogDraftResult> {
  const message = await meteredCreate(meter, () => ({
    model,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: [
      {
        type: "text",
        text: `${getBusinessContext()}\n\n${BLOG_FORMAT_RULES}`,
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
