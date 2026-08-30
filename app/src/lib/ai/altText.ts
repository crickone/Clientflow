import "server-only";

import { MODELS } from "@/lib/ai/client";
import { meteredCreateFailSoft } from "@/lib/ai/metered";

/**
 * Generate concise, descriptive alt text for an image using Claude vision.
 * Best-effort: returns null if the API key is missing, the format is
 * unsupported (e.g. SVG), the tenant is over its monthly AI cap, or the call
 * fails — callers store null and the user can still type alt manually. A
 * fast/cheap vision model is used.
 *
 * Routed through `meteredCreateFailSoft` (@/lib/ai/metered) — the shared
 * gate->call->extract->parse->fallback shell. AiCapError (an over-cap
 * tenant), a missing/misconfigured API key, and a network error all land in
 * its one catch, get logged, and resolve to `null` — the same best-effort
 * contract this function always had, and the brief's requirement that an
 * alt-text backfill never break on a capped tenant. (Before this refactor,
 * the catch distinguished AiCapError from a generic failure ONLY in the log
 * line, never in the returned value — meteredCreateFailSoft's one shared log
 * line collapses that distinction; the return value, `null` either way, is
 * unchanged.)
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

  // meteredCreateFailSoft's meteredCreate call enforces the cap
  // (assertAiAllowed) FIRST — before it builds the params thunk below or
  // touches the network — then records usage after, so this best-effort
  // path can't dodge the tenant's monthly AI cap. A missing
  // ANTHROPIC_API_KEY now throws from inside meteredCreate and is caught
  // inside meteredCreateFailSoft (resolved to null below), same clean
  // best-effort outcome as before.
  return meteredCreateFailSoft(
    { tenantId, agentKey: "media" },
    () => ({
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
    }),
    (text) => {
      const cleaned = text.replace(/^["']|["']$/g, "").slice(0, 160);
      return cleaned || null;
    },
    null,
    "alt-text",
  );
}
