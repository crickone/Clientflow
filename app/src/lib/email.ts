import "server-only";

import { Resend } from "resend";

import { readKey, readKeyForTenant, setKey } from "@/lib/settings";
import { getBusinessProfile, getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getCurrentTenant } from "@/lib/db/tenant";
import { getGmailConnection, gmailSend, isGmailConnected } from "@/lib/gmail";
import { isImapConnected, smtpSend } from "@/lib/imapEmail";

/**
 * Email sending via Resend. Two moving parts:
 *  1. A GLOBAL API key (`RESEND_API_KEY`, one Resend account for the platform).
 *  2. A PER-TENANT sender identity (stored in the tenant's settings) — the
 *     from-name + from-address on the tenant's OWN verified domain, so Inspire
 *     mails come from inspirehealthandfitness.ie and Renova from its own domain.
 *     The address's domain must be verified in Resend before delivery works.
 */

export interface EmailSender {
  /** Display name recipients see, e.g. "Inspire Health & Fitness". */
  fromName: string;
  /** Sending address on a Resend-verified domain, e.g. hello@inspirehealthandfitness.ie. */
  fromEmail: string;
  /** Where replies go. Defaults to fromEmail when blank. */
  replyTo: string;
}

const SENDER_KEY = "email_sender";

/** The tenant's configured sender, with sensible defaults from its business profile. */
export function getEmailSender(): EmailSender {
  const profile = getBusinessProfile();
  const stored = readKey<Partial<EmailSender>>(SENDER_KEY, {});
  return {
    fromName: (stored.fromName ?? "").trim() || profile.businessName,
    fromEmail: (stored.fromEmail ?? "").trim().toLowerCase(),
    replyTo: (stored.replyTo ?? "").trim().toLowerCase(),
  };
}

/** Sender for an explicit tenant (background jobs). */
export function getEmailSenderForTenant(tenantId: number): EmailSender {
  const profile = getBusinessProfileForTenant(tenantId);
  const stored = readKeyForTenant<Partial<EmailSender>>(tenantId, SENDER_KEY, {});
  return {
    fromName: (stored.fromName ?? "").trim() || profile.businessName,
    fromEmail: (stored.fromEmail ?? "").trim().toLowerCase(),
    replyTo: (stored.replyTo ?? "").trim().toLowerCase(),
  };
}

export function setEmailSender(sender: EmailSender): void {
  setKey(SENDER_KEY, {
    fromName: sender.fromName.trim(),
    fromEmail: sender.fromEmail.trim().toLowerCase(),
    replyTo: sender.replyTo.trim().toLowerCase(),
  });
}

/** Is the platform key present? (Distinct from whether a tenant configured a sender.) */
export function hasEmailApiKey(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export type EmailProvider = "gmail" | "imap" | "resend" | "none";

/** Which provider the CURRENT tenant will actually send through. Gmail wins, then IMAP/SMTP, then Resend. */
export function getEmailProvider(): EmailProvider {
  try {
    if (isGmailConnected(getCurrentTenant().id)) return "gmail";
  } catch {
    // no tenant context — fall through
  }
  try {
    if (isImapConnected(getCurrentTenant().id)) return "imap";
  } catch {
    // no tenant context — fall through
  }
  if (hasEmailApiKey() && getEmailSender().fromEmail) return "resend";
  return "none";
}

/** Fully ready to send for the CURRENT tenant (Gmail, IMAP/SMTP, or Resend set up). */
export function isEmailConfigured(): boolean {
  return getEmailProvider() !== "none";
}

export type SendResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

/**
 * Send one email using the current tenant's sender identity. Never throws —
 * returns a typed result so callers can surface a clean message.
 */
export type SendOpts = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Overrides the tenant's default reply-to for this send. */
  replyTo?: string;
  /** Gmail threading, when replying inside an existing conversation. */
  gmailThread?: { threadId?: string; inReplyTo?: string; references?: string };
};

