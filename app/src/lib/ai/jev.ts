import "server-only";

import { assertAiAllowed, meterAndCharge } from "@/lib/ai/usage";
import { JEV_MODEL, type JevAnswer, type JevQuestion } from "@/lib/ai/jevTriageModel";

/**
 * Jev (TypeSafe AI) through Vercel's AI Gateway: typed questions in, typed
 * answers out. Raw fetch against the gateway's decision endpoint, the same
 * request the AI SDK's experimental_decide makes, so there is no `ai`
 * dependency (it needs Node 22; the image runs 20). Metered against the
 * business's AI cap like every other paid call. Never throws: failures come
 * back as { ok: false } with a readable reason.
 */

// JEV_TEST_BASE points at a local stand-in for development tests only.
const URL = `${process.env.JEV_TEST_BASE?.trim() || "https://ai-gateway.vercel.sh/v4/ai"}/decision-model`;

export function jevConfigured(): boolean {
  return Boolean(process.env.AI_GATEWAY_API_KEY?.trim());
}

export type JevResult =
  | { ok: true; answers: Record<string, JevAnswer>; ms: number; inputTokens: number }
  | { ok: false; error: string; ms: number };

export async function jevDecide(
  meter: { tenantId: number; agentKey: string },
  state: Record<string, unknown>,
  questions: Record<string, JevQuestion>,
  timeoutMs = 8000,
): Promise<JevResult> {
  const t0 = Date.now();
  const key = process.env.AI_GATEWAY_API_KEY?.trim();
  if (!key) return { ok: false, error: "AI_GATEWAY_API_KEY isn't set.", ms: 0 };
  try {
    assertAiAllowed(meter.tenantId);
  } catch {
    return { ok: false, error: "This business has used its AI allowance for the month.", ms: 0 };
  }
  let res: Response;
  try {
    res = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "ai-gateway-protocol-version": "0.0.1",
        "ai-gateway-auth-method": "api-key",
        "ai-decision-model-specification-version": "4",
        "ai-model-id": JEV_MODEL,
      },
      body: JSON.stringify({ stateParts: [{ type: "json", value: state }], questions }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error && err.name === "TimeoutError" ? `No answer within ${timeoutMs / 1000} seconds.` : "Couldn't reach the AI Gateway.", ms: Date.now() - t0 };
  }
  const ms = Date.now() - t0;
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  if (!res.ok) {
    const err = (body as { error?: { message?: unknown; type?: unknown } } | null)?.error;
    const why =
      err?.type === "customer_verification_required"
        ? "Vercel needs a credit card on the account before the gateway answers."
        : res.status === 401
          ? "Vercel rejected the API key. Check AI_GATEWAY_API_KEY in Railway."
          : res.status === 429
            ? "The gateway is rate limiting requests."
            : typeof err?.message === "string"
              ? err.message.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 200)
              : `Gateway error ${res.status}.`;
    return { ok: false, error: why, ms };
  }
  const b = body as { answers?: Record<string, JevAnswer>; usage?: { inputTokens?: number; outputTokens?: number } } | null;
  if (!b?.answers || typeof b.answers !== "object") return { ok: false, error: "The gateway's answer had no decisions in it.", ms };
  const inputTokens = Number(b.usage?.inputTokens) || 0;
  meterAndCharge(meter.tenantId, meter.agentKey, JEV_MODEL, { inputTokens, outputTokens: Number(b.usage?.outputTokens) || 0 });
  return { ok: true, answers: b.answers, ms, inputTokens };
}
