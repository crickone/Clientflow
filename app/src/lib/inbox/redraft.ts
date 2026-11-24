import "server-only";

import { and, desc, eq, gt, gte, inArray, isNotNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { runWithTenant } from "@/lib/db/tenant";
import { clientMessages, leadMessages } from "@/lib/db/schema";
import { AiCapError } from "@/lib/ai/usage";
import { retriageConversation } from "./triagePipeline";

/**
 * Rewrite the AI drafts still waiting for staff, so they quote today's prices.
 *
 * A draft is written once, when the message arrives, and never changes after
 * that: change a price in Settings and every waiting draft keeps the old one.
 * This re-runs the draft for each conversation whose latest customer message
 * still has an unsent draft and no reply from us since. Always draft-only: a
 * rewrite never goes to the customer on its own.
 */
const WINDOW_DAYS = 30;

type Waiting = { ownerType: "lead" | "client"; ownerId: number };

export function waitingDrafts(sinceMs: number): Waiting[] {
  const out: Waiting[] = [];
  const since = new Date(sinceMs);

  const leadRows = db
    .select({ id: leadMessages.id, ownerId: leadMessages.leadId, createdAt: leadMessages.createdAt })
    .from(leadMessages)
    .where(
      and(
        eq(leadMessages.direction, "inbound"),
        inArray(leadMessages.autoReplyStatus, ["drafted", "held"]),
        isNotNull(leadMessages.aiSuggestedReply),
        gte(leadMessages.createdAt, since),
      ),
    )
    .orderBy(desc(leadMessages.createdAt))
    .all();
  const seenLead = new Set<number>();
  for (const r of leadRows) {
    if (seenLead.has(r.ownerId)) continue;
    seenLead.add(r.ownerId);
    const newer = db
      .select({ id: leadMessages.id })
      .from(leadMessages)
      .where(and(eq(leadMessages.leadId, r.ownerId), gt(leadMessages.createdAt, r.createdAt)))
      .limit(1)
      .get();
    if (!newer) out.push({ ownerType: "lead", ownerId: r.ownerId });
  }

  const clientRows = db
    .select({ id: clientMessages.id, ownerId: clientMessages.clientId, createdAt: clientMessages.createdAt })
    .from(clientMessages)
    .where(
      and(
        eq(clientMessages.direction, "inbound"),
        inArray(clientMessages.autoReplyStatus, ["drafted", "held"]),
        isNotNull(clientMessages.aiSuggestedReply),
        gte(clientMessages.createdAt, since),
      ),
    )
    .orderBy(desc(clientMessages.createdAt))
    .all();
  const seenClient = new Set<number>();
  for (const r of clientRows) {
    if (seenClient.has(r.ownerId)) continue;
    seenClient.add(r.ownerId);
    const newer = db
      .select({ id: clientMessages.id })
      .from(clientMessages)
      .where(and(eq(clientMessages.clientId, r.ownerId), gt(clientMessages.createdAt, r.createdAt)))
      .limit(1)
      .get();
    if (!newer) out.push({ ownerType: "client", ownerId: r.ownerId });
  }
  return out;
}

/** Rewrite every waiting draft for this business. Returns how many were rewritten. */
export async function redraftWaitingReplies(tenantId: number, now = Date.now()): Promise<number> {
  return runWithTenant(tenantId, async () => {
    const waiting = waitingDrafts(now - WINDOW_DAYS * 24 * 60 * 60 * 1000);
    let done = 0;
    for (const w of waiting) {
      try {
        const res = await retriageConversation(w.ownerType, w.ownerId, { draftOnly: true });
        if (res) done++;
      } catch (err) {
        // The monthly AI cap stops the run; anything else skips one thread.
        if (err instanceof AiCapError) {
          console.warn(`[redraft] tenant ${tenantId}: stopped at the AI cap after ${done}`);
          break;
        }
        console.error(`[redraft] tenant ${tenantId} ${w.ownerType} ${w.ownerId} failed:`, err);
      }
    }
    if (waiting.length) console.log(`[redraft] tenant ${tenantId}: rewrote ${done} of ${waiting.length} waiting drafts`);
    return done;
  });
}

const pending = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * After a price change: rewrite the waiting drafts a minute later, once, however
 * many prices were edited in that minute. Fire-and-forget; never throws.
 */
export function scheduleRedraft(tenantId: number, delayMs = 60_000): void {
  const prev = pending.get(tenantId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    pending.delete(tenantId);
    void redraftWaitingReplies(tenantId).catch((err) => console.error(`[redraft] tenant ${tenantId} failed:`, err));
  }, delayMs);
  t.unref?.();
  pending.set(tenantId, t);
}
