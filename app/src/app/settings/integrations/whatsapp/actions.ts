"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import {
  getWhatsAppConfig,
  setWhatsAppConfig,
} from "@/lib/whatsapp/config";

export async function updateWhatsAppConfig(input: {
  token: string;
  channel: string;
  baseUrl: string;
}) {
  await requireAdmin();
  const current = getWhatsAppConfig();
  setWhatsAppConfig({
    provider: "whapi",
    token: input.token.trim(),
    channel: input.channel.trim(),
    baseUrl: input.baseUrl.trim(),
    // Generate a webhook secret once; keep it stable across saves.
    webhookSecret:
      current.webhookSecret || crypto.randomBytes(24).toString("hex"),
  });
  revalidatePath("/settings/integrations/whatsapp");
  return { ok: true as const };
}
