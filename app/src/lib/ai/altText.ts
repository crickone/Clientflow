import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { MODELS } from "@/lib/ai/client";
import { assertUnderCap, recordUsage, AiCapError } from "@/lib/ai/usage";

/**
 * Generate concise, descriptive alt text for an image using Claude vision.
 * Best-effort: returns null if the API key is missing, the format is
 * unsupported (e.g. SVG), the tenant is over its monthly AI cap, or the call
 * fails — callers store null and the user can still type alt manually. A
 * fast/cheap vision model is used.
 *
 * This is the "background/auto" cap-handling case: AiCapError is caught
 * (distinguished from a genuine failure only in the log line) and swallowed
 * exactly like any other failure here, never thrown — matching this
 * function's existing best-effort contract and the brief's requirement that
 * an alt-text backfill never break on a capped tenant.
 */

const VISION_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export async function generateAltText(
  bytes: Buffer,
  mimeType: string,
  hint: string | undefined,
  tenantId: number,
): Promise<string | null> {
  const mime = (mimeType || "").toLowerCase();
  if (!VISION_MIME.has(mime)) return null;

  try {
    // Checked first (before the API-key guard just below) so the cap trips
    // deterministically regardless of environment — see the matching comment
    // on draftFollowup.ts. A plain `return null` from inside a try is NOT
    // caught by the catch below (only a throw is), so moving the key guard
    // here changes nothing about its own behaviour.
    assertUnderCap(tenantId);
    if (!process.env.ANTHROPIC_API_KEY) return null;
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: MODELS.haiku,
      max_tokens: 120,
      system:
        "You write concise, descriptive alt text for images on a website, for accessibility and SEO. " +
        "Describe the visible subject plainly. Max ~120 characters, one line. " +
        "Do NOT start with 'image of' or 'photo of', do not use quotes, and reply with ONLY the alt text.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mime as
                  | "image/jpeg"
                  | "image/png"
                  | "image/webp"
                  | "image/gif",
                data: bytes.toString("base64"),
              },
            },
            {
              type: "text",
              text: hint
                ? `Write alt text for this image. Context: ${hint}`
                : "Write alt text for this image.",
            },
          ],
        },
      ],
    });

    const text = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim()
      .replace(/^["']|["']$/g, "")
      .slice(0, 160);

    recordUsage(tenantId, "media", MODELS.haiku, {
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
      cacheReadTokens: resp.usage.cache_read_input_tokens ?? 0,
      cacheCreateTokens: resp.usage.cache_creation_input_tokens ?? 0,
    });

    return text || null;
  } catch (err) {
    if (err instanceof AiCapError) {
      console.error("[alt-text] skipped — tenant is over its monthly AI cap");
    } else {
      console.error("[alt-text] generation failed:", err);
    }
    return null;
  }
}
