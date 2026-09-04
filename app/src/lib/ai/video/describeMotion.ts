import "server-only";

import { MODELS } from "@/lib/ai/client";
import { meteredCreateFailSoft } from "@/lib/ai/metered";
import { MOTION_PRESETS, type MotionPreset } from "./motionPresets";

/**
 * Write the motion prompt for ONE photo, by looking at it.
 *
 * A fixed preset says the same words about every image, and an image-to-video
 * model can only work with what it's told — "the people continue their
 * exercise" is far weaker than "the man mid-squat rises out of the bottom
 * position and racks the barbell". Naming the actual subject, their action and
 * the equipment is what separates usable b-roll from a zooming still.
 *
 * Best-effort by design: routed through meteredCreateFailSoft, so an over-cap
 * tenant, a missing key or any failure falls back to the generic preset and the
 * clip still generates. One cheap vision call per photo (fractions of a cent)
 * against a video clip costing 25-35c, so the ratio is never in question.
 */

const VISION_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** What each preset should ask the model to do, in the written prompt. */
const INTENT: Record<MotionPreset, string> = {
  action:
    "The SUBJECTS should move: describe the exercise continuing naturally from this exact frame.",
  camera:
    "The SCENE stays still and only the CAMERA moves: describe a slow push-in over this exact frame.",
  pan: "The CAMERA pans across the space while anyone in frame keeps moving naturally.",
};

export async function describeMotionPrompt(
  input: {
    imageBytes: Buffer;
    imageMime: string;
    preset: MotionPreset;
  },
  tenantId: number,
): Promise<string> {
  const mime = (input.imageMime || "").toLowerCase();
  const fallback = MOTION_PRESETS[input.preset];
  if (!VISION_MIME.has(mime)) return fallback;

  return meteredCreateFailSoft<string>(
    { tenantId, agentKey: "video" },
    () => ({
      model: MODELS.haiku,
      max_tokens: 220,
      system:
        "You write motion prompts for an image-to-video model that animates a still photo " +
        "into a few seconds of realistic b-roll for a gym's social media.\n\n" +
        "Look at the photo and write ONE paragraph, 40-70 words, describing what should " +
        "happen in the next few seconds. Rules:\n" +
        "- Name what is ACTUALLY in the frame: the person, their exercise, the equipment, the setting.\n" +
        "- Describe motion that continues naturally from this exact moment — a rep being " +
        "finished, weights lowering, a walk across the floor.\n" +
        "- Describe the camera too (subtle handheld drift, slow push-in).\n" +
        "- Say it is photorealistic documentary footage.\n" +
        "- End by forbidding the AI tells: no added or removed people, no changed faces or " +
        "equipment, no morphing or distorted limbs.\n" +
        "- If the photo has NO person in it, describe only camera movement over the space.\n" +
        "- Never invent people, equipment or signage that isn't visible.\n\n" +
        "Reply with ONLY the prompt text — no preamble, no quotes.",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mime as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                data: input.imageBytes.toString("base64"),
              },
            },
            { type: "text", text: INTENT[input.preset] },
          ],
        },
      ],
    }),
    (text) => {
      const cleaned = text.replace(/^["']|["']$/g, "").trim();
      // Too short to be a real description — the preset is better than a stub.
      return cleaned.length >= 40 ? cleaned.slice(0, 900) : fallback;
    },
    fallback,
    "broll-motion-prompt",
  );
}
