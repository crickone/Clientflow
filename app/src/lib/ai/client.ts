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
