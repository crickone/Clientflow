import "server-only";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { getTenantDbById } from "@/lib/db/tenant";
import { ensureLeadContact } from "@/lib/leadFlows/consent";
import { placeImportedRun } from "@/lib/leadFlows/importedRuns";
import { stopFlows } from "@/lib/leadFlows/runs";
import { suppress } from "@/lib/marketing/suppress";
import { defaultPipelineId } from "@/lib/pipeline/pipelineRepo";
import { OUT_OF_BAND, ROLE_TO_LEGACY_KEY, type StageRecord } from "@/lib/pipeline/roles";
import { listStages } from "@/lib/pipeline/stageRepo";
import { logActivity } from "@/lib/queries";
import { cancelForLead } from "@/lib/voice/queue";

import { GHL_CONSENT_SOURCE, GHL_LEAD_SOURCE } from "./mapping";
import type { ImportPerson, ImportPlan, LeadAction, PersonPlan } from "./plan";
import type { ApplyResult } from "./types";

/**
 * Carry out a GoHighLevel plan (plan.ts). Ambient tenant.
 *
 * Every write is direct, on purpose: none of the lead helpers that alert
 * staff, enrol sequences, queue calls, score, or tell Meta is called
 * (upsertLead, writeStageId, startFlow, setLeadMarketingConsent). One
 * transaction per person; the import record goes in first, so a contact id
 * already there (another import, a double click) changes nothing.
 */

export const DNC_STATEMENT = "Do not contact: carried over from GoHighLevel.";
type Delta = Partial<Record<Exclude<keyof ApplyResult, "holdingCreated" | "errors">, number>>;

/** The board's Holding column, created before Lapsed and Lost when missing. */
export function ensureHoldingColumn(pipelineId: number): number {
  const stages = listStages(pipelineId);
  const found = stages.find((s) => s.role == null && s.systemKey == null && s.name.trim().toLowerCase() === "holding");
  if (found) return found.id;
  const ordered = [...stages].sort((a, b) => a.position - b.position);
  let at = ordered.findIndex((s) => s.role != null && OUT_OF_BAND.has(s.role));
  if (at < 0) at = ordered.length;
  return db.transaction((tx) => {
    ordered.forEach((s, i) => {
      const position = i < at ? i : i + 1;
      if (s.position !== position) tx.update(schema.pipelineStages).set({ position }).where(eq(schema.pipelineStages.id, s.id)).run();
    });
    return tx
      .insert(schema.pipelineStages)
      .values({ pipelineId, name: "Holding", colour: "#8b949e", position: at, role: null })
      .returning({ id: schema.pipelineStages.id })
      .get().id;
  });
}

const empty = (v: string | null | undefined) => !v || !v.trim();

function insertClient(p: ImportPerson, now: number): number {
  return db
    .insert(schema.clients)
    .values({
      firstName: p.firstName ?? p.lastName ?? "Unknown",
      lastName: p.firstName ? (p.lastName ?? "") : "",
      email: p.email,
      phone: p.phone ?? "",
      createdAt: new Date(p.createdAt ?? now),
      updatedAt: new Date(now),
    })
    .returning({ id: schema.clients.id })
    .get().id;
}

function fillClient(clientId: number, p: ImportPerson): void {
  const cur = db.select({ email: schema.clients.email, phone: schema.clients.phone }).from(schema.clients).where(eq(schema.clients.id, clientId)).get();
  if (!cur) return;
  const set: { email?: string; phone?: string } = {};
  if (empty(cur.email) && p.email) set.email = p.email;
  if (empty(cur.phone) && p.phone) set.phone = p.phone;
  if (Object.keys(set).length) db.update(schema.clients).set(set).where(eq(schema.clients.id, clientId)).run();
}

/** Empty fields only. Never bumps updated_at (that would set off a rescore). */
function fillLead(leadId: number, p: ImportPerson, assignee: number | null, clientId: number | null): void {
  const cur = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!cur) return;
  const set: Partial<typeof schema.leads.$inferInsert> = {};
  if (empty(cur.firstName) && empty(cur.lastName) && p.firstName) {
    set.firstName = p.firstName;
    if (p.lastName) set.lastName = p.lastName;
  }
  if (empty(cur.email) && p.email) set.email = p.email;
  if (empty(cur.phone) && p.phone) set.phone = p.phone;
  if (empty(cur.therapyInterest) && p.treatment) set.therapyInterest = p.treatment;
  if (empty(cur.notes) && p.notes) set.notes = p.notes;
  if (cur.assignedUserId == null && assignee != null) set.assignedUserId = assignee;
  if (cur.clientId == null && clientId != null) set.clientId = clientId;
  if (Object.keys(set).length) db.update(schema.leads).set(set).where(eq(schema.leads.id, leadId)).run();
}

