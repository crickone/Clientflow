import "server-only";
import fs from "node:fs";
import sharp from "sharp";
import type Anthropic from "@anthropic-ai/sdk";

import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreate, type MeterContext } from "@/lib/ai/metered";
import { readPicks } from "./adPhotoPicks";

/**
 * Which of the business's own photographs goes on each version of an ad.
 *
 * The design engine's library fallback is a blind rotation: it cannot know
 * what is in "_DSC5297.JPG", so a hyperbaric ad could open on a massage. An
 * ad is the one place a wrong picture costs money, so this LOOKS: small
 * thumbnails of the most recent photographs go to the model with each
 * version's angle and hook, and it names the photograph that shows that
 * service, or none. A version with no fitting photograph is left null, and
 * the caller generates one to the design's own brief instead.
 *
 * Fail-soft: any error returns all-null, which means "generate", the same
 * behaviour as a business with an empty library.
 */

const MAX_CANDIDATES = 24;
const THUMB_PX = 320;

export interface PhotoCandidate {
  id: number;
  path: string;
}

async function thumb(path: string): Promise<string | null> {
  try {
    if (!fs.existsSync(path)) return null;
    const buf = await sharp(path).rotate().resize(THUMB_PX, THUMB_PX, { fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
    return buf.toString("base64");
  } catch {
    return null;
  }
}

const SCHEMA = {
  type: "object",
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        properties: { version: { type: "integer" }, photo: { type: "integer" } },
        required: ["version", "photo"],
        additionalProperties: false,
      },
    },
  },
  required: ["picks"],
  additionalProperties: false,
} as const;

export async function pickAdPhotos(
  meter: MeterContext,
  offer: string,
  versions: { angle: string; hook: string }[],
  library: PhotoCandidate[],
): Promise<(PhotoCandidate | null)[]> {
  const none = versions.map(() => null);
  if (library.length === 0 || versions.length === 0) return none;

  const candidates: { photo: PhotoCandidate; data: string }[] = [];
  for (const photo of library.slice(0, MAX_CANDIDATES)) {
    const data = await thumb(photo.path);
    if (data) candidates.push({ photo, data });
  }
  if (candidates.length === 0) return none;

  const content: Anthropic.ContentBlockParam[] = [];
  candidates.forEach((c, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}:` });
    content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: c.data } });
  });
  content.push({
    type: "text",
    text: [
      `These are the business's own photographs. The ad is for: ${offer}`,
      "",
      ...versions.map((v, i) => `Version ${i + 1} (angle: ${v.angle || "-"}): ${v.hook}`),
      "",
      "For each version, choose the photo that best shows what the ad is for: the actual service, equipment or room it names, or a client receiving it.",
      "A photo of a DIFFERENT service is wrong even if it looks good: a massage photo never goes on a hyperbaric oxygen ad. Gym or food pictures never go on a therapy ad.",
      "Use a different photo for each version where more than one fits. Prefer sharp, well-lit, uncluttered photos with room for type.",
      "If no photo shows what the ad is for, answer 0 for that version.",
      'Return {"picks":[{"version":1,"photo":N}, ...]} with one entry per version.',
    ].join("\n"),
  });

  try {
    const message = await meteredCreate(meter, () => ({
      model: CONTENT_MODEL,
      max_tokens: 2000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    }));
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const picks = readPicks(text, versions.length, candidates.length);
    return picks.map((n) => (n == null ? null : candidates[n].photo));
  } catch (err) {
    console.error("[ads] photo pick failed, generating instead:", err);
    return none;
  }
}
