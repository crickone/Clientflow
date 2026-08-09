import "server-only";

import { AnthropicProvider } from "./anthropic";
import { OPENROUTER_MISSING_KEY_ERROR, OpenRouterProvider } from "./openrouter";
import type { ModelProvider } from "./types";

export * from "./types";
export { AnthropicProvider, OpenRouterProvider };

// Both stateless (all per-call state lives in StreamTurnArgs, never on the
// instance) — one instance each for the whole process, same lifecycle as
// getAnthropic()'s own cached client.
const anthropicProvider = new AnthropicProvider();
const openRouterProvider = new OpenRouterProvider();

/**
 * Resolves a model id to the ModelProvider that runs it.
 *
 * - `openrouter:`-prefixed ids (e.g. `openrouter:deepseek/deepseek-chat`) ->
 *   OpenRouterProvider, which strips the prefix to get the OpenRouter model
 *   slug for the wire call (see that file). Requires OPENROUTER_API_KEY: if
 *   it is unset, this throws a clear error rather than falling back to
 *   Anthropic — a model the picker offers must never silently run (and bill)
 *   a different model than the one requested. See
 *   .superpowers/sdd/multiprovider-task-2-brief.md.
 * - Every other id (every native `claude-*` id in @/lib/ai/client's MODELS
 *   today) -> AnthropicProvider, unchanged from MP1 — this is what preserves
 *   today's Anthropic behaviour exactly.
 */
export function getProvider(model: string): ModelProvider {
  if (model.startsWith("openrouter:")) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error(OPENROUTER_MISSING_KEY_ERROR);
    return openRouterProvider;
  }
  return anthropicProvider;
}