function placeLead(p: ImportPerson, a: Extract<LeadAction, { mode: "place" }>, stage: StageRecord, clientId: number | null, pipelineId: number, now: number): number {
  const legacy = stage.role ? (ROLE_TO_LEGACY_KEY[stage.role] as typeof schema.leads.$inferInsert.pipelineStage) : undefined;
  let leadId: number;
  let fromStageId: number | null = null;
  if (a.existingId != null) {
    leadId = a.existingId;
    fromStageId = db.select({ stageId: schema.leads.stageId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get()?.stageId ?? null;
    fillLead(leadId, p, a.assigneeUserId, clientId);
    db.update(schema.leads)
      .set({ stageId: stage.id, ...(legacy ? { pipelineStage: legacy } : {}), ...(a.lost ? { status: "lost" as const } : {}) })
      .where(eq(schema.leads.id, leadId))
      .run();
  } else {
    leadId = db
      .insert(schema.leads)
      .values({
        source: GHL_LEAD_SOURCE,
        sourceLeadId: p.ghlContactId,
        firstName: p.firstName,
        lastName: p.lastName,
        email: p.email,
        phone: p.phone,
        therapyInterest: p.treatment,
        notes: p.notes,
        assignedUserId: a.assigneeUserId,
        pipelineId,
        stageId: stage.id,
        ...(legacy ? { pipelineStage: legacy } : {}),
        status: a.lost ? "lost" : "new",
        clientId,
        createdAt: new Date(p.createdAt ?? now),
        updatedAt: new Date(now),
      })
      .returning({ id: schema.leads.id })
      .get().id;
  }
  if (fromStageId !== stage.id) {
    db.insert(schema.leadStageEvents).values({ leadId, pipelineId, fromStageId, toStageId: stage.id, actor: "system", at: new Date(a.enteredAt) }).run();
  }
  if (a.consent) {
    db.update(schema.leads).set({ marketingConsentAt: now, marketingConsentSource: GHL_CONSENT_SOURCE }).where(eq(schema.leads.id, leadId)).run();
    if (p.email) ensureLeadContact(db, { email: p.email, firstName: p.firstName, lastName: p.lastName, phone: p.phone });
  }
  return leadId;
}

function markDoNotContact(tenantId: number, p: ImportPerson, leadId: number | null, clientId: number | null, now: number): void {
  if (leadId != null) {
    db.update(schema.leads).set({ doNotContact: true, doNotCall: true, marketingConsentAt: null, marketingConsentSource: null }).where(eq(schema.leads.id, leadId)).run();
    stopFlows(leadId, "do not contact (GoHighLevel)", "all");
    cancelForLead(getTenantDbById(tenantId), leadId, "Do not contact (GoHighLevel)");
  }
  if (clientId != null) {
    for (const channel of ["email", "sms"] as const) {
      db.insert(schema.clientConsents).values({ clientId, channel, granted: false, statement: DNC_STATEMENT, source: "staff", at: now }).run();
    }
  }
  if (p.email) suppress(tenantId, p.email, "manual");
}

function addContact(p: ImportPerson, now: number): number | null {
  if (!p.email) return null;
  const found = db.select({ id: schema.contacts.id }).from(schema.contacts).where(sql`lower(${schema.contacts.email}) = ${p.email}`).get();
  if (found) return null;
  const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim() || null;
  return db
    .insert(schema.contacts)
    .values({ email: p.email, name, phone: p.phone, tags: JSON.stringify(["gohighlevel"]), status: "subscribed", source: GHL_LEAD_SOURCE, subscribedAt: new Date(now) })
    .returning({ id: schema.contacts.id })
    .get().id;
}

function applyPerson(plan: PersonPlan, ctx: { tenantId: number; now: number }, pipelineId: number, stages: Map<number, StageRecord>, holdingId: number | null): Delta {
  const p = plan.person;
  const d: Delta = {};
  const inserted = db
    .insert(schema.ghlImportPeople)
    .values({
      ghlContactId: p.ghlContactId,
      ghlOpportunityId: p.ghlOpportunityId,
      outcome: plan.outcome,
      ghlStage: p.ghlStage,
      daysInStage: p.daysInStage,
      ghlSource: p.ghlSource,
      tags: JSON.stringify(p.tags),
      treatment: p.treatment,
      usedBefore: p.usedBefore,
      town: p.town,
      doNotContact: plan.doNotContact,
      importedAt: new Date(ctx.now),
    })
    .onConflictDoNothing()
    .run();
  if (inserted.changes === 0) return { alreadyImported: 1 };
  if (plan.outcome === "skip") return { skipped: 1 };

  let clientId: number | null = plan.match?.kind === "client" ? plan.match.id : null;
  if (plan.client) {
    if (plan.client.existingId != null) {
      clientId = plan.client.existingId;
      fillClient(clientId, p);
      d.clientsLinked = 1;
    } else {
      clientId = insertClient(p, ctx.now);
      d.clientsCreated = 1;
    }
  }

  let leadId: number | null = plan.match?.kind === "lead" ? plan.match.id : null;
  if (plan.lead?.mode === "fill") {
    leadId = plan.lead.existingId;
    fillLead(leadId, p, plan.lead.assigneeUserId, clientId);
    d.leadsUpdated = 1;
  } else if (plan.lead?.mode === "place") {
    const stage = stages.get(plan.lead.columnId ?? holdingId ?? -1);
    if (!stage) throw new Error("Its column is not on the board.");
    leadId = placeLead(p, plan.lead, stage, clientId, pipelineId, ctx.now);
    if (plan.lead.existingId != null) d.leadsUpdated = 1;
    else d.leadsCreated = 1;
  }

  if (plan.run && leadId != null && !plan.doNotContact) {
    const placed = placeImportedRun(
      leadId,
      { triggerKey: plan.run.flowKey, steps: plan.run.steps.map((s) => ({ step: s.step, dueAt: s.dueAt })), finishAt: plan.run.finishAt, emailOnly: plan.run.emailOnly },
      ctx.now,
    );
    if (placed.runId != null) {
      d.runsPlaced = 1;
      d.messagesQueued = placed.queued;
      if (placed.held) d.runsWaiting = 1;
    }
  }
  if (plan.doNotContact) {
    markDoNotContact(ctx.tenantId, p, leadId, clientId, ctx.now);
    d.doNotContact = 1;
  }
  const contactId = plan.contact ? addContact(p, ctx.now) : null;
  if (contactId != null) d.contactsAdded = 1;
  if (plan.outcome === "unchanged") d.unchanged = 1;

  // The links, and the staff-only medical note when a lead or client page can show it.
  db.update(schema.ghlImportPeople)
    .set({ leadId, clientId, contactId, staffMedicalNote: leadId != null || clientId != null ? p.staffMedicalNote : null })
    .where(eq(schema.ghlImportPeople.ghlContactId, p.ghlContactId))
    .run();
  return d;
}

export function applyPlan(plan: ImportPlan, ctx: { tenantId: number; now: number }): ApplyResult {
  const r: ApplyResult = {
    leadsCreated: 0,
    leadsUpdated: 0,
    clientsCreated: 0,
    clientsLinked: 0,
    contactsAdded: 0,
    doNotContact: 0,
    runsPlaced: 0,
    runsWaiting: 0,
    messagesQueued: 0,
    unchanged: 0,
    alreadyImported: 0,
    skipped: 0,
    failed: 0,
    holdingCreated: false,
    errors: [],
  };
  const pipelineId = defaultPipelineId();
  let holdingId: number | null = null;
  if (plan.people.some((p) => p.outcome !== "already_imported" && p.lead?.mode === "place" && p.lead.columnId == null)) {
    const before = listStages(pipelineId).length;
    holdingId = ensureHoldingColumn(pipelineId);
    r.holdingCreated = listStages(pipelineId).length > before;
  }
  const stages = new Map(listStages(pipelineId).map((s) => [s.id, s]));
  for (const p of plan.people) {
    if (p.outcome === "already_imported") {
      r.alreadyImported++;
      continue;
    }
    try {
      const d = db.transaction(() => applyPerson(p, ctx, pipelineId, stages, holdingId));
      for (const [k, v] of Object.entries(d) as [keyof Delta, number][]) r[k] += v;
    } catch (err) {
      r.failed++;
      if (r.errors.length < 20) r.errors.push(`GoHighLevel contact ${p.person.ghlContactId}: ${err instanceof Error ? err.message : "failed"}`);
    }
  }
  // A failed log must never surface, as a result or as an unhandled rejection.
  try {
    void Promise.resolve(
      logActivity(
        "import.gohighlevel",
        `GoHighLevel import: ${r.leadsCreated} new leads, ${r.leadsUpdated} updated, ${r.clientsCreated} new clients, ${r.contactsAdded} email contacts`,
        { ...r, errors: undefined },
      ),
    ).catch(() => undefined);
  } catch {
    // ignored
  }
  return r;
}
