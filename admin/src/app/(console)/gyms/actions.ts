"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";

export type FleetActionResult = { ok: true; note: string } | { ok: false; error: string };

/** Stop or restart one capability for every business. Owner-only in the API. */
export async function setKillSwitchAction(
  key: "ai" | "email" | "posting",
  stopped: boolean,
  reason: string,
): Promise<FleetActionResult> {
  try {
    const res = await api<{ ok: true; note: string }>("/fleet", {
      method: "POST",
      body: { key, stopped, reason },
    });
    revalidatePath("/gyms");
    revalidatePath("/");
    return { ok: true, note: res.note };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "That did not work." };
  }
}
