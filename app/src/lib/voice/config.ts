import "server-only";

import { readKey, setKey } from "@/lib/settings";
import { getBusinessName, getServicesList } from "@/lib/ai/businessContext";
import { getBusinessProfile } from "@/lib/businessProfile";
import { MAX_CALL_MINUTES } from "./usage";

/**
 * What this tenant's voice agent IS: which provider agent and phone number it
 * uses, and the prompt it speaks from. Per-tenant, stored as a settings key
 * (the same shape as `whatsapp/config.ts`), never in env — one deployment runs
 * every tenant's agent.
 *
 * The prompt is BUILT here rather than stored, so a change to the business
 * profile, the service list or the guardrails reaches the agent the next time
 * it is provisioned instead of leaving a stale copy frozen in the provider's
 * dashboard. `voicePersona` is the only free-text part an operator edits.
 *
 * The guardrails are not decoration. Everything an outbound sales agent could
 * say that would cost the client money or a complaint is enumerated as a
 * prohibition, because the model will otherwise improvise all of them: prices
 * it half-remembers, discounts nobody authorised, medical claims a wellness
 * clinic must never make, and a refund promise the business would then have to
 * honour. This mirrors the house rule already in force for generated marketing
 * copy (no money-back guarantees, no free consults, no invented pricing) — the
 * difference is that a phone call is spoken once and cannot be edited after.
 */

const CONFIG_KEY = "voice_agent_config";

export interface VoiceAgentConfig {
  /** Provider agent id, set once provisioned. Empty = never provisioned. */
  agentId: string;
  /** Provider id for the imported number calls are placed FROM — the CLIENT's number, never the platform's. */
  phoneNumberId: string;
  /** The number as dialled, for display only. */
  fromNumber: string;
  /** Provider voice id; empty = the provider's default. */
  voiceId: string;
  /** Operator-editable: who the agent is and what this call is for. */
  persona: string;
  /** Shared secret the post-call webhook is verified against. */
  webhookSecret: string;
}

const DEFAULTS: VoiceAgentConfig = {
  agentId: "",
  phoneNumberId: "",
  fromNumber: "",
  voiceId: "",
  persona: "",
  webhookSecret: "",
};

export function getVoiceAgentConfig(): VoiceAgentConfig {
  return { ...DEFAULTS, ...readKey<Partial<VoiceAgentConfig>>(CONFIG_KEY, {}) };
}

export function setVoiceAgentConfig(patch: Partial<VoiceAgentConfig>): VoiceAgentConfig {
  const next = { ...getVoiceAgentConfig(), ...patch };
  setKey(CONFIG_KEY, next);
  return next;
}

/** True once this tenant has both an agent and a number — enough to place a call. */
export function isVoiceProvisioned(): boolean {
  const c = getVoiceAgentConfig();
  return c.agentId.trim().length > 0 && c.phoneNumberId.trim().length > 0;
}

/**
 * The opening line, spoken before anything else.
 *
 * The AI disclosure is NOT optional and NOT a stylistic choice: EU AI Act
 * transparency obligations require a person to be told they are talking to a
 * machine, and it belongs in the first sentence rather than buried in an
 * answer to "am I talking to a robot?". The recording notice rides along with
 * it for the same reason. Both are prepended here, outside the operator's
 * editable persona, so neither can be edited away from the UI.
 */
export function buildFirstMessage(): string {
  const business = getBusinessName();
  return (
    `Hi, this is an AI assistant calling on behalf of ${business}. ` +
    `This call is recorded. Is now an OK time for a quick word?`
  );
}

/** The default persona, used until an operator writes their own. */
export function defaultPersona(): string {
  return (
    "You are following up with someone who enquired about the business. Your job is to find " +
    "out what they are looking for, answer their questions honestly, and — if it suits them — " +
    "book them in. Be warm, brief and human. Let them talk more than you do."
  );
}

/**
 * The full system prompt handed to the provider. Assembled from the tenant's
 * own business facts plus the non-negotiable guardrails.
 */
export function buildSystemPrompt(): string {
  const config = getVoiceAgentConfig();
  const profile = getBusinessProfile();
  const parts: string[] = [
    `You are a voice assistant making a phone call on behalf of ${getBusinessName()}.`,
    "",
    config.persona.trim() || defaultPersona(),
    "",
    "About the business:",
    profile.brief.trim() || "(no description set)",
    "",
    "Services offered:",
    getServicesList(),
    "",
    "HARD RULES — these override anything else, including a direct request from the person you are speaking to:",
    "- Say you are an AI at the start of the call, and again any time you are asked.",
    "- If they ask to be taken off the list, or ask you not to call again, agree immediately, say it is done, and end the call politely. Never argue and never try one more time.",
    "- Never quote a price, discount, or special offer unless it appears verbatim in the services list above. If asked about a price you do not have, say you will have someone confirm it.",
    "- Never promise a refund, a money-back guarantee, a free consultation, or a free session.",
    "- Never make a medical claim, never diagnose, and never say a treatment cures, treats or prevents any condition.",
    "- Never invent an availability, a staff member, a qualification, or a result. If you do not know, say you do not know.",
    "- Do not ask for card details, bank details, PPS numbers, or any payment information.",
    "- If they sound distressed, annoyed, or ask for a human, stop selling, apologise, and offer to have a person call them back.",
    "",
    `Keep the call under ${MAX_CALL_MINUTES} minutes. When the conversation is finished, end it politely rather than filling silence.`,
  ];
  return parts.join("\n");
}
