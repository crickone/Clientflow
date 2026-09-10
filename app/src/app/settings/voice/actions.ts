"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import {
  buildFirstMessage,
  buildSystemPrompt,
  getVoiceAgentConfig,
  setVoiceAgentConfig,
} from "@/lib/voice/config";
import { createAgent, updateAgent, voiceConfigured } from "@/lib/voice/elevenlabs";
import { MAX_CALL_MINUTES } from "@/lib/voice/usage";
import { isAddonEnabled } from "@/lib/billing/addons";

const schema = z.object({
  persona: z.string().max(4000),
  phoneNumberId: z.string().max(200),
  fromNumber: z.string().max(40),
  voiceId: z.string().max(200),
});

/** Save the operator-editable half of the agent's configuration. Does not talk to the provider. */
export async function saveVoiceSettingsAction(
  input: z.infer<typeof schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  setVoiceAgentConfig(parsed.data);
  revalidatePath("/settings/voice");
  return { ok: true };
}

/**
 * Push this tenant's agent to the provider — creating it on first run, updating
 * it after. The prompt and opening line are BUILT from the business profile and
 * the guardrails (lib/voice/config.ts), never stored, so every provision picks
 * up the current facts rather than re-uploading a stale copy.
 *
 * Gated on the add-on being enabled: an account without voice must not be able
 * to create provider resources that would then sit there billable.
 */
export async function provisionVoiceAgentAction(): Promise<
  { ok: true; agentId: string } | { ok: false; error: string }
> {
  await requireAdmin();
  if (!voiceConfigured()) {
    return { ok: false, error: "Voice calling isn't configured on this deployment yet." };
  }
  const tenant = getCurrentTenant();
  if (!isAddonEnabled(tenant.id, "voice")) {
    return { ok: false, error: "The Voice Agent add-on isn't enabled for this account." };
  }

  const config = getVoiceAgentConfig();
  const input = {
    name: `${tenant.name} — sales agent`,
    prompt: buildSystemPrompt(),
    firstMessage: buildFirstMessage(),
    voiceId: config.voiceId || undefined,
    maxDurationSeconds: MAX_CALL_MINUTES * 60,
  };

  const res = config.agentId
    ? await updateAgent(config.agentId, input)
    : await createAgent(input);
  if (!res.ok) {
    return { ok: false, error: `The provider rejected the agent: ${res.error}` };
  }

  const agentId = res.data.agent_id || config.agentId;
  setVoiceAgentConfig({ agentId });
  revalidatePath("/settings/voice");
  return { ok: true, agentId };
}