/** Core send: Gmail if the tenant has it connected, else IMAP/SMTP if connected, else Resend. */
async function sendVia(tenantId: number | null, sender: EmailSender, opts: SendOpts): Promise<SendResult> {
  if (tenantId !== null && isGmailConnected(tenantId)) {
    const conn = getGmailConnection(tenantId);
    if (conn) {
      const res = await gmailSend(tenantId, {
        fromName: sanitizeName(sender.fromName),
        fromEmail: conn.email,
        to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
        subject: opts.subject,
        html: opts.html,
        threadId: opts.gmailThread?.threadId,
        inReplyTo: opts.gmailThread?.inReplyTo,
        references: opts.gmailThread?.references,
      });
      return res.ok ? { ok: true, id: res.id } : { ok: false, error: res.error };
    }
  }

  if (tenantId !== null && isImapConnected(tenantId)) {
    return smtpSend(tenantId, {
      fromName: sanitizeName(sender.fromName),
      to: Array.isArray(opts.to) ? opts.to.join(", ") : opts.to,
      subject: opts.subject, html: opts.html, text: opts.text,
      replyTo: opts.replyTo || sender.replyTo || undefined,
      inReplyTo: opts.gmailThread?.inReplyTo,
      references: opts.gmailThread?.references,
    });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Email isn't set up yet — connect Gmail or add a Resend API key." };
  }
  if (!sender.fromEmail) {
    return { ok: false, error: "No sender address configured. Connect Gmail or set one in Settings → Email." };
  }
  const from = `${sanitizeName(sender.fromName)} <${sender.fromEmail}>`;
  const replyTo = opts.replyTo || sender.replyTo || sender.fromEmail;
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? htmlToText(opts.html),
      replyTo,
    });
    if (error) return { ok: false, error: error.message || "Resend rejected the message." };
    return { ok: true, id: data?.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to send email." };
  }
}

/**
 * Send using the CURRENT (request-scoped) tenant's sender. Never throws.
 */
export async function sendEmail(opts: SendOpts): Promise<SendResult> {
  let tenantId: number | null = null;
  try {
    tenantId = getCurrentTenant().id;
  } catch {
    tenantId = null;
  }
  return sendVia(tenantId, getEmailSender(), opts);
}

/**
 * Send for an EXPLICIT tenant — used by background jobs (schedulers) that have
 * no request/cookie context.
 */
export async function sendEmailForTenant(tenantId: number, opts: SendOpts): Promise<SendResult> {
  return sendVia(tenantId, getEmailSenderForTenant(tenantId), opts);
}

/**
 * Send a PLATFORM email — one that's about the AdonisAgent account itself (staff
 * invites, team/account notices), NOT a business→customer email. Always sends
 * from AdonisAgent's OWN already-verified domain (clientflow.ie) via Resend, so
 * it works for every tenant regardless of whether that tenant has connected its
 * own email provider. Business→customer mail must keep using sendEmail /
 * sendEmailForTenant (the tenant's own branded sender). Never throws.
 *
 * The default from-address relies on clientflow.ie being verified in Resend
 * (the same domain billing emails already send from); override with
 * PLATFORM_EMAIL_FROM if that ever changes.
 */
export async function sendPlatformEmail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  /** Display name recipients see, e.g. "Optimal Health via AdonisAgent". */
  fromName?: string;
  /** Where replies go (e.g. the business's own email). Omitted when blank. */
  replyTo?: string;
}): Promise<SendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Platform email isn't configured (missing RESEND_API_KEY)." };
  }
  const fromEmail = process.env.PLATFORM_EMAIL_FROM || "no-reply@clientflow.ie";
  const from = `${sanitizeName(opts.fromName || "AdonisAgent")} <${fromEmail}>`;
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text ?? htmlToText(opts.html),
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
    });
    if (error) return { ok: false, error: error.message || "Resend rejected the message." };
    return { ok: true, id: data?.id ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Failed to send email." };
  }
}

/** Strip characters that would break the `Name <addr>` from header. */
function sanitizeName(name: string): string {
  return name.replace(/["<>\r\n]/g, "").trim() || "AdonisAgent";
}

/** Very small HTML→text fallback for the plaintext part. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>(?=)/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Wrap body content in a minimal, on-brand HTML shell. `accent` + `businessName`
 * come from the tenant so invite/notice/client emails all look consistent.
 */
export function renderEmailShell(opts: {
  businessName: string;
  accent?: string;
  heading?: string;
  bodyHtml: string;
  footer?: string;
}): string {
  const accent = opts.accent || "#c9a24c";
  const heading = opts.heading
    ? `<h1 style="margin:0 0 16px;font-size:20px;font-weight:700;color:#111827;">${escapeHtml(opts.heading)}</h1>`
    : "";
  const footer =
    opts.footer ??
    `You received this email from ${escapeHtml(opts.businessName)}.`;
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
    <tr><td style="height:4px;background:${accent};"></td></tr>
    <tr><td style="padding:32px 32px 28px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:.02em;color:${accent};text-transform:uppercase;margin-bottom:20px;">${escapeHtml(opts.businessName)}</div>
      ${heading}
      <div style="font-size:15px;line-height:1.6;color:#374151;">${opts.bodyHtml}</div>
    </td></tr>
    <tr><td style="padding:0 32px 28px;">
      <div style="border-top:1px solid #e5e7eb;padding-top:16px;font-size:12px;color:#9ca3af;line-height:1.5;">${footer}</div>
    </td></tr>
  </table>
</body></html>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Turn plain user-typed text into safe paragraph HTML (preserves line breaks). */
export function textToParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 14px;">${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
}
