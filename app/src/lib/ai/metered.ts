import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { getAnthropic } from "./client";
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
