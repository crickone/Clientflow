"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { handleRequest } from "@/lib/cancellations";

/** Staff close a member's cancellation notice: end the membership, or keep it. */
export async function handleCancelAction(clientId: number, requestId: number, outcome: "ended" | "kept"): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  if (outcome !== "ended" && outcome !== "kept") return { ok: false, error: "Pick end or keep." };
  if (!handleRequest(Number(clientId), Number(requestId), outcome)) return { ok: false, error: "That notice is already closed." };
  revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}
