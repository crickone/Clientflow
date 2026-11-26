import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/queries";
import { listStages, resolveStageIdByRole, resolveEntryStageId } from "./stageRepo";
import { leadPipelineId } from "./pipelineRepo";
import { recordStageEvent, type StageActor } from "./stageEvents";
import { KEEP_ON_REPLY } from "@/lib/automationModel";
import { alertHotLead } from "@/lib/leadFlows/alerts";
import { applyColumnEntry } from "@/lib/leadFlows/columnEntry";
import { stopFlows } from "@/lib/leadFlows/runs";
import { boundTenantId, getCurrentTenant, runWithTenant } from "@/lib/db/tenant";
import { EMAIL_MAX_AGE_MS } from "@/lib/notifications/model";
import { isPositiveReply } from "@/lib/leadFlows/flowPlan";
import { beginThinkingReplyCheck, queueThinkingNurtureMove, takeReplyCheck } from "@/lib/leadFlows/replies";
import { queueCrmStage } from "@/lib/facebook/capi";
import { reopensOnRepeatEnquiry, shouldAdvance, ROLE_TO_LEGACY_KEY, type StageRecord, type StageRole } from "./roles";

export type { StageRole } from "./roles";

/**
 * The lead's current stage record (id/position/role), or null if the lead is
 * missing. `leads.stage_id` has no DB default and nothing outside this task
 * populates it at insert time, so a lead that has never been explicitly
 * placed yet (freshly created, or pre-dating this feature and not yet
 * touched) reads back with `stage_id IS NULL` — falling back to the tenant's
 * entry stage there (rather than returning null) keeps that lead's EXISTENCE
 * distinguishable from a genuinely missing lead for legacy existence-checks
 * (tools.sales.ts's `currentStage(...) === null`), and lets the auto-advance
 * engine actually move brand-new leads forward instead of silently no-oping
 * on every hook until some other write happens to set stage_id first.
 */
