import "server-only";

import { CONTENT_MODEL } from "@/lib/ai/client";
import { meteredCreateFailSoft } from "@/lib/ai/metered";
import { getBusinessContext } from "@/lib/ai/businessContext";
import { similarHooks } from "@/lib/ai/image/postIdeas";
import { getVenueType } from "@/lib/settings";
import { AD_GOALS, AD_GOAL_LABEL, type AdGoal } from "@/lib/ads/adCopy";

/**
 * Ad concepts for the New ad composer: the ad counterpart of post ideas
 * (@/lib/ai/image/postIdeas), and built the same way for the same reason.
 *
 * A post idea is something to TEACH. An ad concept is something to SELL: one
 * offer, aimed at one kind of person, from one angle, with one thing to do
 * next. So each concept carries the brief the composer needs (offer, audience,
 * goal) as well as the line that would sit on the image.
 *
 * Variety comes from the same two levers as post ideas: every run draws a
 * different set of ANGLES from the catalogue below, and the caller passes what
 * has already been shown so the prompt can rule it out and `similarHooks` can
 * filter whatever slips through.
 */

export interface AdIdea {
  /** The angle it takes, 2 to 4 words ("The first visit"). */
  angle: string;
  /** The line that would sit on the ad image. */
  hook: string;
  /** What the ad is for: the service or offer, as the composer's brief. */
  offer: string;
  /** Who it is aimed at. */
  audience: string;
  goal: AdGoal;
  /** Why this angle should work for this offer and this person. */
  why: string;
}

/**
 * The shape of an ad, not its subject. Venue-neutral so it reads for a clinic
 * and a gym alike, and long enough that two runs of six rarely draw the same
 * set.
 */
export const AD_ANGLES: readonly string[] = [
  "The problem: name the specific situation the reader is in right now, in their words.",
  "The outcome: describe plainly what changes for them, without promising a result.",
  "The objection: answer the one doubt that stops people booking.",
  "The first visit: show exactly what happens when they walk in, so nothing is unknown.",
  "Who it is for: call out one specific kind of person so they recognise themselves.",
  "How it works: one plain sentence on the mechanism behind the service.",
  "Easy to start: how little it takes to begin, and what the first step is.",
  "The timely reason: a season, event or moment that makes now the right time.",
  "The local angle: for people nearby, with the town named.",
  "The comparison: how it differs from what they have probably tried already.",
  "The detail: one concrete detail of the service that shows the care in it.",
  "The routine: how it fits around work, training or family life.",
  "The pairing: two services that work well together, and why.",
  "The returning client: a reason for someone who has been before to come back.",
];

export function pickAdAngles(n: number, rand: () => number = Math.random): string[] {
  const pool = [...AD_ANGLES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

/** Keep at most `n` concepts that repeat neither the avoid list nor each other. */
export function dedupeAdIdeas(ideas: AdIdea[], avoid: Iterable<string>, n: number): AdIdea[] {
  const seen = [...avoid].map((h) => h.trim()).filter(Boolean);
  const out: AdIdea[] = [];
  for (const idea of ideas) {
    if (out.length >= n) break;
    if (seen.some((h) => similarHooks(h, idea.hook) || similarHooks(h, idea.offer))) continue;
    out.push(idea);
    seen.push(idea.hook);
  }
  return out;
}

export function coerceAdIdea(raw: unknown): AdIdea | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const str = (k: string, max: number) => (typeof o[k] === "string" ? (o[k] as string).trim().slice(0, max) : "");
  const hook = str("hook", 80);
  const offer = str("offer", 400);
  if (!hook || !offer) return null;
  return {
    angle: str("angle", 40) || "Ad",
    hook,
    offer,
    audience: str("audience", 200),
    goal: AD_GOALS.includes(o.goal as AdGoal) ? (o.goal as AdGoal) : "bookings",
    why: str("why", 300),
  };
}

const SCHEMA = {
  type: "object",
  properties: {
    ideas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          angle: { type: "string" },
          hook: { type: "string" },
          offer: { type: "string" },
          audience: { type: "string" },
          goal: { type: "string", enum: [...AD_GOALS] },
          why: { type: "string" },
        },
        required: ["angle", "hook", "offer", "audience", "goal", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["ideas"],
  additionalProperties: false,
} as const;

/** Extra concepts to ask for so the repeat filter has slack. */
const OVERDRAW = 2;

export async function generateAdIdeas(
  tenantId: number,
  count = 6,
  opts: { avoid?: readonly string[] } = {},
): Promise<AdIdea[]> {
  const n = Math.max(1, Math.min(8, count));
  const avoid = (opts.avoid ?? []).map((h) => h.trim()).filter(Boolean).slice(0, 60);
  const ask = n + OVERDRAW;
  const angles = pickAdAngles(ask);

  return meteredCreateFailSoft<AdIdea[]>(
    { tenantId, agentKey: "ads" },
    () => ({
      model: CONTENT_MODEL,
      max_tokens: 6000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      system:
        `${getBusinessContext()}\n\n` +
        `Business type: ${getVenueType()}\n\n` +
        "You propose PAID social ad concepts (Facebook and Instagram) for this business. " +
        "Each concept is one offer, aimed at one kind of person, from one angle, with one thing to do next.\n\n" +
        "Spread the concepts across the business's different services and audiences. Use the " +
        "marketing brain and any offer design above. No two concepts may advertise the same " +
        "service to the same person.\n\n" +
        "For each concept:\n" +
        "- angle: the angle it takes, 2 to 4 words, sentence case.\n" +
        "- hook: the words on the ad image. Short, concrete, readable at thumbnail size, at most 60 characters. " +
        'Never a question about a personal characteristic or condition ("Do you have back pain?") -- Meta rejects those.\n' +
        "- offer: what the ad is for, written as a one or two sentence brief: the service, what it involves, where.\n" +
        "- audience: who it is aimed at, in one short phrase.\n" +
        `- goal: what the ad asks people to do, one of: ${AD_GOALS.map((g) => `${g} (${AD_GOAL_LABEL[g]})`).join(", ")}.\n` +
        "- why: one or two plain sentences on why this angle suits this offer and this person.\n\n" +
        "Rules that always apply:\n" +
        "- State only facts from the business details. Never invent a price, a result, a statistic, a testimonial or an offer.\n" +
        "- No prices, discounts, free sessions, free consultations or money-back guarantees.\n" +
        "- Never say what clients feel, say or report (\"many clients leave calmer\"), and never mention research or studies.\n" +
        "- For a clinic, therapy or wellness business: never say a service cures, treats or fixes a condition, and never promise a result.\n" +
        "- Plain, specific words. No hype, no exclamation marks, no emojis. Irish English.",
      messages: [
        {
          role: "user",
          content:
            `Give me ${ask} ad concepts, one for each of these angles, in order:\n` +
            angles.map((a, i) => `${i + 1}. ${a}`).join("\n") +
            (avoid.length
              ? "\n\nALREADY PROPOSED -- do not suggest any of these again or a rephrasing of one:\n" +
                avoid.map((h) => `- ${h}`).join("\n")
              : ""),
        },
      ],
    }),
    (text) => {
      const parsed = (JSON.parse(text) as { ideas?: unknown[] }).ideas ?? [];
      const ideas = parsed.map(coerceAdIdea).filter((x): x is AdIdea => x !== null);
      const kept = dedupeAdIdeas(ideas, avoid, n);
      if (kept.length === 0) {
        console.warn(`[ad-ideas] empty batch for tenant ${tenantId}: ${ideas.length} parsed, ${avoid.length} to avoid`);
      }
      return kept;
    },
    [],
    "ad-ideas",
  );
}
