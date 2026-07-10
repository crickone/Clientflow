import "server-only";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { getCurrentTenant, runWithTenant } from "@/lib/db/tenant";
import {
  leadMessages,
  clientMessages,
  leads,
  clients,
  tags as tagsTable,
  conversationTags,
} from "@/lib/db/schema";
import {
  triageMessage,
  type TriageHistoryItem,
  type TriageResult,
} from "@/lib/ai/triageMessage";
import { isBriefComplete } from "@/lib/businessProfile";
import { getInboxAiSettings } from "@/lib/inbox/settings";
import {
  decideAutoReply,
  type AutoReplyDecision,
} from "@/lib/inbox/autoReplyDecision";
import { sendWhatsApp } from "@/lib/whatsapp/send";
import { logActivity } from "@/lib/queries";

export type OwnerType = "lead" | "client";
export type { AutoReplyDecision };

export interface RunTriageArgs {
  ownerType: OwnerType;
  ownerId: number;
  messageId: number;
  messageText: string;
  channel: string;
}

export interface RunTriageOutcome {
  decision: AutoReplyDecision;
  triage: TriageResult;
}

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Gather sender identity + recent history for the triage prompt. */
function gatherContext(
  ownerType: OwnerType,
  ownerId: number,
  excludeMessageId: number,
): {
  senderName: string | null;
  isExistingClient: boolean;
  history: TriageHistoryItem[];
} {
  let senderName: string | null = null;
  let isExistingClient = ownerType === "client";

  if (ownerType === "lead") {
    const lead = db.select().from(leads).where(eq(leads.id, ownerId)).get();
    if (lead) {
      senderName =
        [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || null;
      isExistingClient = lead.clientId != null;
    }
    const rows = db
      .select()
      .from(leadMessages)
      .where(eq(leadMessages.leadId, ownerId))
      .orderBy(desc(leadMessages.createdAt))
      .limit(7)
      .all()
      .reverse();
    const history = rows
      .filter((r) => r.id !== excludeMessageId)
      .map((r) => ({ direction: r.direction, content: r.content }));
    return { senderName, isExistingClient, history };
  }

  const client = db.select().from(clients).where(eq(clients.id, ownerId)).get();
  if (client) {
    senderName = `${client.firstName} ${client.lastName}`.trim() || null;
  }
  const rows = db
    .select()
    .from(clientMessages)
    .where(eq(clientMessages.clientId, ownerId))
    .orderBy(desc(clientMessages.createdAt))
    .limit(7)
    .all()
    .reverse();
  const history = rows
    .filter((r) => r.id !== excludeMessageId)
    .map((r) => ({ direction: r.direction, content: r.content }));
  return { senderName, isExistingClient, history };
}

/** Link AI-applied tags to the conversation, creating suggested tags as needed. */
function applyTags(ownerType: OwnerType, ownerId: number, labels: string[]): void {
  for (const label of labels) {
    const slug = slugify(label);
    if (!slug) continue;
    let tag = db.select().from(tagsTable).where(eq(tagsTable.slug, slug)).get();
    if (!tag) {
      db.insert(tagsTable)
        .values({ label, slug, isCore: false })
        .onConflictDoNothing()
        .run();
      tag = db.select().from(tagsTable).where(eq(tagsTable.slug, slug)).get();
    }
    if (tag) {
      db.insert(conversationTags)
        .values({ ownerType, ownerId, tagId: tag.id, addedBy: "ai" })
        .onConflictDoNothing()
        .run();
    }
  }
}

function setAutoReplyStatus(
  ownerType: OwnerType,
  messageId: number,
  status: "none" | "drafted" | "auto_sent" | "held",
): void {
  if (ownerType === "lead") {
    db.update(leadMessages)
      .set({ autoReplyStatus: status })
      .where(eq(leadMessages.id, messageId))
      .run();
  } else {
    db.update(clientMessages)
      .set({ autoReplyStatus: status })
      .where(eq(clientMessages.id, messageId))
      .run();
  }
}

/**
 * Resolve any staged AI draft for a conversation once a human has replied.
 * A "drafted" suggestion only applies to the latest inbound message; once the
 * user sends (approve or a manual reply) we flip it to "approved" so the
 * suggestion doesn't reappear when the thread is reloaded.
 */
export function clearConversationDraft(
  ownerType: OwnerType,
  ownerId: number,
): void {
  if (ownerType === "lead") {
    db.update(leadMessages)
      .set({ autoReplyStatus: "approved" })
      .where(
        and(
          eq(leadMessages.leadId, ownerId),
          eq(leadMessages.autoReplyStatus, "drafted"),
        ),
      )
      .run();
  } else {
    db.update(clientMessages)
      .set({ autoReplyStatus: "approved" })
      .where(
        and(
          eq(clientMessages.clientId, ownerId),
          eq(clientMessages.autoReplyStatus, "drafted"),
        ),
      )
      .run();
  }
}

/**
 * Triage one inbound message: call the model, persist the classification + tags,
 * and stage the reply (drafted/held). Returns the auto-reply decision so the
 * caller (webhook) can hand off to the send path. The actual send lives in the
 * auto-reply path (kept separate so triage never blocks on transport).
 */
export async function runTriage(args: RunTriageArgs): Promise<RunTriageOutcome> {
  // Spawned fire-and-forget from the webhook; bind it to the tenant resolved
  // in-request so its writes land in the right clinic's DB rather than the
  // default one after the request (and its cookie context) has ended.
  const tenantId = getCurrentTenant().id;
  return runWithTenant(tenantId, () => runTriageBound(args));
}

async function runTriageBound(
  args: RunTriageArgs,
): Promise<RunTriageOutcome> {
  const { ownerType, ownerId, messageId, messageText, channel } = args;
  const ctx = gatherContext(ownerType, ownerId, messageId);

  const triage = await triageMessage({
    messageText,
    channel,
    isExistingClient: ctx.isExistingClient,
    senderName: ctx.senderName,
    history: ctx.history,
  });

  const decision = decideAutoReply(
    triage,
    getInboxAiSettings(),
    isBriefComplete(),
  );

  const triageFields = {
    aiCategory: triage.category,
    aiPriority: triage.priority,
    aiSummary: triage.summary,
    aiConfidence: triage.confidence,
    aiSensitive: triage.sensitive,
    aiTriagedAt: new Date(),
    aiSuggestedReply: triage.suggestedReply,
    // Step-8 send path flips this to "auto_sent" after a successful auto-send.
    autoReplyStatus: (decision === "held" ? "held" : "drafted") as
      | "held"
      | "drafted",
  };

  if (ownerType === "lead") {
    db.update(leadMessages)
      .set(triageFields)
      .where(eq(leadMessages.id, messageId))
      .run();
  } else {
    db.update(clientMessages)
      .set(triageFields)
      .where(eq(clientMessages.id, messageId))
      .run();
  }

  applyTags(ownerType, ownerId, triage.tags);

  // Auto-send path: send the grounded reply now. sendWhatsApp throws on any
  // failure (no phone, bridge down, provider reject) — in that case we leave the
  // message as a draft so nothing is lost and the operator can send manually.
  if (decision === "auto_send" && triage.suggestedReply) {
    try {
      await sendWhatsApp({
        subjectType: ownerType,
        subjectId: ownerId,
        text: triage.suggestedReply,
        aiGenerated: true,
      });
      setAutoReplyStatus(ownerType, messageId, "auto_sent");
      await logActivity(
        "inbox.auto_reply",
        `AI auto-replied to a ${triage.category.replace(/_/g, " ")}`,
        ownerType === "lead" ? { leadId: ownerId } : { clientId: ownerId },
      );
    } catch (err) {
      console.error("[triage] auto-reply send failed; kept as draft:", err);
    }
  }

  return { decision, triage };
}

/**
 * Re-run triage on a conversation's most recent inbound message. Used by the
 * inbox "re-run AI" button to recover messages that failed to triage at
 * ingestion (e.g. a transient AI/API error). Returns null if there's no inbound.
 */
export async function retriageConversation(
  ownerType: OwnerType,
  ownerId: number,
): Promise<RunTriageOutcome | null> {
  const msg =
    ownerType === "lead"
      ? db
          .select()
          .from(leadMessages)
          .where(
            and(
              eq(leadMessages.leadId, ownerId),
              eq(leadMessages.direction, "inbound"),
            ),
          )
          .orderBy(desc(leadMessages.createdAt))
          .limit(1)
          .get()
      : db
          .select()
          .from(clientMessages)
          .where(
            and(
              eq(clientMessages.clientId, ownerId),
              eq(clientMessages.direction, "inbound"),
            ),
          )
          .orderBy(desc(clientMessages.createdAt))
          .limit(1)
          .get();
  if (!msg) return null;
  return runTriage({
    ownerType,
    ownerId,
    messageId: msg.id,
    messageText: msg.content,
    channel: msg.channel ?? "whatsapp",
  });
}
