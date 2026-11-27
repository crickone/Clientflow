import "server-only";
import { and, desc, eq, inArray, isNotNull, like, or, sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { automationQueue, leadMessages, leads, pipelineStages, type Lead, type LeadMessage } from "./db/schema";
import type { MessageMedia } from "./inbox/mediaModel";
import { normalizePhone } from "./whatsapp/phone";
import { splitFullName } from "./humanName";
import { resolveEntryStageId } from "./pipeline/stageRepo";
import { recordStageEvent, type StageActor } from "./pipeline/stageEvents";
import { defaultPipelineId, getPipeline, listPipelines } from "./pipeline/pipelineRepo";
import { enrolLeadInNurture, enrolLeadInSequence, sequenceEnabled } from "./automations/nurture";
import { getCurrentTenantDb } from "./db/tenant";
import { getCallFlow } from "./voice/flow";
import { enqueueCall } from "./voice/queue";
import type { StageRole } from "./pipeline/roles";
import { notifyNewLead } from "./notifications/notify";
import { setLeadMarketingConsent } from "./leadFlows/consent";
import { defaultAssigneeForNewLead } from "./leadFlows/assignment";
import { alertNewLead } from "./leadFlows/alerts";
import type { ConsentSource } from "./leadFlows/consentModel";

export type LeadStatus = "new" | "contacted" | "replied" | "booked" | "lost";

import type { Arrival } from "@/lib/arrival";

export interface NormalizedLeadInput {
  source?: string;
  sourceLeadId?: string | null;
  campaign?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  therapyInterest?: string | null;
  /** They agreed to marketing on the form or in the integration that sent them; how. Omitted = not asked. */
  marketingConsent?: ConsentSource | null;
  notes?: string | null;
  rawPayload?: unknown;
  /** How they arrived the visit they got in touch (lib/arrival.ts). Kept on create only. */
  arrival?: Arrival | null;
  /** The board the lead enters. Omitted = the default pipeline. */
  pipelineId?: number | null;
  /** Who created the lead, for the stage history. Omitted = system. */
  actor?: StageActor;
  /**
   * Only in the Inbox: a direct message from someone new. Stored off the
   * board, with no stage, no follow-ups, no call and no new-lead alert, until
   * someone adds them as a lead (addToPipeline).
   */
  inboxOnly?: boolean;
}

/**
 * Idempotent lead intake. If `(source, sourceLeadId)` already exists we don't
 * create a duplicate — we just return the existing one. This is what makes
 * the same Zapier event firing twice a no-op.
 */
export function upsertLead(input: NormalizedLeadInput): {
  lead: Lead;
  created: boolean;
} {
  const source = input.source?.trim() || "manual";
  const sourceLeadId = input.sourceLeadId?.trim() || null;

  // When no explicit first name is given but a single `fullName` is, split it
  // server-side — so an integration (Zapier/Make/Facebook) can send one "Full
  // name" field instead of splitting it in every scenario. An explicit
  // firstName always wins.
  let firstName = input.firstName;
  let lastName = input.lastName;
  if (!nz(firstName) && nz(input.fullName)) {
    const split = splitFullName(input.fullName);
    firstName = split.firstName;
    lastName = split.lastName;
  }

  if (sourceLeadId) {
    const existing = db
      .select()
      .from(leads)
      .where(and(eq(leads.source, source), eq(leads.sourceLeadId, sourceLeadId)))
      .get();
    if (existing) {
      if (input.marketingConsent && existing.marketingConsentAt == null) recordIntakeConsent(existing.id, input.marketingConsent, { liftUnsubscribe: false });
      return { lead: existing, created: false };
    }
  }

  // A lead lands on the board it was asked for (a campaign's own pipeline,
  // from its landing page) or on the default board. An id that names no
  // board falls back to the default rather than stranding the lead on a
  // board that does not exist.
  const requestedPipeline = input.pipelineId ?? null;
  const pipelineId =
    requestedPipeline != null && getPipeline(requestedPipeline) ? requestedPipeline : defaultPipelineId();

  const inserted = db
    .insert(leads)
    .values({
      source,
      sourceLeadId,
      campaign: nz(input.campaign),
      firstName: nz(firstName),
      lastName: nz(lastName),
      email: nz(input.email),
      phone: nz(input.phone),
      therapyInterest: nz(input.therapyInterest),
      notes: nz(input.notes),
      rawPayload: input.rawPayload ? JSON.stringify(input.rawPayload) : null,
      arrival: input.arrival ? JSON.stringify(input.arrival) : null,
      assignedUserId: input.inboxOnly ? null : defaultAssigneeForNewLead(),
      pipelineId,
      stageId: input.inboxOnly ? undefined : resolveEntryStageId(pipelineId) ?? undefined,
      inboxOnly: input.inboxOnly === true,
    })
    .returning()
    .all();
  const lead = inserted[0];
  if (input.marketingConsent) recordIntakeConsent(lead.id, input.marketingConsent);
  if (!lead.inboxOnly) welcomeLead(lead, input.actor);
  return { lead, created: true };
}

/**
 * What a lead gets the moment it is on the board: its first stage in the
 * history, the call flow, its follow-up sequence, and the team told.
 */
function welcomeLead(lead: Lead, actor?: StageActor): void {
  if (lead.stageId != null) {
    recordStageEvent(db, { leadId: lead.id, pipelineId: lead.pipelineId, fromStageId: null, toStageId: lead.stageId, actor: actor ?? "system" });
  }
  enrolInCallFlow(lead);
  enrolInNurture(lead);
  // Tell the team (not for a lead that came in on a message, which already
  // notified, or one a staff member typed in). Never throws.
  notifyNewLead(lead, actor);
  // The assignee's own alert and the WhatsApp alert (lib/leadFlows/alerts). Never throws.
  alertNewLead(lead, actor);
}

/** True when the lead is only an Inbox conversation, not on the board. */
export function isInboxOnly(leadId: number): boolean {
  return db.select({ v: leads.inboxOnly }).from(leads).where(eq(leads.id, leadId)).get()?.v === true;
}

/** Leads on the board: everyone except Inbox-only conversations. For any query that counts or lists leads. */
export const onBoard = eq(leads.inboxOnly, false);

/**
 * Put an Inbox-only conversation on the board as a lead: on its board's first
 * column (or the column it was in before it was taken off), with a new
 * lead's welcome. Safe to call twice: a lead already on the board is left as it is.
 */
export function addToPipeline(leadId: number, actor: StageActor = "user"): { lead: Lead; added: boolean } | null {
  const cur = db.select().from(leads).where(eq(leads.id, leadId)).get();
  if (!cur) return null;
  if (!cur.inboxOnly) return { lead: cur, added: false };
  const pipelineId = getPipeline(cur.pipelineId) ? cur.pipelineId : defaultPipelineId();
  const stageId = cur.stageId ?? resolveEntryStageId(pipelineId) ?? null;
  const [lead] = db
    .update(leads)
    .set({ inboxOnly: false, pipelineId, stageId, assignedUserId: cur.assignedUserId ?? defaultAssigneeForNewLead(), createdAt: cur.stageId == null ? new Date() : cur.createdAt, updatedAt: new Date() })
    .where(eq(leads.id, leadId))
    .returning()
    .all();
  // A card taken off the board and put back keeps its history; a new one is welcomed.
  if (cur.stageId == null) welcomeLead(lead, actor);
  return { lead, added: true };
}

/**
 * Start the campaign nurture sequence for a lead that came in on a campaign.
 * Same shape and reasoning as enrolInCallFlow below: every source of a lead
 * funnels through upsertLead, and the sequence is the SAME for every
 * campaign, so the one place to start it is here. Only leads with a campaign
 * qualify -- a walk-in added by hand is not in a campaign funnel. Fail-soft:
 * the lead is the money path, the follow-up is not.
 */
function enrolInNurture(lead: Lead): void {
  try {
    // A campaign landing-page sign-up has its own sequence; a buyer is a
    // customer, not a lead to chase.
    if (lead.source === "landing") return void enrolLeadInNurture(lead);
    // A buyer is a customer; an unfinished checkout has its own sequence
    // (lib/offers/fulfil.ts recoverAbandonedCheckout).
    if (lead.source === "offer" || lead.source === "checkout") return;
    // An enquiry (website form, Facebook lead ad, a public form, or a lead
    // posted in with a campaign) gets the New lead sequence when the business
    // has switched it on, and the campaign sequence as before when not. A
    // walk-in typed in by hand is neither, so nothing is sent to them.
    const enquiry = ["website", "facebook", "form"].includes(lead.source ?? "") || Boolean(lead.campaign);
    if (!enquiry) return;
    if (sequenceEnabled("new_lead")) enrolLeadInSequence(lead, "new_lead");
    else if (lead.campaign) enrolLeadInNurture(lead);
  } catch (err) {
    console.error(`[leads] nurture enrolment failed for lead #${lead.id}:`, err);
  }
}

/**
 * Hand a brand-new lead to the voice call flow, if this tenant has armed one.
 *
 * Here rather than at each caller because EVERY source of a new lead — the
 * inbound API, Facebook lead ads, the manual form — funnels through
 * `upsertLead`, and a source that quietly skipped enrolment would look like the
 * dialler was broken. Only ever called on the CREATE path: re-posting an
 * existing lead returns early above and must not re-queue a call.
 *
 * Fail-soft on purpose. Lead capture is the money path; a voice-queue problem
 * (a locked DB, a bad config) must never cost the tenant the lead itself.
 */
function enrolInCallFlow(lead: Lead): void {
  try {
    const flow = getCallFlow();
    if (!flow.enabled) return;
    if (!lead.phone || lead.doNotCall) return;
    enqueueCall(
      getCurrentTenantDb(),
      lead.id,
      Date.now() + flow.triggerDelayMinutes * 60_000,
    );
  } catch (err) {
    console.error("[voice] could not enrol a new lead in the call flow:", err);
  }
}

/** Fail-soft: a consent problem never costs the lead. */
function recordIntakeConsent(leadId: number, source: ConsentSource, options?: { liftUnsubscribe?: boolean }): void {
  try {
    setLeadMarketingConsent(leadId, true, source, options);
  } catch (err) {
    console.error(`[leads] marketing consent not recorded for lead #${leadId}:`, err);
  }
}

function nz(v: string | null | undefined) {
  if (v == null) return null;
  const s = v.trim();
  return s ? s : null;
}

export function listLeads(opts: {
  q?: string;
  status?: LeadStatus | "all";
} = {}) {
  const { q, status = "all" } = opts;
  const where: (SQL | undefined)[] = [onBoard];
  if (status !== "all") where.push(eq(leads.status, status));
  if (q) {
    const like_ = `%${q.toLowerCase()}%`;
    where.push(
      or(
        like(sql`lower(coalesce(${leads.firstName}, '') || ' ' || coalesce(${leads.lastName}, ''))`, like_),
        like(sql`lower(coalesce(${leads.email}, ''))`, like_),
        like(sql`coalesce(${leads.phone}, '')`, `%${q}%`),
        like(sql`lower(coalesce(${leads.therapyInterest}, ''))`, like_),
        like(sql`lower(coalesce(${leads.campaign}, ''))`, like_),
      ),
    );
  }
  return db
    .select()
    .from(leads)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(leads.createdAt))
    .all();
}

