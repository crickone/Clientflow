"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { requireAdmin } from "@/lib/auth";
import { getCurrentTenant } from "@/lib/db/tenant";
import { WhapiBridge } from "@/lib/whatsapp/whapi";
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

/**
 * Move the webhook secret out of the address and into a header Whapi sends
 * (set through Whapi's API), then refuse a secret in the address from now on.
 * Admin-only. The flag is only set once Whapi confirms the header is in
 * place, so a failure leaves inbound WhatsApp working as it was.
 */
export async function moveWhatsAppSecretToHeader(): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const cfg = getWhatsAppConfig();
  if (!cfg.token || !cfg.webhookSecret) return { ok: false, error: "Save the WhatsApp settings first." };
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  if (!host || host.startsWith("localhost")) return { ok: false, error: "This only works on the live app address." };
  const webhookUrl = `https://${host}/api/whatsapp/webhook?${new URLSearchParams({ t: getCurrentTenant().slug }).toString()}`;
  try {
    await new WhapiBridge({ token: cfg.token, baseUrl: cfg.baseUrl, webhookSecret: cfg.webhookSecret }).moveSecretToHeader(webhookUrl);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "WhatsApp did not accept the change." };
  }
  setWhatsAppConfig({ webhookHeaderMode: true });
  revalidatePath("/settings/integrations/whatsapp");
  return { ok: true };
}
