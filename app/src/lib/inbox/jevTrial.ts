import "server-only";

import { desc, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientMessages, jevTriageTrial, leadMessages } from "@/lib/db/schema";
import { jevConfigured, jevDecide } from "@/lib/ai/jev";
import { JEV_TRIAGE_QUESTIONS, jevTriageState, readJevTriage, trialStats, type TrialStats } from "@/lib/ai/jevTriageModel";
import type { TriageHistoryItem, TriageResult } from "@/lib/ai/triageMessage";

/**
 * Jev runs beside Claude on every inbound message and its answer is only
 * recorded, never used: the inbox, auto-replies and tags still come from
 * Claude. Runs inside the triage pipeline's tenant binding (ambient `db`).
 * Never throws; a failed call is recorded with its reason.
 */
export async function shadowJevTriage(args: {
  tenantId: number;
  ownerType: "lead" | "client";
  messageId: number;
  channel: string;
  input: { messageText: string; isExistingClient: boolean; senderName?: string | null; history?: TriageHistoryItem[] };
  claude: TriageResult;
}): Promise<void> {
  if (!jevConfigured()) return;
  try {
    const r = await jevDecide({ tenantId: args.tenantId, agentKey: "jev-triage" }, jevTriageState({ ...args.input, channel: args.channel }), JEV_TRIAGE_QUESTIONS);
    const read = r.ok ? readJevTriage(r.answers) : null;
    db.insert(jevTriageTrial)
      .values({
        ownerType: args.ownerType,
        messageId: args.messageId,
        channel: args.channel,
        claudeCategory: args.claude.category,
        claudePriority: args.claude.priority,
        claudeSensitive: args.claude.sensitive,
        jevCategory: read?.category ?? null,
        jevPriority: read?.priority ?? null,
        jevSensitive: read?.sensitive ?? null,
        jevConfidence: read?.confidence ?? null,
        jevMs: r.ms,
        error: r.ok ? (read ? null : "Jev's answer couldn't be read.") : r.error,
        createdAt: Date.now(),
      })
      .run();
  } catch (err) {
    console.error("[jev-trial] failed", err instanceof Error ? err.message : err);
  }
}

export type TrialView = {
  on: boolean;
  stats: TrialStats;
  lastError: string | null;
  disagreements: {
    id: number;
    at: number;
    channel: string;
    text: string;
    claude: { category: string; priority: string; sensitive: boolean };
    jev: { category: string; priority: string; sensitive: boolean; confidence: number | null };
  }[];
};

/** The last 30 days of the trial for this business: agreement, speed, and the messages they disagreed on. */
export function jevTrialView(): TrialView {
  const since = Date.now() - 30 * 86_400_000;
  const rows = db.select().from(jevTriageTrial).orderBy(desc(jevTriageTrial.createdAt)).limit(2000).all().filter((r) => r.createdAt >= since);
  const stats = trialStats(rows);
  const lastError = rows.find((r) => r.error)?.error ?? null;
  const differ = rows
    .filter((r) => !r.error && r.jevCategory && (r.jevCategory !== r.claudeCategory || r.jevSensitive !== r.claudeSensitive || r.jevPriority !== r.claudePriority))
    .slice(0, 25);
  const leadIds = differ.filter((r) => r.ownerType === "lead").map((r) => r.messageId);
  const clientIds = differ.filter((r) => r.ownerType === "client").map((r) => r.messageId);
  const leadText = new Map(leadIds.length ? db.select({ id: leadMessages.id, content: leadMessages.content }).from(leadMessages).where(inArray(leadMessages.id, leadIds)).all().map((m) => [m.id, m.content]) : []);
  const clientText = new Map(clientIds.length ? db.select({ id: clientMessages.id, content: clientMessages.content }).from(clientMessages).where(inArray(clientMessages.id, clientIds)).all().map((m) => [m.id, m.content]) : []);
  return {
    on: jevConfigured(),
    stats,
    lastError: rows[0]?.error ? lastError : null,
    disagreements: differ.map((r) => ({
      id: r.id,
      at: r.createdAt,
      channel: r.channel,
      text: ((r.ownerType === "lead" ? leadText.get(r.messageId) : clientText.get(r.messageId)) ?? "(message deleted)").slice(0, 280),
      claude: { category: r.claudeCategory, priority: r.claudePriority, sensitive: r.claudeSensitive },
      jev: { category: r.jevCategory!, priority: r.jevPriority ?? "-", sensitive: r.jevSensitive ?? false, confidence: r.jevConfidence },
    })),
  };
}

/** Whether this business has any trial rows yet. */
export function jevTrialHasRows(): boolean {
  return db.select({ id: jevTriageTrial.id }).from(jevTriageTrial).limit(1).get() !== undefined;
}

