"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";
import { bust } from "@/lib/revalidate";

export type AlertOpBody =
  | { id: number; op: "ack" | "unack" }
  | { id: number; op: "snooze"; until: number }
  | { id: number; op: "assign"; userId: number | null };

export async function alertAction(body: AlertOpBody): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api("/alerts", { method: "POST", body });
    bust();
    revalidatePath("/inbox");
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "That did not work." };
  }
}
