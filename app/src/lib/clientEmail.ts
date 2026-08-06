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

export type ClientEmailRow = {
  id: number;
  clientId: number;
  toEmail: string;
  subject: string;
  body: string;
  status: "sent" | "failed";
  error: string | null;
  createdAt: number;
};

export type SendClientEmailResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Send a one-to-one email to a client and log it. `body` is plain text typed by
 * staff; it's wrapped in the tenant's branded shell. All sends (success OR
 * failure) are recorded in client_emails so the thread is auditable.
 */
export async function sendClientEmail(
  clientId: number,
  input: { subject: string; body: string; sentByUserId?: number },
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
  if (!subject) return { ok: false, error: "Subject is required." };
  if (!body) return { ok: false, error: "Message is required." };

  const business = getBusinessProfile().businessName;
  const html = renderEmailShell({
    businessName: business,
    accent: getTheme().accent,
    bodyHtml: textToParagraphs(body),
    footer: `Sent by ${business}. Reply to this email to reach us.`,
  });

  const res = await sendEmail({ to: client.email, subject, html, text: body });

  db.insert(clientEmails)
    .values({
      clientId,
      toEmail: client.email,
      subject,
      body,
      status: res.ok ? "sent" : "failed",
      providerId: res.ok ? res.id : null,
      error: res.ok ? null : res.error,
      sentByUserId: input.sentByUserId ?? null,
    })
    .run();

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
      createdAt: r.createdAt.getTime(),
      clientName: `${r.firstName} ${r.lastName}`.trim(),
    }));
}
