import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { getTenantDbById } from "@/lib/db/tenant";
import { leadMessages, leads, pipelineStages } from "@/lib/db/schema";
import { jevConfigured, jevDecide } from "@/lib/ai/jev";
import { LEAD_SCORE_QUESTIONS, leadScoreState, readLeadScore, scoreDue, type LeadFacts, type LeadScore } from "@/lib/leadScoreModel";

/**
 * Lead scores from Jev. The ticker calls scoreLeadsIfDue for each business:
 * a lead is (re)scored when it's new, when something happened since its last
 * score, or once a day so a quiet lead cools. Tenant-explicit throughout (the
 * ticker has no request). Writing a score never touches updated_at, so it
 * doesn't count as activity or move a lead's "last activity".
 */

const PER_RUN = 25;

function factsFor(tenantId: number, leadId: number): LeadFacts | null {
  const tdb = getTenantDbById(tenantId);
  const row = tdb
    .select({ lead: leads, stageName: pipelineStages.name })
    .from(leads)
    .leftJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .where(eq(leads.id, leadId))
    .get();
  if (!row) return null;
  const l = row.lead;
  const msgs = tdb
    .select()
    .from(leadMessages)
    .where(eq(leadMessages.leadId, leadId))
    .orderBy(desc(leadMessages.createdAt))
    .limit(30)
    .all()
    .reverse()
    // An unsent AI draft isn't something we said.
    .filter((m) => !(m.direction === "outbound" && m.aiGenerated && m.sentAt === null));
  return {
    source: l.source,
    campaign: l.campaign,
    interestedIn: l.therapyInterest,
    stage: row.stageName ?? null,
    formNotes: l.notes,
    hasPhone: Boolean(l.phone),
    hasEmail: Boolean(l.email),
    doNotCall: l.doNotCall,
    createdAt: l.createdAt.getTime(),
    messages: msgs.map((m) => ({ direction: m.direction, channel: m.channel ?? "manual", at: (m.sentAt ?? m.createdAt).getTime(), content: m.content })),
  };
}

/** Score one lead now. Returns the score, or null when Jev isn't set up or didn't answer. */
/** `timeoutMs`: shorter when someone is waiting on screen (a stage move), so a slow gateway never holds up the move. */
export async function scoreLead(tenantId: number, leadId: number, timeoutMs = 8000): Promise<LeadScore | null> {
  if (!jevConfigured()) return null;
  const facts = factsFor(tenantId, leadId);
  if (!facts) return null;
  const now = Date.now();
  const r = await jevDecide({ tenantId, agentKey: "lead-score" }, leadScoreState(facts, now), LEAD_SCORE_QUESTIONS, timeoutMs);
  if (!r.ok) {
    console.error(`[lead-score] tenant ${tenantId} lead ${leadId}: ${r.error}`);
    return null;
  }
  const s = readLeadScore(r.answers);
  if (!s) return null;
  getTenantDbById(tenantId).update(leads).set({ leadScore: s.score, leadNextStep: s.next, leadScoredAt: now }).where(eq(leads.id, leadId)).run();
  return s;
}

/** The ticker's step: score up to 25 of this business's leads that are due. */
export async function scoreLeadsIfDue(tenantId: number): Promise<number> {
  if (!jevConfigured()) return 0;
  const tdb = getTenantDbById(tenantId);
  const lastMsg = tdb
    .select({ leadId: leadMessages.leadId, at: sql<number>`max(${leadMessages.createdAt})`.as("last_msg_at") })
    .from(leadMessages)
    .groupBy(leadMessages.leadId)
    .as("last_msg");
  const rows = tdb
    .select({ id: leads.id, scoredAt: leads.leadScoredAt, updatedAt: leads.updatedAt, clientId: leads.clientId, role: pipelineStages.role, lastMsgAt: lastMsg.at })
    .from(leads)
    .leftJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .leftJoin(lastMsg, eq(lastMsg.leadId, leads.id))
    .all();
  const now = Date.now();
  const due = rows
    .filter((r) => scoreDue({ scoredAt: r.scoredAt, lastActivity: Math.max(r.updatedAt.getTime(), Number(r.lastMsgAt) || 0), stageRole: r.role ?? null, isClient: r.clientId !== null }, now))
    // Never-scored and most recently active first.
    .sort((a, b) => (a.scoredAt === null ? -1 : 0) - (b.scoredAt === null ? -1 : 0) || Math.max(b.updatedAt.getTime(), Number(b.lastMsgAt) || 0) - Math.max(a.updatedAt.getTime(), Number(a.lastMsgAt) || 0))
    .slice(0, PER_RUN);
  // Five at a time: each call is well under a second, and the ticker has other businesses to get to.
  let n = 0;
  for (let i = 0; i < due.length; i += 5) {
    const done = await Promise.all(due.slice(i, i + 5).map((r) => scoreLead(tenantId, r.id).catch(() => null)));
    n += done.filter(Boolean).length;
  }
  return n;
}

/** Scores for a set of leads, for Adonis's lead tools. */
export function scoresFor(tenantId: number, ids: number[]): Map<number, { score: number; next: string | null }> {
  if (!ids.length) return new Map();
  const rows = getTenantDbById(tenantId)
    .select({ id: leads.id, score: leads.leadScore, next: leads.leadNextStep })
    .from(leads)
    .where(and(inArray(leads.id, ids), sql`${leads.leadScore} is not null`))
    .all();
  return new Map(rows.map((r) => [r.id, { score: r.score!, next: r.next }]));
}
