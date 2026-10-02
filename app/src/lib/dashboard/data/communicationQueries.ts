import "server-only";

import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { MsgRow } from "./communication";

const d = (ms: number) => new Date(ms);

export function unreadEmails(): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.emailMessages)
    .where(and(eq(schema.emailMessages.direction, "in"), eq(schema.emailMessages.isRead, false)))
    .get();
  return Number(row?.n ?? 0);
}

type Triaged = {
  direction: "outbound" | "inbound" | "note";
  channel: string | null;
  at: number;
  aiCategory: string | null;
  aiPriority: string | null;
  autoReplyStatus: string | null;
  triagedAt: Date | null;
};

function toRow(source: "lead" | "client", convo: string, r: Triaged): MsgRow {
  return {
    source,
    convo,
    direction: r.direction === "inbound" ? "inbound" : "outbound",
    atMs: Number(r.at),
    channel: r.channel,
    aiCategory: r.aiCategory,
    aiPriority: r.aiPriority,
    autoReplyStatus: r.autoReplyStatus,
    triagedAtMs: r.triagedAt ? r.triagedAt.getTime() : null,
  };
}

/**
 * Every real message (lead, client and Gmail) with a time in [fromMs, toMs).
 * Notes and the manual/system channels are not conversation; Gmail rows with
 * no internalDate cannot be placed in time and are skipped.
 */
export function loadMessages(fromMs: number, toMs: number): MsgRow[] {
  const out: MsgRow[] = [];

  const leadAt = sql<number>`coalesce(${schema.leadMessages.sentAt}, ${schema.leadMessages.createdAt})`;
  const leadRows = db
    .select({
      leadId: schema.leadMessages.leadId,
      direction: schema.leadMessages.direction,
      channel: schema.leadMessages.channel,
      at: leadAt,
      aiCategory: schema.leadMessages.aiCategory,
      aiPriority: schema.leadMessages.aiPriority,
      autoReplyStatus: schema.leadMessages.autoReplyStatus,
      triagedAt: schema.leadMessages.aiTriagedAt,
    })
    .from(schema.leadMessages)
    .where(
      and(
        sql`${schema.leadMessages.direction} != 'note'`,
        sql`(${schema.leadMessages.channel} is null or ${schema.leadMessages.channel} not in ('manual', 'system'))`,
        sql`${leadAt} >= ${fromMs}`,
        sql`${leadAt} < ${toMs}`,
      ),
    )
    .all();
  for (const r of leadRows) out.push(toRow("lead", `lead:${r.leadId}`, r));

  const clientAt = sql<number>`coalesce(${schema.clientMessages.sentAt}, ${schema.clientMessages.createdAt})`;
  const clientRows = db
    .select({
      clientId: schema.clientMessages.clientId,
      direction: schema.clientMessages.direction,
      channel: schema.clientMessages.channel,
      at: clientAt,
      aiCategory: schema.clientMessages.aiCategory,
      aiPriority: schema.clientMessages.aiPriority,
      autoReplyStatus: schema.clientMessages.autoReplyStatus,
      triagedAt: schema.clientMessages.aiTriagedAt,
    })
    .from(schema.clientMessages)
    .where(
      and(
        sql`${schema.clientMessages.direction} != 'note'`,
        sql`(${schema.clientMessages.channel} is null or ${schema.clientMessages.channel} not in ('manual', 'system'))`,
        sql`${clientAt} >= ${fromMs}`,
        sql`${clientAt} < ${toMs}`,
      ),
    )
    .all();
  for (const r of clientRows) out.push(toRow("client", `client:${r.clientId}`, r));

  const mailRows = db
    .select({
      id: schema.emailMessages.id,
      threadId: schema.emailMessages.gmailThreadId,
      direction: schema.emailMessages.direction,
      at: schema.emailMessages.internalDate,
    })
    .from(schema.emailMessages)
    .where(and(isNotNull(schema.emailMessages.internalDate), gte(schema.emailMessages.internalDate, d(fromMs)), lt(schema.emailMessages.internalDate, d(toMs))))
    .all();
  for (const r of mailRows) {
    out.push({
      source: "gmail",
      // No thread id: treat the message as its own standalone conversation.
      convo: r.threadId ? `thread:${r.threadId}` : `email:${r.id}`,
      direction: r.direction === "in" ? "inbound" : "outbound",
      atMs: (r.at as Date).getTime(),
      channel: "email",
      aiCategory: null,
      aiPriority: null,
      autoReplyStatus: null,
      triagedAtMs: null,
    });
  }
  return out;
}

/** Inbound lead/client messages triaged in range: how many, how many auto-sent, how many waiting for review. */
export function triageReplyCounts(fromMs: number, toMs: number): { triaged: number; autoSent: number; forReview: number } {
  let triaged = 0;
  let autoSent = 0;
  let forReview = 0;
  for (const t of [schema.leadMessages, schema.clientMessages]) {
    const rows = db
      .select({ status: t.autoReplyStatus, n: sql<number>`count(*)` })
      .from(t)
      .where(and(eq(t.direction, "inbound"), isNotNull(t.aiTriagedAt), gte(t.aiTriagedAt, d(fromMs)), lt(t.aiTriagedAt, d(toMs))))
      .groupBy(t.autoReplyStatus)
      .all();
    for (const r of rows) {
      const n = Number(r.n);
      triaged += n;
      if (r.status === "auto_sent") autoSent += n;
      if (r.status === "drafted" || r.status === "held") forReview += n;
    }
  }
  return { triaged, autoSent, forReview };
}

/** Tags added to conversations in range, most used first. */
export function topTags(fromMs: number, toMs: number, limit: number): { label: string; value: number }[] {
  return db
    .select({ label: schema.tags.label, value: sql<number>`count(*)` })
    .from(schema.conversationTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.conversationTags.tagId))
    .where(and(gte(schema.conversationTags.createdAt, d(fromMs)), lt(schema.conversationTags.createdAt, d(toMs))))
    .groupBy(schema.tags.id)
    .orderBy(sql`count(*) desc`)
    .limit(limit)
    .all()
    .map((r) => ({ label: r.label, value: Number(r.value) }));
}

/** Automated messages: sent (sentAt in range), failed and still queued (dueAt in range). */
export function automationCounts(fromMs: number, toMs: number): { sent: number; failed: number; queued: number } {
  const q = schema.automationQueue;
  const count = (status: "sent" | "failed" | "queued", col: typeof q.sentAt | typeof q.dueAt) =>
    Number(
      db
        .select({ n: sql<number>`count(*)` })
        .from(q)
        .where(and(eq(q.status, status), isNotNull(col), gte(col, d(fromMs)), lt(col, d(toMs))))
        .get()?.n ?? 0,
    );
  return { sent: count("sent", q.sentAt), failed: count("failed", q.dueAt), queued: count("queued", q.dueAt) };
}
