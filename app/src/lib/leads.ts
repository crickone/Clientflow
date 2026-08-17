import "server-only";
import { and, desc, eq, isNotNull, like, or, sql } from "drizzle-orm";
import { db } from "./db";
import { leadMessages, leads, pipelineStages, type Lead, type LeadMessage } from "./db/schema";
import { normalizePhone } from "./whatsapp/phone";
import { splitFullName } from "./humanName";
import { resolveEntryStageId } from "./pipeline/stageRepo";
import type { StageRole } from "./pipeline/roles";

export type LeadStatus = "new" | "contacted" | "replied" | "booked" | "lost";

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
  notes?: string | null;
  rawPayload?: unknown;
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
    if (existing) return { lead: existing, created: false };
  }

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
      stageId: resolveEntryStageId() ?? undefined,
    })
    .returning()
    .all();
  return { lead: inserted[0], created: true };
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
  const where = [];
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
  channel?: "email" | "sms" | "whatsapp" | "call" | "manual" | "system" | null;
  content: string;
  aiGenerated?: boolean;
  providerMessageId?: string | null;
  status?: "queued" | "sent" | "delivered" | "read" | "failed" | null;
  sentAt?: Date | null;
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
export function findLeadByPhone(normalized: string): Lead | undefined {
  if (!normalized) return undefined;
  const rows = db.select().from(leads).where(sql`${leads.phone} IS NOT NULL`).all();
  return rows.find((l) => normalizePhone(l.phone) === normalized);
}

export function setLeadStatus(id: number, status: LeadStatus) {
  db.update(leads)
    .set({ status, updatedAt: new Date() })
    .where(eq(leads.id, id))
    .run();
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

/** A board lead: the full row plus the epoch-ms of its first *sent* outbound message (or null). */
export type LeadWithSla = Lead & {
  firstOutboundAt: number | null;
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
export function listLeadsForBoard(): LeadWithSla[] {
  const firstOutbound = db
    .select({
      leadId: leadMessages.leadId,
      firstOutboundAt: sql<number>`min(${leadMessages.sentAt})`.as("first_outbound_at"),
    })
    .from(leadMessages)
    .where(and(eq(leadMessages.direction, "outbound"), isNotNull(leadMessages.sentAt)))
    .groupBy(leadMessages.leadId)
    .as("first_outbound");

  const rows = db
    .select({
      lead: leads,
      firstOutboundAt: firstOutbound.firstOutboundAt,
      sId: pipelineStages.id, sName: pipelineStages.name, sColour: pipelineStages.colour, sPos: pipelineStages.position, sRole: pipelineStages.role,
    })
    .from(leads)
    .leftJoin(firstOutbound, eq(firstOutbound.leadId, leads.id))
    .leftJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .orderBy(desc(leads.createdAt))
    .all();

  return rows.map((r) => ({
    ...r.lead,
    firstOutboundAt: r.firstOutboundAt ?? null,
    stage: r.sId != null ? { id: r.sId, name: r.sName!, colour: r.sColour!, position: r.sPos!, role: (r.sRole as StageRole | null) } : null,
  }));
}
