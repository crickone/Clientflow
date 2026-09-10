"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { normalizeFlow, setCallFlow, type CallFlowConfig } from "@/lib/voice/flow";

/**
 * Save the call flow. Everything is clamped by `normalizeFlow` (in the model,
 * not here) so a hand-crafted request can't set a 500-attempt retry ladder or
 * a window that never closes.
 *
 * Admin-only: this decides when the account phones real people, unattended.
 */
export async function saveCallFlowAction(
  input: Partial<CallFlowConfig>,
): Promise<{ ok: true; flow: CallFlowConfig } | { ok: false; error: string }> {
  await requireAdmin();
  try {
    const flow = setCallFlow(normalizeFlow(input));
    revalidatePath("/settings/voice/flow");
    revalidatePath("/settings/voice");
    return { ok: true, flow };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save the call flow." };
  }
}
