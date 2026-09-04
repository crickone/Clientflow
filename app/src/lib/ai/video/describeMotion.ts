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
    "Identify the equipment, then describe the exercise that equipment is used for " +
    "continuing naturally from this exact frame. If nobody is in shot, describe the " +
    "equipment's own motion and a camera move over it.",
  camera:
    "Identify the equipment, then describe a slow push-in over this exact frame. The " +
    "scene stays still; only the camera moves.",
  pan:
    "Identify the equipment, then describe the camera panning across it, revealing more " +
    "of the room. Anyone in frame keeps using the equipment naturally.",
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
        "START BY IDENTIFYING THE EQUIPMENT. The equipment in the frame is what the motion " +
        "must be built on — the movement has to be what that specific kit is actually used " +
        "for. Name it precisely (squat rack, leg press, cable crossover, lat pulldown, " +
        "smith machine, dumbbell rack, kettlebells, treadmill, assault bike, rower, " +
        "battle ropes, sled, bench) rather than saying 'gym equipment'.\n\n" +
        "Then write ONE paragraph, 40-70 words, describing what happens over the next few " +
        "seconds. Rules:\n" +
        "- The motion must MATCH the equipment: a leg press is pressed and returned, a " +
        "cable machine's stack rises and lowers on the cable, a barbell is racked, a rower's " +
        "handle is drawn back, a treadmill belt runs. Get the mechanics right.\n" +
        "- If a PERSON is in frame, describe them using that equipment correctly, continuing " +
        "naturally from this exact moment — mid-rep finishing, weight lowering under control.\n" +
        "- If there is NO person, this is equipment b-roll: describe camera movement over the " +
        "kit (a slow push along a dumbbell rack, a drift across the rig) plus any honest " +
        "detail like dust in a shaft of light. Do NOT invent a person.\n" +
        "- Name the setting and surfaces you can actually see (rubber flooring, brick wall, " +
        "mirrors, plate tree).\n" +
        "- Describe the camera too (subtle handheld drift, slow push-in).\n" +
        "- Say it is photorealistic documentary footage.\n" +
        "- End by forbidding the AI tells: no added or removed people, no changed faces or " +
        "equipment, no morphing or distorted limbs, no floating weights.\n" +
        "- Never invent equipment, people or signage that isn't visible in the photo.\n\n" +
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
