import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropic } from "./client";
import { getProvider } from "./providers";
import { assertAiAllowed, meterAndCharge } from "./usage";

/**
 * The ONE metered path for a one-shot (non-streaming) Anthropic call.
 *
 * Before this existed, every generator and one-shot call site hand-rolled the
 * same three steps around its own `new Anthropic().messages.create(...)`:
 * gate before, the SDK call, meter after — mapping `message.usage` to the
 * shared `Usage` shape by copy-paste. A NEW call site that forgot either half
 * would silently dodge the per-tenant AI spend accounting (@/lib/ai/usage).
 * Routing every such call through here makes both halves UNSKIPPABLE via
 * `assertAiAllowed` (free-tranche-or-credits gate) + `meterAndCharge` (record
 * usage, bill overflow), and a CI guard (meteredGuard.test.ts) fails the build
 * if any file outside the small sanctioned set constructs/streams the SDK.
 *
 * The AGENT tool-use loop is metered separately and does NOT come through here
 * — it streams (`provider.streamTurn`) and meters once per turn inside
 * `runAgentTurn` (@/lib/agents/runAgentTurn), the streaming chokepoint. This
 * function is only for the non-streaming, single-shot generators/utilities.
 *
 * `buildParams` is a THUNK, not a plain params object, on purpose:
 * `assertAiAllowed` must run BEFORE any per-call work — prompt assembly and the
 * DB reads it drags in (the venue-aware business context, the tag vocabulary)
 * — so a blocked tenant fails fast without burning that work, exactly the
 * ordering every call site documented ("checked first, before the API-key
 * guard"). It also keeps the gate the FIRST thing that can throw: several call
 * sites are exercised in tests with no ambient tenant, where building the
 * prompt would otherwise throw a tenant-resolution error before the gate ran
 * (see draftFollowup.test.ts / altText.test.ts).
 */
export interface MeterContext {
  /** The tenant this call is gated for (free-tranche-or-credits) and whose spend/overflow it is charged to. */
  tenantId: number;
  /** The per-agent bucket this call's spend is recorded under (drives the Agents-page breakdown), e.g. "blog", "triage", "carousel". */
  agentKey: string;
}

