"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import {
  getEmailSender,
  hasEmailApiKey,
  sendEmail,
  setEmailSender,
  renderEmailShell,
  type EmailSender,
} from "@/lib/email";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getTheme } from "@/lib/settings";

const schema = z.object({
  fromName: z.string().trim().min(1, "Sender name is required").max(120),
  fromEmail: z.string().trim().toLowerCase().email("Enter a valid email address"),
  replyTo: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid reply-to address")
    .or(z.literal("")),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function saveEmailSenderAction(input: EmailSender): Promise<ActionResult> {
  await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid" };
  }
  setEmailSender({
    fromName: parsed.data.fromName,
    fromEmail: parsed.data.fromEmail,
    replyTo: parsed.data.replyTo,
  });
  revalidatePath("/settings/email");
  return { ok: true };
}

/** Send a test email to a chosen address to verify domain + key are working. */
export async function sendTestEmailAction(to: string): Promise<ActionResult> {
  await requireAdmin();
  const addr = z.string().trim().toLowerCase().email().safeParse(to);
  if (!addr.success) return { ok: false, error: "Enter a valid email address" };
  if (!hasEmailApiKey()) {
    return { ok: false, error: "Missing RESEND_API_KEY on the server." };
  }
  const sender = getEmailSender();
  if (!sender.fromEmail) return { ok: false, error: "Save a sender address first." };

  const business = getBusinessProfile().businessName;
  const html = renderEmailShell({
    businessName: business,
    accent: getTheme().accent,
    heading: "Test email",
    bodyHtml: `<p style="margin:0 0 14px;">This is a test email from <strong>${business}</strong> to confirm your email sending is set up correctly.</p><p style="margin:0;">If you received this, replies will go to <strong>${sender.replyTo || sender.fromEmail}</strong>.</p>`,
    footer: "Sent from AdonisAgent to verify your email configuration.",
  });
  const res = await sendEmail({ to: addr.data, subject: `Test email from ${business}`, html });
  if (!res.ok) return res;
  return { ok: true };
}
