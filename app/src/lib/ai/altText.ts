import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * Generate concise, descriptive alt text for an image using Claude vision.
 * Best-effort: returns null if the API key is missing, the format is
 * unsupported (e.g. SVG), or the call fails — callers store null and the user
 * can still type alt manually. A fast/cheap vision model is used.
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
  hint?: string,
): Promise<string | null> {
  const mime = (mimeType || "").toLowerCase();
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!VISION_MIME.has(mime)) return null;

  try {
    const client = new Anthropic();
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
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

    return text || null;
  } catch (err) {
    console.error("[alt-text] generation failed:", err);
    return null;
  }
}
