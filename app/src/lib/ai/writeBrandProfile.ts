import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { MODELS } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";

/**
 * Turns the brand interview into the four texts every piece of AI content
 * reads: the brief, tone notes, the marketing brain and the AI image style.
 *
 * The rules below are the lessons of the Optimal Health "feel the room"
 * episode: a marketing brain full of mood ("try the room", "get a feel for
 * the space") made every post say it. So the brain is built to TEACH --
 * content pillars are subjects to explain, not atmospheres -- and nothing
 * the owner didn't say is invented.
 */

export interface BrandDraft {
  tagline: string;
  brief: string;
  voiceNotes: string;
  marketingBrain: string;
  imageStyle: string;
}

const SCHEMA = {
  type: "object",
  properties: {
    tagline: { type: "string" },
    brief: { type: "string" },
    voiceNotes: { type: "string" },
    marketingBrain: { type: "string" },
    imageStyle: { type: "string" },
  },
  required: ["tagline", "brief", "voiceNotes", "marketingBrain", "imageStyle"],
  additionalProperties: false,
} as const;

const RULES = `You write the brand setup that an AI marketing assistant reads before writing ANY content for this business: social posts, blogs, emails, ads and replies. You are given the owner's interview answers. Write five things:

1. tagline: a short descriptor, 3 to 8 words, lower case unless a name, e.g. "a coach-led strength gym in Clonmel".

2. brief: 80 to 150 words. What the business does, who it serves, what makes it different, how people start. Facts only, from the answers. Third person.

3. voiceNotes: 3 to 6 short lines on how it should sound: the tone words they chose made concrete, words they use and words they hate, spelling.

4. marketingBrain: the master prompt. Use exactly these headed sections, each a short list of "- " lines:
   You are the marketing voice for <business, one line>.
   Industry & focus:
   Who we serve:
   What they want:
   What holds them back (answer these in content):
   What makes us different:
   Content pillars (write about these):
   Tone:
   Always:
   Never:
   Content pillars are SUBJECTS TO TEACH (how something works, a common mistake, how to start, what to expect), never moods or atmospheres. Include under Always: "Teach something specific in every post: how it works, why it matters, what to do." Under Always add "Irish English spelling (organise, colour, programme)." Under Never include everything they ticked, plus: invent results, statistics, testimonials, prices or offers; promise guaranteed results; make medical claims; describe how a room or space feels instead of giving facts.

5. imageStyle: one sentence, under 300 characters, the photographic look for every AI-made image: light, colours, setting, the kind of people, mood. From their photo-feel answers and the business type. No text in images is handled elsewhere; don't mention it.

Rules for everything you write:
- Use only what the owner said. If something wasn't answered, leave it out rather than guessing. Never invent credentials, numbers, results or offers.
- Plain, specific sentences. No "not just X, it's Y", no "X rather than Y", no poetic phrasing, no filler about journeys or transformations. If a line states no fact, cut it.
- No prices anywhere. No emojis.

Return ONLY JSON: {"tagline":"","brief":"","voiceNotes":"","marketingBrain":"","imageStyle":""}`;

export async function writeBrandProfile(
  tenantId: number,
  input: { businessName: string; venue: "gym" | "clinic"; location: string; answers: string },
): Promise<BrandDraft> {
  const message = await meteredCreate({ tenantId, agentKey: "brand" }, () => ({
    model: MODELS.opus,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: RULES,
    messages: [
      {
        role: "user",
        content: [
          `Business: ${input.businessName}`,
          `Type: ${input.venue}`,
          input.location ? `Location: ${input.location}` : "",
          "",
          "Interview answers:",
          input.answers,
        ]
          .filter((l) => l !== "")
          .join("\n"),
      },
    ],
  }));
  if (message.stop_reason === "refusal") throw new Error("Adonis couldn't write this one. Try changing a few answers.");
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  let raw: Partial<BrandDraft>;
  try {
    raw = JSON.parse(text) as Partial<BrandDraft>;
  } catch {
    throw new Error("Adonis's answer couldn't be read. Try again.");
  }
  const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const draft: BrandDraft = {
    tagline: clip(raw.tagline, 120),
    brief: clip(raw.brief, 2000),
    voiceNotes: clip(raw.voiceNotes, 1500),
    marketingBrain: clip(raw.marketingBrain, 6000),
    imageStyle: clip(raw.imageStyle, 600),
  };
  if (!draft.brief || !draft.marketingBrain) throw new Error("Adonis didn't have enough to go on. Answer a few more questions and try again.");
  return draft;
}
