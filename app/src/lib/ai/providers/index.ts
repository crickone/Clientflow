import "server-only";

import { AnthropicProvider } from "./anthropic";
import type { ModelProvider } from "./types";

export * from "./types";
export { AnthropicProvider };

// Stateless (all per-call state lives in StreamTurnArgs, never on the
// instance) — one instance for the whole process, same lifecycle as
// getAnthropic()'s own cached client.
const anthropicProvider = new AnthropicProvider();

/**
 * Resolves a model id to the ModelProvider that runs it. Every id in
 * @/lib/ai/client's MODELS is a native `claude-*` Anthropic id today, so this
 * always returns AnthropicProvider — that is what preserves today's
 * behaviour exactly (MP1 adds no new provider). MP2 adds an
 * `openrouter:`-prefixed branch (routing to a new OpenRouterProvider, gated
 * on OPENROUTER_API_KEY); see .superpowers/sdd/multiprovider-design.md.
 */
export function getProvider(model: string): ModelProvider {
  void model; // unused until MP2 adds routing on it — kept as a real parameter for that branch
  return anthropicProvider;
}
