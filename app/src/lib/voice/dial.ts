import "server-only";

import { getCurrentTenant, getCurrentTenantDb } from "@/lib/db/tenant";
import { getLead } from "@/lib/leads";
import { toE164 } from "@/lib/whatsapp/phone";
import { getVoiceAgentConfig, isVoiceProvisioned } from "./config";
import { createCall, linkProviderCall, markCallFailed, type VoiceCallRow } from "./calls";
import { outboundCall, voiceConfigured } from "./elevenlabs";
import { assertVoiceAllowed, MAX_CALL_MINUTES } from "./usage";
import { getCallFlow, isWithinWindow } from "./flow";

/**
 * The ONE place in this application that can cause a phone to ring.
 *
 * Everything that must be true before a real person is dialled is checked
 * here, in order, and every one of them is a refusal rather than a warning:
 *
 *   1. the provider is configured at all       (voiceConfigured)
 *   2. THIS tenant has an agent and a number   (isVoiceProvisioned)
 *   3. the tenant is entitled, not suspended, under its spend cap, and has
 *      an allowance or credits left            (assertVoiceAllowed)
 *   4. we hold a dialable E.164 number           (toE164)
 *   5. the person has not opted out            (see the note below)
 *
 * Concentrating them here is the point: a future autonomous dialler, a batch
 * campaign and the operator's "Call" button all go through this function, so
 * none of them can acquire its own subtly-different idea of who may be called.
 *
 * Returns a typed result and NEVER throws — a dialler loop that throws is a
 * retry storm aimed at a real person's phone.
 *
 * The calling WINDOW applies to automated calls only (`startedBy === 'system'`)
 * and is checked here as well as in the dialler loop — belt and braces, since
 * this is the function that can actually make the phone ring. An operator
 * pressing Call at 20:30 to return a missed call is exercising judgement about
 * one person in front of them, which is a different thing from a machine
 * working a list unattended; blocking that would just push them to their own
 * mobile, where nothing is recorded.
 *
 * Still NOT enforced here, and named so it can't be forgotten: National
 * Directory Database opt-out screening for numbers not sourced from an inbound
 * enquiry. When that arrives it belongs in THIS function, not beside it.
 */

export type DialResult =
  | { ok: true; call: VoiceCallRow; providerCallId: string }
  | { ok: false; error: string; call?: VoiceCallRow };

export interface DialLeadInput {
  leadId: number;
  /** 'user:<id>' for an operator-initiated call, 'system' for an automated one. */
  startedBy: string;
}

/** Human-readable reason a dial was refused, from any of the gates above. */
function refuse(error: string): DialResult {
  return { ok: false, error };
}

/**
 * Everything in the gate that does NOT depend on which lead is being called:
 * provider configured, tenant provisioned, entitled, not suspended, under cap,
 * with something left to spend.
 *
 * Split out so the UI can ask "can this account call at all?" — to hide or
 * explain a disabled Call button — WITHOUT reimplementing the checks and
 * drifting from what `dialLead` actually enforces. `dialLead` calls it too, so
 * there is exactly one copy of these rules.
 */
export function voiceAvailability(): { available: boolean; reason: string | null } {
  if (!voiceConfigured()) {
    return { available: false, reason: "Voice calling isn't configured on this deployment yet." };
  }
  if (!isVoiceProvisioned()) {
    return {
      available: false,
      reason: "This account has no voice agent set up yet — connect an agent and a phone number first.",
    };
  }
  try {
    assertVoiceAllowed(getCurrentTenant().id);
  } catch (err) {
    return {
      available: false,
      reason: err instanceof Error ? err.message : "Voice calling isn't available for this account.",
    };
  }
  return { available: true, reason: null };
}

export async function dialLead(input: DialLeadInput): Promise<DialResult> {
  // The money/entitlement gates. `assertVoiceAllowed` inside throws typed
  // errors carrying operator-facing copy; voiceAvailability turns them into a
  // refusal, so a caller can never dial past them by forgetting a try/catch.
  const availability = voiceAvailability();
  if (!availability.available) return refuse(availability.reason!);

  const tenant = getCurrentTenant();
  const lead = getLead(input.leadId);
  if (!lead) return refuse("That lead no longer exists.");

  // E.164 WITH the '+' — what Twilio and the provider require. The bare-digit
  // `normalizePhone` used everywhere else in the app is rejected by them.
  const toNumber = toE164(lead.phone);
  if (!toNumber) {
    return refuse("This lead has no usable phone number.");
  }
  if (lead.doNotCall) {
    return refuse("This lead has asked not to be contacted.");
  }

  const automated = input.startedBy === "system";
  if (automated && !isWithinWindow(new Date(), getCallFlow())) {
    return refuse("Outside the calling hours set for this account.");
  }

  const tdb = getCurrentTenantDb();
  const config = getVoiceAgentConfig();

  // The row is written BEFORE the dial, so a call that fails to place — or
  // succeeds and then loses its webhook — is still visible instead of vanishing.
  const call = createCall(tdb, { leadId: lead.id, toNumber, startedBy: input.startedBy });

  const res = await outboundCall({
    agentId: config.agentId,
    phoneNumberId: config.phoneNumberId,
    toNumber,
    variables: {
      lead_name: [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || "there",
      lead_interest: lead.therapyInterest ?? "",
      lead_source: lead.source ?? "",
      max_minutes: String(MAX_CALL_MINUTES),
    },
  });

  if (!res.ok) {
    markCallFailed(tdb, call.id, res.error);
    return { ok: false, error: friendlyProviderError(res.error), call };
  }

  const providerCallId = res.data.conversation_id ?? "";
  if (!providerCallId) {
    // The provider accepted the request but told us nothing we can key the
    // post-call webhook by. The call may well happen, but we could never
    // attribute, meter or record its outcome — so it's a failure, loudly.
    markCallFailed(tdb, call.id, "Provider returned no conversation id");
    return { ok: false, error: "The call couldn't be tracked, so it wasn't started. Nothing was charged.", call };
  }

  linkProviderCall(tdb, tenant.id, call.id, providerCallId);
  return { ok: true, call: { ...call, providerCallId }, providerCallId };
}

/** Provider error text is for the log; an operator gets something they can act on. */
function friendlyProviderError(raw: string): string {
  if (raw === "not_configured") return "Voice calling isn't configured on this deployment yet.";
  if (/timeout|aborted/i.test(raw)) return "The call provider didn't respond in time. Nothing was charged.";
  return `The call couldn't be placed: ${raw.slice(0, 200)}`;
}
