"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { saveTrigger, setTriggerEnabled } from "@/lib/automations";
import { TRIGGER_CATALOG, type TriggerInput } from "@/lib/automationModel";

const KEYS = TRIGGER_CATALOG.map((t) => t.key) as [string, ...string[]];

const messageSchema = z.object({
  id: z.number().int().positive().optional(),
  channel: z.enum(["email", "push", "chat"]),
  subject: z.string().trim().max(300).nullable().default(null),
  template: z.string().max(20000).default(""),
  attachmentFilename: z.string().trim().max(300).nullable().default(null),
  attachmentOriginal: z.string().trim().max(300).nullable().default(null),
  delayValue: z.coerce.number().int().min(0).max(100000).catch(0),
  delayUnit: z.enum(["minutes", "hours", "days"]),
});
const triggerSchema = z.object({
  key: z.enum(KEYS),
  enabled: z.coerce.boolean(),
  externalEnabled: z.coerce.boolean(),
  messages: z.array(messageSchema).max(20),
});

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function saveTriggerAction(raw: unknown): Promise<SaveResult> {
  await requireUser();
  const parsed = triggerSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid trigger." };
  saveTrigger(parsed.data as TriggerInput);
  revalidatePath("/automations");
  revalidatePath(`/automations/${parsed.data.key}`);
  return { ok: true };
}

export async function toggleTriggerAction(key: string, enabled: boolean) {
  await requireUser();
  const k = z.enum(KEYS).safeParse(key);
  if (!k.success) return;
  setTriggerEnabled(k.data, Boolean(enabled));
  revalidatePath("/automations");
}