export function currentStageRecord(leadId: number): StageRecord | null {
  const row = db.select({ stageId: schema.leads.stageId, pipelineId: schema.leads.pipelineId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!row) return null;
  // The lead's OWN board: the same stage name has a different id on every
  // pipeline, so resolving against the default board would move a campaign
  // lead onto a board it is not on.
  const stages = listStages(row.pipelineId);
  if (row.stageId == null) {
    const entryId = resolveEntryStageId(row.pipelineId);
    return stages.find((s) => s.id === entryId) ?? null;
  }
  return stages.find((s) => s.id === row.stageId) ?? null;
}

export interface StageWriteOptions {
  /** false: enter the column without starting its flow (Schedule a call starts its own). */
  startFlow?: boolean;
  /** Treat a write to the column the lead is already in as entering it again (Log a call). */
  reenter?: boolean;
}

/**
 * Canonical writer: set a lead's stage_id + dual-write the frozen pipeline_stage
 * text (from the stage's role → legacy key) so not-yet-migrated readers/tests keep
 * working during the transition. Logs an activity row.
 */
export function writeStageId(leadId: number, stageId: number, note: string, actor: StageActor = "system", opts: StageWriteOptions = {}): void {
  const before = db
    .select({ stageId: schema.leads.stageId, pipelineId: schema.leads.pipelineId, inboxOnly: schema.leads.inboxOnly })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .get();
  // An Inbox-only conversation is on no board: nothing moves it (lib/leads addToPipeline puts it on one).
  if (before?.inboxOnly) return;
  const pipelineId = leadPipelineId(leadId);
  const stage = pipelineId == null ? undefined : listStages(pipelineId).find((s) => s.id === stageId);
  const legacy = stage?.role ? ROLE_TO_LEGACY_KEY[stage.role] : undefined;
  db.update(schema.leads)
    .set({ stageId, ...(legacy ? { pipelineStage: legacy as typeof schema.leads.$inferInsert.pipelineStage } : {}), updatedAt: new Date() })
    .where(eq(schema.leads.id, leadId))
    .run();
  if (before) {
    recordStageEvent(db, { leadId, pipelineId: before.pipelineId, fromStageId: before.stageId ?? null, toStageId: stageId, actor });
  }
  // Lead follow-up flows (lib/leadFlows/columnEntry.ts): entering a column
  // can stop the flows a lead is in and start that column's own. A sale or a
  // write-off stops them all. Fail-soft: the move stands.
  if (stage && (before?.stageId !== stageId || opts.reenter)) {
    try {
      applyColumnEntry(leadId, stage, actor, { startFlow: opts.startFlow });
    } catch (err) {
      console.error(`[pipeline] follow-up flows for lead #${leadId} not updated:`, err);
    }
  }
  // A Facebook lead-ads lead that books, attends or buys: Meta is told, by
  // its own lead id, so lead ads learn which leads become customers
  // (lib/facebook/capi.ts). Once per lead and stage. Never breaks the move.
  if (stage?.role && before?.stageId !== stageId) {
    try {
      const lead = db.select({ source: schema.leads.source, sourceLeadId: schema.leads.sourceLeadId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
      if (lead) queueCrmStage(boundTenantId() ?? getCurrentTenant().id, lead, stage.role);
    } catch (err) {
      console.error(`[pipeline] conversion-lead event for lead #${leadId} not queued:`, err);
    }
  }
  void logActivity("pipeline.stage", note, { leadId });
}

/**
 * Forward-only auto-advance to the tenant's stage tagged `role`. No-ops if the
 * lead is missing, the tenant has no stage for that role, or `shouldAdvance`
 * says no (lost frozen / lapsed pull-out / forward-only-by-position).
 */
export function advanceStage(leadId: number, role: StageRole, reason?: string): boolean {
  const cur = currentStageRecord(leadId);
  if (!cur) return false;
  if (db.select({ v: schema.leads.inboxOnly }).from(schema.leads).where(eq(schema.leads.id, leadId)).get()?.v) return false;
  const pipelineId = leadPipelineId(leadId) ?? undefined;
  const targetId = resolveStageIdByRole(role, pipelineId);
  if (targetId == null) return false; // this board doesn't use that role → automation off
  const stages = listStages(pipelineId);
  const candidate = stages.find((s) => s.id === targetId);
  if (!candidate) return false;
  if (!shouldAdvance(cur, candidate)) return false;
  writeStageId(leadId, candidate.id, `Lead moved to ${candidate.name}${reason ? `: ${reason}` : ""}`, "automation");
  // The engaged ("Hot lead") stage says why the card is there.
  if (role === "engaged") db.update(schema.leads).set({ hotReason: reason ?? null }).where(eq(schema.leads.id, leadId)).run();
  return true;
}

/**
 * A lead showing intent to buy goes to the Hot lead stage, for either of two
 * reasons: they replied to us, or their score (lib/leadScore.ts) is 70 or
 * more. "Hot" on the board then means one thing, intent shown, whatever the
 * signal. Forward-only like every automatic move: a lead already booked,
 * attended or bought stays where it is.
 */
export const HOT_SCORE = 70;

export function hotReasonFromScore(score: number, nextStep: string | null | undefined, source?: string | null): string | null {
  if (score < HOT_SCORE) return null;
  // A lead made from an unfinished checkout didn't ask for anything: it
  // started paying for an offer and stopped. Say that, not "asked to book".
  if (source === "checkout") return "didn't finish paying";
  // The score's "book" bucket is "asked to book, start or pay", so the label
  // claims no more than that.
  return nextStep === "book" ? "ready to book or pay" : nextStep === "call" ? "keen to talk" : "showing intent";
}

/**
 * Bring a written-off lead back onto the board, at its own board's entry
 * stage. Called when the person themselves enquires again.
 *
 * Deliberately not `advanceStage`, which treats a `lost` stage as frozen so
 * no passive event can resurrect a dead lead; `reopensOnRepeatEnquiry` in
 * ./roles.ts carries that reasoning and decides which roles qualify.
 *
 * The legacy `leads.status` is reset alongside the stage. A lead can still be
 * marked lost that way from the leads list, and a reopen that left the status
 * reading "lost" would only half-reopen it.
 *
 * Nurture is NOT restarted here. Whatever was queued for this lead was
 * cancelled when they were written off, and what a reopened lead should be
 * sent is a copy decision the operator has not made.
 *
 * Returns true when something actually changed.
 */
export function reopenLostLead(leadId: number, note: string): boolean {
  const row = db
    .select({ status: schema.leads.status })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .get();
  if (!row) return false;

  let reopened = false;

  const cur = currentStageRecord(leadId);
  if (cur && reopensOnRepeatEnquiry(cur)) {
    const pipelineId = leadPipelineId(leadId) ?? undefined;
    const entryId = resolveEntryStageId(pipelineId);
    // An entry stage that IS the lost stage (a one-column board, say) would
    // make this a no-op write and a misleading activity line.
    if (entryId != null && entryId !== cur.id) {
      writeStageId(leadId, entryId, note, "system");
      reopened = true;
    }
  }

  if (row.status === "lost") {
    db.update(schema.leads).set({ status: "new", updatedAt: new Date() }).where(eq(schema.leads.id, leadId)).run();
    if (!reopened) void logActivity("pipeline.stage", note, { leadId });
    reopened = true;
  }

  return reopened;
}

/** Operator override — set ANY stage by id (drag / picker / agent), bypassing forward-only. */
export function setStageToId(leadId: number, stageId: number, actor: StageActor = "user", opts: StageWriteOptions = {}): void {
  const exists = db.select({ id: schema.leads.id, pipelineId: schema.leads.pipelineId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!exists) return;
  // A stage from another board is refused, not silently applied: the lead
  // would then show in no column of the board it is on.
  const stage = listStages(exists.pipelineId).find((s) => s.id === stageId);
  if (!stage) return;
  writeStageId(leadId, stageId, `Lead set to ${stage.name} (manual)`, actor, opts);
}

export function leadIdForClient(clientId: number): number | null {
  const row = db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.clientId, clientId)).get();
  return row?.id ?? null;
}

// ── Event hooks (signatures UNCHANGED — call sites in appointments/packages/whatsapp untouched) ──
/** What a lead said, when the caller has it (for the hot-lead alert and the Thinking about it check). */
export interface LeadReply {
  text: string;
  messageId?: number;
  channel?: string;
}

export function onInboundFromLead(leadId: number, reply?: LeadReply): void {
  // In Thinking about it (flow on), the reply is read by the inbox triage
  // before anything moves (lib/leadFlows/replies.ts).
  try {
    if (beginThinkingReplyCheck(leadId, currentStageRecord(leadId)?.systemKey === "thinking", reply)) return;
  } catch (err) {
    console.error(`[pipeline] reply check for lead #${leadId} not started:`, err);
  }
  // They replied: a person takes it from here, so the automatic nudges stop
  // (a booked call's confirmation and reminder carry on).
  try {
    stopFlows(leadId, "replied", { except: KEEP_ON_REPLY });
  } catch (err) {
    console.error(`[pipeline] could not stop follow-ups for lead #${leadId}:`, err);
  }
  // Hot now, and only now: the assignee and the alert number are told.
  if (advanceStage(leadId, "engaged", "replied")) alertHotLead(leadId, reply?.text ?? null);
}

/** The inbox triage has read a lead's message: settles a waiting Thinking about it reply check. */
export function onLeadReplyTriaged(leadId: number, messageId: number, triage: { category: string; priority?: string | null }): void {
  const check = takeReplyCheck(leadId, messageId);
  if (!check) return;
  resolveThinkingReply(leadId, check.text, isPositiveReply(triage));
}

/**
 * Act on a Thinking about it reply: a yes (wants to book or talk) makes a
 * hot lead and alerts; anything else moves them to Long-term nurture in 7
 * days. Nothing happens if they are no longer in the column.
 */
export function resolveThinkingReply(leadId: number, text: string, positive: boolean): void {
  if (currentStageRecord(leadId)?.systemKey !== "thinking") return;
  if (positive) {
    stopFlows(leadId, "replied: wants to book or talk", "all");
    if (advanceStage(leadId, "engaged", "replied")) alertHotLead(leadId, text || null);
    return;
  }
  queueThinkingNurtureMove(leadId);
}

/** A message dated further ahead than this is not treated as a reply (same bound as notifications/model.ts emailNotifies). */
const EMAIL_FUTURE_SKEW_MS = 5 * 60 * 1000;

/**
 * An email arrived from a lead's address (Gmail or IMAP sync): a reply like
 * any other, when it is recent (a first sync of old mail changes nothing).
 * Explicit tenant: the mail sync runs with no request.
 */
export function onLeadEmailReply(tenantId: number, fromEmail: string | null, at: Date | null, snippet: string | null): void {
  const email = (fromEmail ?? "").trim().toLowerCase();
  if (!email || !at) return;
  const age = Date.now() - at.getTime();
  // Too old (a first sync of old mail) or dated in the future (a bad clock
  // or a forged date): same bounds as notifications/model.ts emailNotifies.
  if (age > EMAIL_MAX_AGE_MS || age < -EMAIL_FUTURE_SKEW_MS) return;
  runWithTenant(tenantId, () => {
    const rows = db.select({ id: schema.leads.id }).from(schema.leads).where(sql`lower(${schema.leads.email}) = ${email}`).all();
    for (const r of rows) {
      try {
        onInboundFromLead(r.id, { text: snippet ?? "", channel: "email" });
      } catch (err) {
        console.error(`[pipeline] email reply for lead #${r.id} not handled:`, err);
      }
    }
  });
}
/**
 * A client replied. The lead linked to that client is treated exactly like a
 * lead replying: its flows stop and it becomes a Hot lead. `reply` carries the
 * text for the alert; pass `messageId` only when it is a LEAD message (a
 * client message id means nothing to the Thinking about it reply check).
 * Returns true when a lead is linked to the client (so the reply was handled).
 */
export function onInboundFromClient(clientId: number, reply?: LeadReply): boolean {
  const leadId = leadIdForClient(clientId);
  if (!leadId) return false;
  onInboundFromLead(leadId, reply);
  return true;
}
/** A fresh lead score: 70 or more moves the lead to Hot lead (forward-only). */
export function onLeadScored(leadId: number, score: number, nextStep: string | null | undefined): void {
  const source = db.select({ source: schema.leads.source }).from(schema.leads).where(eq(schema.leads.id, leadId)).get()?.source ?? null;
  const reason = hotReasonFromScore(score, nextStep, source);
  if (!reason) return;
  // A lead a person or a flow put in a follow-up column (No answer, Thinking
  // about it, ...) stays there while its flow runs: only a reply or a
  // booking pulls it out, never a score.
  if (currentStageRecord(leadId)?.systemKey) return;
  advanceStage(leadId, "engaged", reason);
}
export function onAppointmentBooked(clientId: number, status: string): void {
  const leadId = leadIdForClient(clientId);
  if (!leadId) return;
  advanceStage(leadId, "booked");
  if (status === "completed") advanceStage(leadId, "attended");
  else if (status === "no_show") advanceStage(leadId, "no_show");
}
export function onAppointmentStatus(appointmentId: number, status: string): void {
  if (status !== "completed" && status !== "no_show") return;
  const appt = db.select({ clientId: schema.appointments.clientId }).from(schema.appointments).where(eq(schema.appointments.id, appointmentId)).get();
  if (!appt) return;
  const leadId = leadIdForClient(appt.clientId);
  if (!leadId) return;
  advanceStage(leadId, status === "completed" ? "attended" : "no_show");
}
/** leadId: the card to move when the caller knows it (an online purchase); else the client's first lead. */
export function onPaymentRecorded(clientId: number, forLeadId?: number): void {
  const leadId = forLeadId ?? leadIdForClient(clientId);
  if (!leadId) return;
  const row = db.select({ n: sql<number>`count(*)` }).from(schema.payments).where(and(eq(schema.payments.clientId, clientId), gt(schema.payments.amountEur, 0))).get();
  const paid = Number(row?.n ?? 0);
  if (paid >= 2) advanceStage(leadId, "repeat");
  else if (paid >= 1) advanceStage(leadId, "won");
}
