import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { getBusinessContext } from "@/lib/ai/businessContext";
import { MODELS } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";
import { getVenueType } from "@/lib/settings";
import { CTAS } from "@/lib/ads/spec";
import { AD_GOAL_LABEL, LIMITS, coerceCopy, type AdBrief, type AdCopy } from "@/lib/ads/adCopy";

/**
 * The copy for an ad's three versions. An ad is not a post: it interrupts
 * someone who did not ask to see it, so it leads with one idea, says who it is
 * for and what to do, and each version tests a DIFFERENT angle so Meta can
 * find the one that works.
 */
const RULES = `You write PAID social ads (Facebook and Instagram) for the business above. An ad is not an organic post: it interrupts someone scrolling, so it makes ONE point, fast, and tells them what to do.

Write exactly THREE versions. Each tests a different angle (for example: the outcome they want described plainly, the objection that stops them, how easy it is to start, who it is for, a specific detail of the service). Never three rewordings of one idea.

For each version:
- angle: the idea it tests, 2 to 5 words.
- hook: the words ON the image. Short, concrete, readable at thumbnail size. At most ${LIMITS.hook} characters. No question about a personal characteristic or condition ("Are you overweight?", "Do you have back pain?") -- Meta rejects those.
- support: an optional second line on the image, at most ${LIMITS.support} characters. Empty is fine.
- primaryText: the text above the image, and the part that does the selling. It must make someone who has never heard of the business want to book. 700 to 1100 characters, in short paragraphs separated by blank lines, built in this order:
  1. THE HOOK LINE. One line, under 125 characters (only that much shows before "See more"), saying the version's idea plainly and specifically. It must make the right person stop.
  2. WHAT THEY WANT. One or two sentences on the reader's real situation and the result they are working towards (recovering between training sessions, sleeping better, easing stiffness, having an hour that is theirs), in their words, so they recognise themselves. Describe the goal; never promise the service delivers it.
  3. WHAT THEY GET, AND WHY IT MATTERS. A stacked list of 4 to 6 lines, each starting with "• ". Every line pairs a concrete fact with what it means for the reader ("60 minutes in the chamber, so you have time to settle in and simply breathe"; "Our team talks you through each step first, so you know exactly what to expect"). Build the stack from the four things that make an offer worth taking:
     - the result they are after (what the session is for, and how it works: a plain fact about the mechanism is fine, e.g. under pressure more oxygen dissolves into the blood plasma),
     - why they can trust it will suit them (who guides them, the equipment, the experience, the plan for their block),
     - how soon and how often (session length, how a block fits a week),
     - how little effort it takes (what they actually do, booking, parking, what to bring).
     Every fact comes from the business details or the brief. A line that only restates the offer ("Each session lasts 60 minutes") without saying what it means for them is not good enough.
  4. WHY HERE. One or two sentences giving a specific reason to choose this business over trying it somewhere else or not at all: a fact about the team, the equipment, the experience or the place, taken from the business details. Not a list of their other services.
  5. THE NEXT STEP. One line telling them exactly what to do and how ("Tap Book now to pick a time that suits you." / "Send us a message and we'll answer your questions first."). Include the phone number only if it is in the business details.
  No hashtags. Plain, short sentences.
- headline: under the image beside the button, at most ${LIMITS.headline} characters.
- description: at most ${LIMITS.description} characters, often the town or a short fact. Empty is fine.
- cta: one of ${CTAS.join(", ")}.

Rules that always apply:
- State only facts from the business details and the brief. Never invent a price, a result, a statistic, a testimonial or an offer.
- No prices, discounts, free sessions, free consultations or money-back guarantees UNLESS the brief itself states them.
- For a clinic, therapy or wellness business: never say a service cures, treats or fixes a condition, and never promise a result. Describing what the service is and how it works is fine.
- Plain, confident, specific. No hype words, no exclamation marks, no emojis. Irish English.
- Every sentence states a fact the reader can use. Banned: "X rather than Y", "not just X", "more than just", poetic or abstract lines, warm filler about how a room feels. If a sentence says nothing concrete, cut it.
- Never say what clients find, feel, report or usually do ("many clients find", "people often visit us when") unless the business details say it: that is an invented testimonial. Describe the reader's situation in the second person instead.
- Describe the mechanism, never the benefit as a claim: "more oxygen dissolves into the blood plasma" is a fact; "used for cellular recovery", "boosts healing" or "reduces inflammation" are claims and are banned.
- Persuade with specifics, never with invented urgency: no "limited spots", "only this week" or countdowns unless the brief states them.

Return ONLY JSON: {"versions":[{"angle":"","hook":"","support":"","primaryText":"","headline":"","description":"","cta":""}, ...three]}`;

const SCHEMA = {
  type: "object",
  properties: {
    versions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          angle: { type: "string" },
          hook: { type: "string" },
          support: { type: "string" },
          primaryText: { type: "string" },
          headline: { type: "string" },
          description: { type: "string" },
          cta: { type: "string", enum: [...CTAS] },
        },
        required: ["angle", "hook", "support", "primaryText", "headline", "description", "cta"],
        additionalProperties: false,
      },
    },
  },
  required: ["versions"],
  additionalProperties: false,
} as const;

export async function writeAdCopy(tenantId: number, brief: AdBrief): Promise<AdCopy[]> {
  const message = await meteredCreate({ tenantId, agentKey: "ads" }, () => ({
    model: MODELS.opus,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    // Copy that runs on paid placements under the business's name: `medium`.
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: [{ type: "text", text: `${getBusinessContext()}\n\n${RULES}`, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          `Business type: ${getVenueType()}`,
          `What the ad is for: ${brief.offer}`,
          `Who it is for: ${brief.audience || "(not given; infer from the business)"}`,
          `Goal: ${AD_GOAL_LABEL[brief.goal]}`,
          brief.linkUrl ? `Button links to: ${brief.linkUrl}` : "",
          "",
          "Write the three versions.",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  }));
  if (message.stop_reason === "refusal") throw new Error("Adonis declined to write this ad. Try describing the offer differently.");
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Adonis returned ad copy that could not be read. Try again.");
  }
  const versions = ((parsed as { versions?: unknown[] }).versions ?? [])
    .map((v) => coerceCopy(v, brief.goal))
    .filter((v): v is AdCopy => v !== null)
    .slice(0, 3);
  if (versions.length === 0) throw new Error("Adonis did not write any usable ad copy. Try again.");
  return versions;
}
