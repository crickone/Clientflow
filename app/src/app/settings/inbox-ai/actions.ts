"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { setInboxAiSettings, type InboxAiSettings } from "@/lib/inbox/settings";
import { promoteTag, deleteTag, addCoreTag } from "@/lib/inbox/tags";

export async function updateInboxAiSettings(s: InboxAiSettings) {
  await requireAdmin();
  const categories = (s.autoReplyCategories ?? []).filter(
    (c) => c === "faq" || c === "new_lead",
  );
  const threshold = Math.max(
    0,
    Math.min(1, Number(s.autoReplyConfidenceThreshold) || 0.8),
  );
  setInboxAiSettings({
    autoReplyEnabled: !!s.autoReplyEnabled,
    autoReplyCategories: categories,
    autoReplyConfidenceThreshold: threshold,
  });
  revalidatePath("/settings/inbox-ai");
  return { ok: true as const };
}

export async function promoteTagAction(id: number) {
  await requireAdmin();
  promoteTag(id);
  revalidatePath("/settings/inbox-ai");
  return { ok: true as const };
}

export async function deleteTagAction(id: number) {
  await requireAdmin();
  deleteTag(id);
  revalidatePath("/settings/inbox-ai");
  return { ok: true as const };
}

export async function addCoreTagAction(label: string) {
  await requireAdmin();
  addCoreTag(label);
  revalidatePath("/settings/inbox-ai");
  return { ok: true as const };
}