export function getLead(id: number) {
  return db.select().from(leads).where(eq(leads.id, id)).get();
}

export function getLeadMessages(leadId: number): LeadMessage[] {
  return db
    .select()
    .from(leadMessages)
    .where(eq(leadMessages.leadId, leadId))
    .orderBy(leadMessages.createdAt)
    .all();
}

export function addMessage(input: {
  leadId: number;
  direction: "outbound" | "inbound" | "note";
  channel?: "email" | "sms" | "whatsapp" | "messenger" | "instagram" | "call" | "manual" | "system" | null;
  content: string;
  aiGenerated?: boolean;
  providerMessageId?: string | null;
  status?: "queued" | "sent" | "delivered" | "read" | "failed" | null;
  sentAt?: Date | null;
  /** Files sent or received with it, stored as the media JSON. */
  media?: MessageMedia[] | null;
  /** Why it did not go, on a failed outbound row. */
  error?: string | null;
}) {
  return db
    .insert(leadMessages)
    .values({
      leadId: input.leadId,
      direction: input.direction,
      channel: input.channel ?? null,
      content: input.content,
      aiGenerated: input.aiGenerated ?? false,
      providerMessageId: input.providerMessageId ?? null,
      status: input.status ?? null,
      sentAt: input.sentAt ?? null,
      media: input.media?.length ? JSON.stringify(input.media) : null,
      error: input.error ?? null,
    })
    .returning()
    .all()[0];
}

