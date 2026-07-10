import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  clientMessages,
  clients,
  leadMessages,
  leads,
  tags as tagsTable,
  conversationTags,
} from "./db/schema";
import type { ThreadMessage } from "@/components/messaging/ConversationThread";

export interface ConvTag {
  label: string;
  color: string | null;
  isCore: boolean;
}

export interface ConversationSummary {
  kind: "lead" | "client";
  contactId: number;
  name: string;
  href: string;
  channel: string | null;
  lastMessage: string;
  lastDirection: "outbound" | "inbound" | "note";
  lastAt: Date;
  /** AI triage rollup, taken from the latest inbound message. */
  aiCategory: string | null;
  aiPriority: "high" | "normal" | "low" | null;
  aiSummary: string | null;
  autoReplyStatus: string | null;
  tags: ConvTag[];
  /** True when the latest message is an unresolved inbound (drafted/held). */
  needsAttention: boolean;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

/**
 * Unified inbox feed: the most recent message per lead and per client that has a
 * conversation, newest first. Powers the Communication tab. Read-only; reuses the
 * existing per-contact threads for the actual reading/replying (for now).
 */
type Triageish = {
  id: number;
  aiCategory: string | null;
  aiPriority: string | null;
  aiSummary: string | null;
  autoReplyStatus: string | null;
};

export function listConversations(): ConversationSummary[] {
  // Latest message + latest inbound message per lead.
  const lm = db
    .select()
    .from(leadMessages)
    .orderBy(desc(leadMessages.createdAt))
    .all();
  const leadLast = new Map<number, (typeof lm)[number]>();
  const leadLastInbound = new Map<number, (typeof lm)[number]>();
  for (const m of lm) {
    if (!leadLast.has(m.leadId)) leadLast.set(m.leadId, m);
    if (m.direction === "inbound" && !leadLastInbound.has(m.leadId)) {
      leadLastInbound.set(m.leadId, m);
    }
  }

  // Latest message + latest inbound message per client.
  const cm = db
    .select()
    .from(clientMessages)
    .orderBy(desc(clientMessages.createdAt))
    .all();
  const clientLast = new Map<number, (typeof cm)[number]>();
  const clientLastInbound = new Map<number, (typeof cm)[number]>();
  for (const m of cm) {
    if (!clientLast.has(m.clientId)) clientLast.set(m.clientId, m);
    if (m.direction === "inbound" && !clientLastInbound.has(m.clientId)) {
      clientLastInbound.set(m.clientId, m);
    }
  }

  // Tags grouped by conversation owner.
  const tagRows = db
    .select({
      ownerType: conversationTags.ownerType,
      ownerId: conversationTags.ownerId,
      label: tagsTable.label,
      color: tagsTable.color,
      isCore: tagsTable.isCore,
    })
    .from(conversationTags)
    .innerJoin(tagsTable, eq(tagsTable.id, conversationTags.tagId))
    .all();
  const tagsByOwner = new Map<string, ConvTag[]>();
  for (const t of tagRows) {
    const key = `${t.ownerType}:${t.ownerId}`;
    const arr = tagsByOwner.get(key) ?? [];
    arr.push({ label: t.label, color: t.color, isCore: t.isCore });
    tagsByOwner.set(key, arr);
  }

  const out: ConversationSummary[] = [];

  const push = (
    kind: "lead" | "client",
    id: number,
    name: string,
    href: string,
    last: {
      id: number;
      channel: string | null;
      content: string;
      direction: "outbound" | "inbound" | "note";
      createdAt: Date;
    },
    inbound: Triageish | undefined,
  ) => {
    const needsAttention =
      last.direction === "inbound" &&
      !!inbound &&
      last.id === inbound.id &&
      (inbound.autoReplyStatus === "drafted" ||
        inbound.autoReplyStatus === "held");
    out.push({
      kind,
      contactId: id,
      name,
      href,
      channel: last.channel,
      lastMessage: last.content,
      lastDirection: last.direction,
      lastAt: last.createdAt,
      aiCategory: inbound?.aiCategory ?? null,
      aiPriority:
        (inbound?.aiPriority as ConversationSummary["aiPriority"]) ?? null,
      aiSummary: inbound?.aiSummary ?? null,
      autoReplyStatus: inbound?.autoReplyStatus ?? null,
      tags: tagsByOwner.get(`${kind}:${id}`) ?? [],
      needsAttention,
    });
  };

  if (leadLast.size > 0) {
    const ids = [...leadLast.keys()];
    const rows = db.select().from(leads).where(inArray(leads.id, ids)).all();
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const [leadId, msg] of leadLast) {
      const l = byId.get(leadId);
      if (!l) continue;
      const name =
        [l.firstName, l.lastName].filter(Boolean).join(" ").trim() ||
        l.phone ||
        l.email ||
        "Lead";
      push("lead", leadId, name, `/leads/${leadId}`, msg, leadLastInbound.get(leadId));
    }
  }

