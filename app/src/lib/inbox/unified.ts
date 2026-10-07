import "server-only";

import { desc, isNotNull, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { emailMessages } from "@/lib/db/schema";
import { listConversations, type ConvTag } from "@/lib/conversations";
import { listRecentClientEmails } from "@/lib/clientEmail";
import { classifyEmail, cleanSnippet, decodeEntities, displaySender, type InboxBucket } from "./emailDisplay";

/**
 * One list for the whole inbox: email threads (two-way when Gmail/IMAP is
 * connected, else the sent log) and WhatsApp / Messenger / Instagram
 * conversations, newest first. Bodies stay on the server; the reading pane
 * loads a thread when it is opened.
 */

export type InboxChannel = "email" | "whatsapp" | "messenger" | "instagram";

export type InboxItem = {
  /** "email:<thread>", "conv:<kind>-<id>" or "sent:<id>". */
  key: string;
  type: "email" | "conversation" | "sent";
  channel: InboxChannel;
  name: string;
  address: string | null;
  subject: string | null;
  snippet: string;
  at: number;
  unread: boolean;
  needsReply: boolean;
  bucket: InboxBucket;
  /** The latest message is ours. */
  outbound: boolean;
  messageCount: number;
  threadId: string | null;
  /** A member or lead this person matches, for the row chip and context card. */
  contact: { type: "client" | "lead"; id: number } | null;
  conv: {
    kind: "lead" | "client";
    contactId: number;
    href: string;
    aiCategory: string | null;
    aiPriority: "high" | "normal" | "low" | null;
    tags: ConvTag[];
  } | null;
  failed?: boolean;
  /** Sent-log entries only: the full text we sent. */
  body?: string;
};

export type EmailMode = "two-way" | "sent-log";

/** Lowercased email → member / lead, for matching senders. Members win. */
function contactIndex(): Map<string, { type: "client" | "lead"; id: number }> {
  const map = new Map<string, { type: "client" | "lead"; id: number }>();
  for (const l of db.select({ id: schema.leads.id, email: schema.leads.email }).from(schema.leads).where(isNotNull(schema.leads.email)).all()) {
    if (l.email) map.set(l.email.trim().toLowerCase(), { type: "lead", id: l.id });
  }
  for (const c of db.select({ id: schema.clients.id, email: schema.clients.email }).from(schema.clients).where(isNotNull(schema.clients.email)).all()) {
    if (c.email) map.set(c.email.trim().toLowerCase(), { type: "client", id: c.id });
  }
  return map;
}

function emailItems(index: ReturnType<typeof contactIndex>, maxThreads: number): InboxItem[] {
  const rows = db
    .select({
      id: emailMessages.id,
      threadId: emailMessages.gmailThreadId,
      direction: emailMessages.direction,
      fromEmail: emailMessages.fromEmail,
      fromName: emailMessages.fromName,
      toEmail: emailMessages.toEmail,
      subject: emailMessages.subject,
      snippet: emailMessages.snippet,
      clientId: emailMessages.clientId,
      at: emailMessages.internalDate,
      isRead: emailMessages.isRead,
      // Bulk mail carries an unsubscribe link; checked in SQL so no body
      // ever leaves the database for the list.
      hasUnsubscribe: sql<number>`(instr(lower(coalesce(${emailMessages.bodyHtml}, '')), 'unsubscribe') > 0 or instr(lower(coalesce(${emailMessages.bodyText}, '')), 'unsubscribe') > 0)`,
    })
    .from(emailMessages)
    .orderBy(desc(emailMessages.internalDate))
    .limit(maxThreads * 4)
    .all();

  // Group newest-first rows into threads; the first row seen is the latest.
  const threads = new Map<string, typeof rows>();
  for (const r of rows) {
    const key = r.threadId ?? `m${r.id}`;
    const list = threads.get(key);
    if (list) list.push(r);
    else if (threads.size < maxThreads) threads.set(key, [r]);
  }

  const out: InboxItem[] = [];
  for (const [key, msgs] of threads) {
    const latest = msgs[0];
    const lastIn = msgs.find((m) => m.direction === "in");
    // The other party: whoever wrote in, else whoever we wrote to.
    const party = lastIn
      ? displaySender(lastIn.fromName, lastIn.fromEmail)
      : displaySender(null, latest.toEmail);
    const bucket = lastIn
      ? classifyEmail({
          direction: "in",
          fromEmail: party.email,
          fromName: lastIn.fromName,
          hasUnsubscribe: !!lastIn.hasUnsubscribe,
        })
      : "people";
    const unread = msgs.some((m) => m.direction === "in" && !m.isRead);
    const matched = latest.clientId
      ? { type: "client" as const, id: latest.clientId }
      : (index.get(party.email) ?? null);
    const snippet = cleanSnippet(latest.snippet ?? "");
    out.push({
      key: `email:${key}`,
      type: "email",
      channel: "email",
      name: party.name,
      address: party.email || null,
      subject: decodeEntities(latest.subject ?? "").trim() || null,
      snippet: latest.direction === "out" ? `You: ${snippet}` : snippet,
      at: latest.at?.getTime() ?? 0,
      unread,
      needsReply: latest.direction === "in" && bucket === "people",
      bucket,
      outbound: latest.direction === "out",
      messageCount: msgs.length,
      threadId: latest.threadId,
      contact: matched,
      conv: null,
    });
  }
  return out;
}

function sentLogItems(): InboxItem[] {
  return listRecentClientEmails(100).map((m) => ({
    key: `sent:${m.id}`,
    type: "sent" as const,
    channel: "email" as const,
    name: m.clientName,
    address: m.toEmail,
    subject: m.subject,
    snippet: `You: ${cleanSnippet(m.body).slice(0, 160)}`,
    at: m.createdAt,
    unread: false,
    needsReply: false,
    bucket: "people" as const,
    outbound: true,
    messageCount: 1,
    threadId: null,
    contact: { type: "client" as const, id: m.clientId },
    conv: null,
    failed: m.status === "failed",
    body: m.body,
  }));
}

function conversationItems(): InboxItem[] {
  return listConversations().map((c) => {
    const channel: InboxChannel = c.channel === "messenger" || c.channel === "instagram" ? c.channel : "whatsapp";
    const text = c.lastDirection === "outbound" ? `You: ${c.lastMessage}` : c.lastMessage;
    return {
      key: `conv:${c.kind}-${c.contactId}`,
      type: "conversation" as const,
      channel,
      name: c.name,
      address: null,
      subject: null,
      snippet: cleanSnippet(text),
      at: new Date(c.lastAt).getTime(),
      unread: c.needsAttention,
      needsReply: c.needsAttention,
      bucket: c.aiCategory === "spam" ? ("promotions" as const) : ("people" as const),
      outbound: c.lastDirection === "outbound",
      messageCount: 0,
      threadId: null,
      contact: { type: c.kind, id: c.contactId },
      conv: {
        kind: c.kind,
        contactId: c.contactId,
        href: c.href,
        aiCategory: c.aiCategory,
        aiPriority: c.aiPriority,
        tags: c.tags,
      },
    };
  });
}

export function listInboxItems(emailMode: EmailMode): InboxItem[] {
  const items = [
    ...(emailMode === "two-way" ? emailItems(contactIndex(), 300) : sentLogItems()),
    ...conversationItems(),
  ];
  items.sort((a, b) => b.at - a.at);
  return items;
}