/** Find a lead message by its provider message id (for status webhooks). */
export function findLeadMessageByProviderId(providerMessageId: string) {
  return db
    .select()
    .from(leadMessages)
    .where(eq(leadMessages.providerMessageId, providerMessageId))
    .get();
}

export function setLeadMessageStatus(
  id: number,
  status: "queued" | "sent" | "delivered" | "read" | "failed",
) {
  db.update(leadMessages).set({ status }).where(eq(leadMessages.id, id)).run();
}

/** Find a lead by normalized phone match (for inbound routing). */
/**
 * The lead a phone number belongs to. When one person has several cards, the
 * one on the board wins over an Inbox-only conversation, then the newest, so
 * their messages land where staff are working with them.
 */
export function findLeadByPhone(normalized: string): Lead | undefined {
  if (!normalized) return undefined;
  const rows = db.select().from(leads).where(sql`${leads.phone} IS NOT NULL`).orderBy(leads.inboxOnly, desc(leads.id)).all();
  return rows.find((l) => normalizePhone(l.phone) === normalized);
}

export function setLeadStatus(id: number, status: LeadStatus) {
  db.update(leads)
    .set({ status, updatedAt: new Date() })
    .where(eq(leads.id, id))
    .run();
}

/**
 * Fill a lead's name, email or phone only where it is still empty: details
 * read later (a form answer in a DM, a profile lookup that finally worked)
 * never overwrite what the lead or a staff member already set. True when
 * something was filled.
 */
