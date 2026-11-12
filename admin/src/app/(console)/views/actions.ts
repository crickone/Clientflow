"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";
import type { ConsoleView } from "@/lib/views";

type Result = { ok: true } | { ok: false; error: string };

export async function saveViewAction(name: string, href: string): Promise<Result> {
  try {
    const { views } = await api<{ views: ConsoleView[] }>("/views");
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await api("/views", { method: "PUT", body: { views: [...views, { id, name, href }] } });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Could not save that view." };
  }
}

export async function deleteViewAction(id: string): Promise<Result> {
  try {
    const { views } = await api<{ views: ConsoleView[] }>("/views");
    await api("/views", { method: "PUT", body: { views: views.filter((v) => v.id !== id) } });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Could not remove that view." };
  }
}
