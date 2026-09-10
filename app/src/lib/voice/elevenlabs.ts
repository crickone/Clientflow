import "server-only";

/**
 * ElevenLabs Agents client — the ONLY file that talks to their HTTP API. Raw
 * `fetch`, deliberately NO SDK dependency, the same discipline as
 * MailgunSender (lib/marketing/sender/mailgun.ts), falClient
 * (lib/ai/image/falClient.ts) and voiceTranscribe (lib/ai/voiceTranscribe.ts):
 * one small self-contained file, so a provider swap or an API-version bump
 * never has to fight an SDK's assumptions.
 *
 * Fail-soft by design, mirroring voiceTranscribe exactly: `voiceConfigured()`
 * gates on ELEVENLABS_API_KEY alone, every function checks it FIRST — before
 * any network call — so an unconfigured deployment returns
 * `{ok:false,error:"not_configured"}` synchronously-fast and never touches the
 * network. Everything past that gate is wrapped in try/catch, so a timeout,
 * network error, non-2xx response or malformed body all become a typed
 * `{ok:false,error}` too. **This module NEVER throws.**
 *
 * That matters more here than anywhere else in the codebase: this is the only
 * module in the app that can cause a phone to ring in someone's pocket. A
 * thrown error in a dialler loop is a retry storm aimed at a real person.
 *
 * What lives OUTSIDE this file, deliberately:
 *   - entitlement, allowances, the spend cap and metering — lib/voice/usage.ts
 *   - which agent/number a tenant uses                    — lib/voice/config.ts
 *   - the call record and the lead timeline               — lib/voice/calls.ts
 *   - the gate-then-dial-then-record sequence             — lib/voice/dial.ts
 * This file knows only how to speak the provider's wire format.
 */

const API_BASE = "https://api.elevenlabs.io/v1";
const NOT_CONFIGURED_ERROR = "not_configured";

/** Placing a call is a control-plane request (it returns as soon as the dial is queued), not the call itself. */
const TIMEOUT_MS = 20_000;

export type VoiceApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export function voiceConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

/** Mirrors voiceConfigured()'s exact truthiness check, so the two can never disagree. */
function apiKey(): string | null {
  const key = process.env.ELEVENLABS_API_KEY;
  return key ? key : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function call<T>(
  path: string,
  init: { method: "GET" | "POST" | "PATCH"; body?: unknown },
): Promise<VoiceApiResult<T>> {
  const key = apiKey();
  if (!key) return { ok: false, error: NOT_CONFIGURED_ERROR };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: init.method,
      headers: {
        "xi-api-key": key,
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      // Their error bodies are JSON but the shape varies by endpoint; the raw
      // text (trimmed) is more useful to an operator than a guessed field.
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}` };
    }
    try {
      return { ok: true, data: (text ? JSON.parse(text) : {}) as T };
    } catch {
      return { ok: false, error: `Malformed JSON in response: ${text.slice(0, 200)}` };
    }
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Agents ──────────────────────────────────────────────────────────────────

export interface CreateAgentInput {
  /** Shown in the provider dashboard — always carries the tenant name, so an operator can tell whose agent is whose. */
  name: string;
  /** The full system prompt: who the agent is, the business's facts, and the guardrails. */
  prompt: string;
  /** The exact words it opens with. Must carry the AI disclosure — see lib/voice/config.ts. */
  firstMessage: string;
  /** Provider voice id. */
  voiceId?: string;
  /** Hard stop on call duration (seconds). This is what bounds the overshoot past a spend cap — see MAX_CALL_MINUTES. */
  maxDurationSeconds: number;
  language?: string;
}

/** Body shape for create/update — one builder so the two can't drift apart. */
function agentBody(input: CreateAgentInput) {
  return {
    name: input.name,
    conversation_config: {
      agent: {
        prompt: { prompt: input.prompt },
        first_message: input.firstMessage,
        language: input.language ?? "en",
      },
      tts: input.voiceId ? { voice_id: input.voiceId } : undefined,
      conversation: { max_duration_seconds: input.maxDurationSeconds },
    },
  };
}

export function createAgent(input: CreateAgentInput): Promise<VoiceApiResult<{ agent_id: string }>> {
  return call("/convai/agents/create", { method: "POST", body: agentBody(input) });
}

export function updateAgent(
  agentId: string,
  input: CreateAgentInput,
): Promise<VoiceApiResult<{ agent_id: string }>> {
  return call(`/convai/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    body: agentBody(input),
  });
}

// ─── Outbound calls ──────────────────────────────────────────────────────────

export interface OutboundCallInput {
  agentId: string;
  /** The provider-side id of the imported number the call is placed FROM — the client's own number, never ours. */
  phoneNumberId: string;
  /** E.164. */
  toNumber: string;
  /** Merged into the agent's prompt for this one call (lead name, interest, source, last touch). */
  variables?: Record<string, string>;
}

export interface OutboundCallResult {
  /** The conversation id every later webhook is keyed by — persisted into voice_call_index at dial time. */
  conversation_id?: string;
  callSid?: string;
  success?: boolean;
  message?: string;
}

/**
 * Place one outbound call. Returns as soon as the provider has QUEUED the dial
 * — the conversation itself then runs on their side, and its outcome arrives
 * later on the post-call webhook. A successful result here means "we asked for
 * a call", never "someone answered".
 */
export function outboundCall(input: OutboundCallInput): Promise<VoiceApiResult<OutboundCallResult>> {
  return call("/convai/twilio/outbound-call", {
    method: "POST",
    body: {
      agent_id: input.agentId,
      agent_phone_number_id: input.phoneNumberId,
      to_number: input.toNumber,
      conversation_initiation_client_data: input.variables
        ? { dynamic_variables: input.variables }
        : undefined,
    },
  });
}

// ─── Conversations (the read side) ───────────────────────────────────────────

export interface ConversationDetail {
  conversation_id?: string;
  status?: string;
  transcript?: Array<{ role?: string; message?: string; time_in_call_secs?: number }>;
  metadata?: { call_duration_secs?: number; start_time_unix_secs?: number };
  analysis?: {
    transcript_summary?: string;
    call_successful?: string;
    data_collection_results?: Record<string, unknown>;
  };
}

/**
 * Fetch one finished conversation. The post-call webhook already carries this,
 * so this is the RECONCILIATION path: a call still sitting at 'dialling'
 * because its webhook was lost can be resolved by asking directly.
 */
export function getConversation(conversationId: string): Promise<VoiceApiResult<ConversationDetail>> {
  return call(`/convai/conversations/${encodeURIComponent(conversationId)}`, { method: "GET" });
}

/** Flatten a provider transcript into the plain text the lead timeline stores. */
export function transcriptToText(convo: ConversationDetail): string {
  const turns = convo.transcript ?? [];
  return turns
    .filter((t) => (t.message ?? "").trim().length > 0)
    .map((t) => `${t.role === "user" ? "Them" : "Agent"}: ${(t.message ?? "").trim()}`)
    .join("\n");
}