export function fillLeadContact(leadId: number, d: { firstName?: string | null; lastName?: string | null; email?: string | null; phone?: string | null }): boolean {
  const cur = db.select({ firstName: leads.firstName, lastName: leads.lastName, email: leads.email, phone: leads.phone }).from(leads).where(eq(leads.id, leadId)).get();
  if (!cur) return false;
  const set: Partial<{ firstName: string; lastName: string; email: string; phone: string }> = {};
  const empty = (v: string | null) => !v || !v.trim();
  // A name is filled as a pair: a lead that has a first name keeps its own last name too.
  if (empty(cur.firstName) && empty(cur.lastName) && d.firstName) {
    set.firstName = d.firstName;
    if (d.lastName) set.lastName = d.lastName;
  }
  if (empty(cur.email) && d.email) set.email = d.email;
  if (empty(cur.phone) && d.phone) set.phone = d.phone;
  if (Object.keys(set).length === 0) return false;
  db.update(leads).set({ ...set, updatedAt: new Date() }).where(eq(leads.id, leadId)).run();
  return true;
}

/** Append a line to a lead's notes — a repeat enquiry from the same contact adds to the one card rather than being dropped. */
export function appendLeadNotes(leadId: number, line: string): void {
  const existing = db.select({ notes: leads.notes }).from(leads).where(eq(leads.id, leadId)).get();
  const notes = existing?.notes ? `${existing.notes}\n${line}` : line;
  db.update(leads).set({ notes, updatedAt: new Date() }).where(eq(leads.id, leadId)).run();
}

export function leadCounts() {
  const rows = db
    .select({
      status: leads.status,
      n: sql<number>`count(*)`,
    })
    .from(leads)
    .groupBy(leads.status)
    .all();
  const out: Record<LeadStatus | "all", number> = {
    all: 0,
    new: 0,
    contacted: 0,
    replied: 0,
    booked: 0,
    lost: 0,
  };
  for (const r of rows) {
    out[r.status as LeadStatus] = r.n;
    out.all += r.n;
  }
  return out;
}