/** SDK `Message.usage` → the shared metering `Usage` shape (the mapping every call site had duplicated verbatim, including the may-be-null cache fields → 0). */
function usageFromMessage(u: Anthropic.Message["usage"]) {
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreateTokens: u.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Gate, make one non-streaming Anthropic call, meter it. Returns the raw
 * `Message` — callers extract text / tool-use / structured output from it
 * exactly as they did from their own `messages.create` result.
 *
 * Spend is recorded under the REQUESTED model id (`params.model`, e.g.
 * `MODELS.sonnet`), not `message.model` — that's the id `PRICING` keys off and
 * the one every call site metered under before, so the per-model breakdown and
 * cost estimate are unchanged.
 *
 * `AiCapError` (from `assertAiAllowed` — free tranche used up + no credits) and
 * any SDK/network error propagate; callers decide whether to surface (most) or
 * swallow (best-effort ones like alt-text) them, the same choice they already
 * made around their inline call.
 */
export async function meteredCreate(
  meter: MeterContext,
  buildParams: () => Anthropic.MessageCreateParamsNonStreaming,
): Promise<Anthropic.Message> {
  assertAiAllowed(meter.tenantId);
  const params = buildParams();
  const message = await getAnthropic().messages.create(params);
  meterAndCharge(meter.tenantId, meter.agentKey, params.model, usageFromMessage(message.usage));
  return message;
}

/**
 * Provider-NEUTRAL one-shot metered completion — the same gate-then-meter
 * wrapper as `meteredCreate`, but routed through `getProvider(model).streamTurn`
 * (@/lib/ai/providers) so it can run an OpenRouter model too, not only native
 * Anthropic. A single user prompt in, the assistant's text out — no tools, no
 * `onText` (it accumulates internally and returns the full text). Usage is
 * metered under the REQUESTED `model` exactly like `meteredCreate` (PRICING has
 * entries for the OpenRouter ids). This is NOT raw-SDK access — it goes through
 * the provider abstraction (the same one `runAgentTurn` uses), so it stays a
 * proper metering chokepoint the CI guard (meteredGuard.test.ts) is happy with.
 *
 * Campaign generation uses this ONLY for its `openrouter:`-prefixed build
 * models; native Anthropic models keep going through `meteredCreate` above so
 * their adaptive `thinking` + system prompt caching are preserved unchanged.
 * `getProvider` throws OPENROUTER_MISSING_KEY_ERROR if an OpenRouter id is
 * passed with no OPENROUTER_API_KEY — same fail-loud contract as the chat.
 */
export async function meteredComplete(
  meter: MeterContext,
  args: { model: string; system: string; prompt: string; maxTokens: number },
): Promise<string> {
  assertAiAllowed(meter.tenantId);
  const result = await getProvider(args.model).streamTurn({
    model: args.model,
    system: args.system,
    tools: [],
    messages: [{ role: "user", content: args.prompt }],
    maxTokens: args.maxTokens,
  });
  meterAndCharge(meter.tenantId, meter.agentKey, args.model, result.usage);
  return result.text;
}

/**
 * The ONE shape for a metered, best-effort text completion that NEVER
 * throws — "gate → call → extract text → parse → NEVER throw → return a
 * neutral default". Before this existed, ~5 call sites (research/summary.ts's
 * competitorThemes/landscapeSummary/adAngle, ai/altText.ts's generateAltText,
 * marketing/campaignRadar.ts's getCampaignRadar) hand-rolled this same shell
 * around their own `try { meteredCreate(...); extract text; parse; } catch
 * { log; return fallback; }` — identical plumbing, only the prompt, the
 * parse/validation step, and the fallback value actually varied per call
 * site. Centralizing the plumbing here means a new best-effort call site
 * can't forget the catch, forget to log, or accidentally let something
 * throw past it.
 *
 * Routes through `meteredCreate` above (not the raw SDK), so `assertAiAllowed`
 * (the cap gate) and `meterAndCharge` (usage recording) still run exactly as
 * they did inline, and the CI guard (meteredGuard.test.ts) — which only
 * sanctions this file, `client.ts`, `providers/anthropic.ts`, and
 * `image/falClient.ts` to touch the SDK directly — stays satisfied, since
 * this is a same-module call to `meteredCreate`, not a new SDK access point.
 * `buildParams` keeps the same THUNK contract `meteredCreate` documents above
 * (gate runs before any per-call work); it's called unchanged, so a blocked
 * tenant still fails fast before prompt assembly.
 *
 * Text extraction is the ONE fixed shape every migrated call site already
 * used: filter to text blocks, join with "\n", trim. `parseText` receives
 * that trimmed text and turns it into the caller's `T` — this is where each
 * call site's own validation lives (e.g. a no-fabrication line-parser, a
 * JSON parse, a plain pass-through), including any caching/side-effect work
 * a caller used to do inline after a successful parse (throwing from
 * `parseText` — e.g. a cache write failing — lands in the same catch as a
 * network error, exactly like the hand-rolled version did when that write
 * was still inside its `try`).
 *
 * NEVER throws: `meteredCreate` failing (`AiCapError` from an over-cap
 * tenant, a missing/misconfigured API key, a network error) and `parseText`
 * throwing both land in the same catch, get logged as
 * `[${logTag}] fallback: <err>`, and resolve to `fallback` — the neutral,
 * locally-computed default every migrated call site already had on hand.
 */
export async function meteredCreateFailSoft<T>(
  meter: MeterContext,
  buildParams: () => Anthropic.MessageCreateParamsNonStreaming,
  parseText: (text: string) => T,
  fallback: T,
  logTag: string,
): Promise<T> {
  try {
    const message = await meteredCreate(meter, buildParams);
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    return parseText(text);
  } catch (err) {
    console.error(`[${logTag}] fallback:`, err);
    return fallback;
  }
}
