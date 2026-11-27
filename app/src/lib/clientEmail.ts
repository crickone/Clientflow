import "server-only";

import { desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientEmails, clients } from "@/lib/db/schema";
import {
  renderEmailShell,
  sendEmail,
  textToParagraphs,
} from "@/lib/email";
import { getBusinessProfile } from "@/lib/businessProfile";
import { getTheme } from "@/lib/settings";
import type { OutgoingFile } from "@/lib/attachments/outgoingModel";
import { emailAttachmentsFrom, emailAttachmentsRefusal } from "@/lib/email/attachments";
import { setSentEmailMedia } from "@/lib/email/sentMedia";

export type ClientEmailRow = {
  id: number;
  clientId: number;
  toEmail: string;
  subject: string;
  body: string;
  status: "sent" | "failed";
  error: string | null;
  /** Files sent with the email: raw JSON MessageMedia[] (lib/inbox/mediaModel parseMedia), null when none. */
  media: string | null;
  createdAt: number;
};

export type SendClientEmailResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Send a one-to-one email to a client and log it. `body` is plain text typed by
 * staff; it's wrapped in the tenant's branded shell. All sends (success OR
 * failure) are recorded in client_emails so the thread is auditable.
 * `attachments` go with the email and are noted on the row (`media`); the
 * body may be empty when there are files. A set over the email limits is
 * refused before anything is sent or recorded.
 */
export async function sendClientEmail(
  clientId: number,
  input: { subject: string; body: string; sentByUserId?: number; attachments?: OutgoingFile[] },
): Promise<SendClientEmailResult> {
  const client = db
    .select({
      firstName: clients.firstName,
      lastName: clients.lastName,
      email: clients.email,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
    .get();
  if (!client) return { ok: false, error: "Client not found." };
  if (!client.email) return { ok: false, error: "This client has no email address on file." };

  const subject = input.subject.trim();
  const body = input.body.trim();
  const files = input.attachments ?? [];
  if (!subject) return { ok: false, error: "Subject is required." };
  if (!body && files.length === 0) return { ok: false, error: "Message is required." };
  const attachments = emailAttachmentsFrom(files);
  const refusal = emailAttachmentsRefusal(attachments);
  if (refusal) return { ok: false, error: refusal };
  const media = files.map((f) => f.media);

  const business = getBusinessProfile().businessName;
  const html = renderEmailShell({
    businessName: business,
    accent: getTheme().accent,
    bodyHtml: textToParagraphs(body),
    footer: `Sent by ${business}. Reply to this email to reach us.`,
  });

  const res = await sendEmail({
    to: client.email,
    subject,
    html,
    text: body,
    ...(attachments.length ? { attachments } : {}),
  });

  db.insert(clientEmails)
    .values({
      clientId,
      toEmail: client.email,
      subject,
      body,
      status: res.ok ? "sent" : "failed",
      providerId: res.ok ? res.id : null,
      error: res.ok ? null : res.error,
      media: media.length ? JSON.stringify(media) : null,
      sentByUserId: input.sentByUserId ?? null,
    })
    .run();
  if (res.ok) setSentEmailMedia(res.id, media);

  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/** Sent-email history for one client, newest first. */
export function listClientEmails(clientId: number): ClientEmailRow[] {
  return db
    .select({
      id: clientEmails.id,
      clientId: clientEmails.clientId,
      toEmail: clientEmails.toEmail,
      subject: clientEmails.subject,
      body: clientEmails.body,
      status: clientEmails.status,
      error: clientEmails.error,
      media: clientEmails.media,
      createdAt: clientEmails.createdAt,
    })
    .from(clientEmails)
    .where(eq(clientEmails.clientId, clientId))
    .orderBy(desc(clientEmails.createdAt))
    .all()
    .map((r) => ({ ...r, createdAt: r.createdAt.getTime() }));
}

export type RecentClientEmail = ClientEmailRow & {
  clientName: string;
};

/** Recent sent emails across the tenant, joined to client name (Communication tab). */
export function listRecentClientEmails(limit = 50): RecentClientEmail[] {
  return db
    .select({
      id: clientEmails.id,
      clientId: clientEmails.clientId,
      toEmail: clientEmails.toEmail,
      subject: clientEmails.subject,
      body: clientEmails.body,
      status: clientEmails.status,
      error: clientEmails.error,
      media: clientEmails.media,
      createdAt: clientEmails.createdAt,
      firstName: clients.firstName,
      lastName: clients.lastName,
    })
    .from(clientEmails)
    .innerJoin(clients, eq(clients.id, clientEmails.clientId))
    .orderBy(desc(clientEmails.createdAt))
    .limit(limit)
    .all()
    .map((r) => ({
      id: r.id,
      clientId: r.clientId,
      toEmail: r.toEmail,
      subject: r.subject,
      body: r.body,
      status: r.status,
      error: r.error,
      media: r.media,
      createdAt: r.createdAt.getTime(),
      clientName: `${r.firstName} ${r.lastName}`.trim(),
    }));
}