/**
 * Tenant-scoped count of leads attributed to one campaign — `leads.campaign`
 * is a free-text label (see upsertLead above), and the public campaign
 * signup flow (@/lib/campaigns/signup + /api/campaigns/signup) writes it as
 * exactly `campaign.name` (never the slug), so callers must pass that same
 * string (the campaign hub detail page does: `countLeadsByCampaign(campaign
 * .name)`). Campaign Engine Slice 2, Task 4 — the hub's "N sign-ups so far"
 * stat.
 */
export function countLeadsByCampaign(campaign: string): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(leads)
      .where(eq(leads.campaign, campaign))
      .get()?.n ?? 0
  );
}

/**
 * Cheap COUNT of leads currently sitting in the pipeline's entry stage (where
 * fresh leads land — see resolveEntryStageId) — i.e. new/unworked leads.
 * Powers the sidebar's Leads nav badge; two small per-tenant queries (stage
 * list + a single indexed-by-FK count), safe to run on every page load.
 */
export function countLeadsInEntryStage(): number {
  // Each board has its own entry stage; a campaign's new sign-ups count too.
  const entryIds = listPipelines()
    .map((p) => resolveEntryStageId(p.id))
    .filter((id): id is number => id != null);
  if (entryIds.length === 0) return 0;
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(leads)
      .where(inArray(leads.stageId, entryIds))
      .get()?.n ?? 0
  );
}

/** A board lead: the full row plus the epoch-ms of its first *sent* outbound message (or null). */
export type LeadWithSla = Lead & {
  firstOutboundAt: number | null;
  /** Came in before the business started running leads here (setting lead_figures_since): no "waiting", not in the figures. */
  beforeFigures?: boolean;
  stage: { id: number; name: string; colour: string; position: number; role: StageRole | null } | null;
};

/**
 * All leads for the pipeline board, each with `firstOutboundAt` computed in a
 * single grouped left-join (no N+1). `firstOutboundAt` = MIN(sent_at) over that
 * lead's SENT outbound messages (drafts have null sent_at and are excluded).
 * A second left-join resolves each lead's `stage` (pipeline_stages row) —
 * null when a lead has no stage_id. Ordered newest-first; the board buckets
 * by stage client-side.
 */
export function listLeadsForBoard(pipelineId?: number): LeadWithSla[] {
  const firstOutbound = db
    .select({
      leadId: leadMessages.leadId,
      firstOutboundAt: sql<number>`min(${leadMessages.sentAt})`.as("first_outbound_at"),
    })
    .from(leadMessages)
    .where(and(eq(leadMessages.direction, "outbound"), isNotNull(leadMessages.sentAt)))
    .groupBy(leadMessages.leadId)
    .as("first_outbound");
  // A follow-up flow's message is contact too (they are not lead messages).
  const flowFirst = new Map(
    db
      .select({ leadId: automationQueue.leadId, at: sql<number>`min(${automationQueue.sentAt})` })
      .from(automationQueue)
      .where(and(eq(automationQueue.kind, "message"), eq(automationQueue.status, "sent"), isNotNull(automationQueue.sentAt), isNotNull(automationQueue.leadId)))
      .groupBy(automationQueue.leadId)
      .all()
      .map((r) => [r.leadId!, Number(r.at)]),
  );

  const rows = db
    .select({
      lead: leads,
      firstOutboundAt: firstOutbound.firstOutboundAt,
      sId: pipelineStages.id, sName: pipelineStages.name, sColour: pipelineStages.colour, sPos: pipelineStages.position, sRole: pipelineStages.role,
    })
    .from(leads)
    .leftJoin(firstOutbound, eq(firstOutbound.leadId, leads.id))
    .leftJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .where(pipelineId == null ? onBoard : and(onBoard, eq(leads.pipelineId, pipelineId)))
    .orderBy(desc(leads.createdAt))
    .all();

  return rows.map((r) => {
    const mine = r.firstOutboundAt ?? null;
    const flow = flowFirst.get(r.lead.id) ?? null;
    return {
    ...r.lead,
    firstOutboundAt: mine == null ? flow : flow == null ? mine : Math.min(mine, flow),
    stage: r.sId != null ? { id: r.sId, name: r.sName!, colour: r.sColour!, position: r.sPos!, role: (r.sRole as StageRole | null) } : null,
    };
  });
}
