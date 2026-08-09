import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/** Gym-facing model tiers. FABLE IS DELIBERATELY EXCLUDED (cost). */
export const MODELS = {
  haiku: "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-4-8",
} as const;
export type ModelTier = keyof typeof MODELS;
export const DEFAULT_AGENT_MODEL: ModelTier = "sonnet";

/** List price in CENTS per 1,000,000 tokens. */
export const PRICING: Record<string, { inCents: number; outCents: number }> = {
  [MODELS.haiku]: { inCents: 100, outCents: 500 },
  [MODELS.sonnet]: { inCents: 300, outCents: 1500 },
  [MODELS.opus]: { inCents: 500, outCents: 2500 },
  // Not a selectable gym-facing tier (see MODELS above) — this is the model
  // @/lib/ai/draftBlog.ts and @/lib/ai/generateCarousel.ts call directly via
  // their OWN Anthropic client, bypassing getAnthropic(). Priced identically
  // to claude-opus-4-8 so the Marketing tools' tool-boundary metering
  // (tools.marketing.ts, recordUsage(..., "claude-opus-4-7", usage)) prices
  // it accurately instead of falling back to the sonnet default in
  // estCostCents.
  "claude-opus-4-7": { inCents: 500, outCents: 2500 },
  // OpenRouter DeepSeek V4 Flash (dated snapshot "0731" — matches the catalog
  // id in @/lib/ai/modelCatalog's MODEL_CATALOG; pinned rather than the
  // "-latest" alias so this price can't silently drift if OpenRouter
  // repoints "latest" at a different snapshot). $0.14 in / $0.28 out per 1M
  // tokens is OpenRouter's MODAL price for this model: of the ~24 backend
  // providers OpenRouter fronts for it, 11 — including DeepSeek's own
  // official OpenRouter endpoint — price it at exactly this rate (a few
  // undercut it, e.g. DigitalOcean ~$0.08/$0.25; a few run pricier, e.g.
  // Wafer ~$0.28/$0.56). Sourced live from
  // openrouter.ai/api/v1/models/deepseek/deepseek-v4-flash-0731/endpoints.
  // Without this entry estCostCents would silently price every DeepSeek run
  // at the Sonnet fallback rate above (~21x too high on input, ~54x too high
  // on output), undermining the €25/tenant cap.
  "openrouter:deepseek/deepseek-v4-flash-0731": { inCents: 14, outCents: 28 },
};

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreateTokens?: number;
}

/** Estimated spend in cents. Cache read = 0.1x input; cache write = 1.25x input. */
export function estCostCents(model: string, u: Usage): number {
  const p = PRICING[model] ?? PRICING[MODELS.sonnet];
  const perM = (tokens: number, centsPerM: number) => (tokens / 1_000_000) * centsPerM;
  return (
    perM(u.inputTokens, p.inCents) +
    perM(u.outputTokens, p.outCents) +
    perM(u.cacheReadTokens ?? 0, p.inCents * 0.1) +
    perM(u.cacheCreateTokens ?? 0, p.inCents * 1.25)
  );
}

let _client: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  if (!_client) _client = new Anthropic();
  return _client;
}
