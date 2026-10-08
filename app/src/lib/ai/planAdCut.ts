import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

import { getBusinessContext } from "@/lib/ai/businessContext";
import { MODELS } from "@/lib/ai/client";
import { meteredCreate } from "@/lib/ai/metered";
import type { Transcript } from "@/lib/ai/transcribe";
import type { AdBrief } from "@/lib/ads/adCopy";

/**
 * Which sentences of a clip make the ad, and in what order. Ads are watched
 * with the sound off and skipped in under three seconds, so the strongest,
 * clearest line goes FIRST whatever order it was said in, then only what
 * earns its place, inside the length limit.
 */
const RULES = `You cut a recorded clip into a short PAID social video ad for the business above.

You get the clip's sentences, numbered, with their length. Choose which to use and in what ORDER:
- Open on the single strongest line: the one that makes a stranger stop scrolling (a clear benefit, a surprising fact, a direct statement of who it is for). It does not have to be the first thing said.
- Then only the sentences that support it: what it is, who it is for, what to do next. Drop greetings, filler, repetition and anything off-topic.
- Stay within the time limit. Shorter is better than padded.
- Never use a sentence that makes a medical claim or promises a result.

Return ONLY JSON: {"order":[sentence ids in play order],"hook":"the opening line, as said"}`;

const SCHEMA = {
  type: "object",
  properties: {
    order: { type: "array", items: { type: "integer" } },
    hook: { type: "string" },
  },
  required: ["order", "hook"],
  additionalProperties: false,
} as const;

export async function planAdCut(input: { tenantId: number; transcript: Transcript; brief: AdBrief; maxSeconds: number }): Promise<{ order: number[]; hook: string }> {
  const lines = input.transcript.segments.map((s) => `[${s.id}] (${(s.end - s.start).toFixed(1)}s) ${s.text.trim()}`);
  const message = await meteredCreate({ tenantId: input.tenantId, agentKey: "ads" }, () => ({
    model: MODELS.opus,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
    system: [{ type: "text", text: `${getBusinessContext()}\n\n${RULES}`, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          `The ad is for: ${input.brief.offer}`,
          input.brief.audience ? `Who it is for: ${input.brief.audience}` : "",
          `Time limit: ${input.maxSeconds} seconds`,
          "",
          "Sentences:",
          ...lines,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  }));
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  try {
    const parsed = JSON.parse(text) as { order?: unknown; hook?: unknown };
    const order = Array.isArray(parsed.order) ? parsed.order.map(Number).filter((n) => Number.isInteger(n)) : [];
    return { order, hook: typeof parsed.hook === "string" ? parsed.hook : "" };
  } catch {
    return { order: [], hook: "" };
  }
}