  if (clientLast.size > 0) {
    const ids = [...clientLast.keys()];
    const rows = db.select().from(clients).where(inArray(clients.id, ids)).all();
    const byId = new Map(rows.map((r) => [r.id, r]));
    for (const [clientId, msg] of clientLast) {
      const c = byId.get(clientId);
      if (!c) continue;
      push(
        "client",
        clientId,
        `${c.firstName} ${c.lastName}`.trim(),
        `/clients/${clientId}`,
        msg,
        clientLastInbound.get(clientId),
      );
    }
  }

  out.sort((a, b) => {
    const pa = a.aiPriority ? PRIORITY_RANK[a.aiPriority] : 3;
    const pb = b.aiPriority ? PRIORITY_RANK[b.aiPriority] : 3;
    if (pa !== pb) return pa - pb;
    return new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime();
  });
  return out;
}

export interface ConversationDetail {
  kind: "lead" | "client";
  contactId: number;
  name: string;
  href: string;
  phone: string | null;
  hasPhone: boolean;
  messages: ThreadMessage[];
  /** Triage of the latest inbound message — drives the pane header. */
  aiCategory: string | null;
  aiPriority: "high" | "normal" | "low" | null;
  aiSummary: string | null;
  sensitive: boolean;
  /** Staged AI reply awaiting approval, if any. */
  draft: { text: string; status: string } | null;
  /** True when the latest inbound message exists but was never triaged (AI failed at ingestion). */
  untriaged: boolean;
}

function triageOf(
  rows: Array<{
    direction: string;
    aiCategory: string | null;
    aiPriority: string | null;
    aiSummary: string | null;
    aiSensitive: boolean | null;
    aiSuggestedReply: string | null;
    autoReplyStatus: string | null;
    aiTriagedAt: Date | null;
  }>,
): Pick<
  ConversationDetail,
  "aiCategory" | "aiPriority" | "aiSummary" | "sensitive" | "draft" | "untriaged"
> {
  const inbound = [...rows].reverse().find((r) => r.direction === "inbound");
  return {
    aiCategory: inbound?.aiCategory ?? null,
    aiPriority: (inbound?.aiPriority as ConversationDetail["aiPriority"]) ?? null,
    aiSummary: inbound?.aiSummary ?? null,
    sensitive: !!inbound?.aiSensitive,
    draft:
      inbound?.aiSuggestedReply && inbound.autoReplyStatus === "drafted"
        ? { text: inbound.aiSuggestedReply, status: inbound.autoReplyStatus }
        : null,
    untriaged: !!inbound && inbound.aiTriagedAt == null,
  };
}

function toThread(rows: Array<{
  id: number;
  direction: string;
  channel: string | null;
  content: string;
  status: string | null;
  aiGenerated: boolean;
  sentAt: Date | null;
  createdAt: Date;
}>): ThreadMessage[] {
  return rows.map((m) => ({
    id: m.id,
    direction: m.direction as ThreadMessage["direction"],
    channel: m.channel,
    content: m.content,
    status: m.status,
    aiGenerated: m.aiGenerated,
    sentAt: m.sentAt,
    createdAt: m.createdAt,
  }));
}

/**
 * Full thread + contact details for one conversation, oldest-first. Powers the
 * right pane of the Communication inbox. Returns null if the contact is gone.
 */
export function getConversationThread(
  kind: "lead" | "client",
  contactId: number,
): ConversationDetail | null {
  if (kind === "lead") {
    const lead = db.select().from(leads).where(eq(leads.id, contactId)).get();
    if (!lead) return null;
    const rows = db
      .select()
      .from(leadMessages)
      .where(eq(leadMessages.leadId, contactId))
      .orderBy(leadMessages.createdAt)
      .all();
    const name =
      [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() ||
      lead.phone ||
      lead.email ||
      "Lead";
    return {
      kind,
      contactId,
      name,
      href: `/leads/${contactId}`,
      phone: lead.phone,
      hasPhone: !!lead.phone,
      messages: toThread(rows),
      ...triageOf(rows),
    };
  }

  const client = db.select().from(clients).where(eq(clients.id, contactId)).get();
  if (!client) return null;
  const rows = db
    .select()
    .from(clientMessages)
    .where(eq(clientMessages.clientId, contactId))
    .orderBy(clientMessages.createdAt)
    .all();
  return {
    kind,
    contactId,
    name: `${client.firstName} ${client.lastName}`.trim(),
    href: `/clients/${contactId}`,
    phone: client.phone,
    hasPhone: !!client.phone,
    messages: toThread(rows),
    ...triageOf(rows),
  };
}
