"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";
import { bust } from "@/lib/revalidate";
import type { PlatformFlag } from "@/lib/types";

export async function setFlagAction(flag: PlatformFlag): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api("/flags", { method: "PUT", body: { flag } });
    bust();
    revalidatePath("/flags");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Could not save that rollout." };
  }
}
