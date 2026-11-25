import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { db, schema } from "@/lib/db";

import { flowNow } from "./clock";
import { getFlowDefinition } from "./definitions";
import { parsePayload, THINKING_FLOW } from "./flowModel";
import { activeRun } from "./runs";

/**
 * The Thinking about it flow reads a reply before acting on it. The reply
 * stops the flow's remaining messages and queues a reply check; the inbox
 * triage settles it (lib/pipeline/stage.ts onLeadReplyTriaged). If the
 * triage never answers (AI cap, an error, an email reply, which is not
 * triaged) the check fires after REPLY_CHECK_FALLBACK_MS and is treated as
 * wanting to talk, so a person looks rather than the lead waiting a week.
 */

export const REPLY_CHECK_FALLBACK_MS = 15 * 60_000;
export const THINKING_NURTURE_AFTER_MS = 7 * 86_400_000;

/** Start a reply check when the lead is in Thinking about it with its flow on. True when one started. */
export function beginThinkingReplyCheck(leadId: number, inThinkingColumn: boolean, reply?: { text: string; messageId?: number }): boolean {
  if (!inThinkingColumn) return false;
  if (!getFlowDefinition(THINKING_FLOW).enabled) return false;
  const run = activeRun(leadId, THINKING_FLOW);
  const now = flowNow();
  // They answered: no more nudges, and no move until the reply is read.
  db.update(schema.automationQueue)
    .set({ status: "cancelled", error: "Stopped: replied" })
    .where(
      and(
        eq(schema.automationQueue.leadId, leadId),
        eq(schema.automationQueue.status, "queued"),
        eq(schema.automationQueue.triggerKey, THINKING_FLOW),
        ne(schema.automationQueue.kind, "reply_check"),
      ),
    )
    .run();
  db.insert(schema.automationQueue)
    .values({
      triggerKey: THINKING_FLOW,
      leadId,
      runId: run?.id ?? null,
      kind: "reply_check",
      channel: "chat",
      body: "Reply check",
      dueAt: new Date(now + REPLY_CHECK_FALLBACK_MS),
      payload: JSON.stringify({ text: reply?.text ?? "", messageId: reply?.messageId }),
    })
    .run();
  return true;
}

/** Settle the reply check for this message (or the oldest one). Returns what they said, or null when none is waiting. */
export function takeReplyCheck(leadId: number, messageId?: number): { text: string } | null {
  const rows = db
    .select()
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.leadId, leadId), eq(schema.automationQueue.status, "queued"), eq(schema.automationQueue.kind, "reply_check")))
    .orderBy(asc(schema.automationQueue.id))
    .all();
  const row = messageId != null ? rows.find((r) => parsePayload(r.payload).messageId === messageId) : rows[0];
  if (!row) return null;
  db.update(schema.automationQueue)
    .set({ status: "sent", error: "Settled by the inbox triage.", sentAt: new Date(flowNow()) })
    .where(eq(schema.automationQueue.id, row.id))
    .run();
  return { text: parsePayload(row.payload).text ?? "" };
}

/** Not a yes: Long-term nurture in 7 days, unless a person moves them first (which cancels this). */
export function queueThinkingNurtureMove(leadId: number): void {
  const run = activeRun(leadId, THINKING_FLOW);
  db.insert(schema.automationQueue)
    .values({
      triggerKey: THINKING_FLOW,
      leadId,
      runId: run?.id ?? null,
      kind: "move",
      channel: "chat",
      body: "Move to key:nurture",
      dueAt: new Date(flowNow() + THINKING_NURTURE_AFTER_MS),
      payload: JSON.stringify({ column: "key:nurture" }),
    })
    .run();
}
