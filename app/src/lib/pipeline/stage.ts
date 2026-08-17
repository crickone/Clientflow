import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/queries";
import { listStages, resolveStageIdByRole, resolveEntryStageId } from "./stageRepo";
import { shouldAdvance, ROLE_TO_LEGACY_KEY, roleOf, type StageRecord, type StageRole } from "./roles";

// Legacy re-exports kept until the contract task (Task 11); readers migrate off these.
export { STAGES, STAGE_ORDER, nextAutoStage } from "./stages";
export type { PipelineStage } from "./stages";
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
  const row = db.select({ stageId: schema.leads.stageId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!row) return null;
  const stages = listStages();
  if (row.stageId == null) {
    const entryId = resolveEntryStageId();
    return stages.find((s) => s.id === entryId) ?? null;
  }
  return stages.find((s) => s.id === row.stageId) ?? null;
}

/**
 * Canonical writer: set a lead's stage_id + dual-write the frozen pipeline_stage
 * text (from the stage's role → legacy key) so not-yet-migrated readers/tests keep
 * working during the transition. Logs an activity row.
 */
export function writeStageId(leadId: number, stageId: number, note: string): void {
  const stage = listStages().find((s) => s.id === stageId);
  const legacy = stage?.role ? ROLE_TO_LEGACY_KEY[stage.role] : undefined;
  db.update(schema.leads)
    .set({ stageId, ...(legacy ? { pipelineStage: legacy as typeof schema.leads.$inferInsert.pipelineStage } : {}), updatedAt: new Date() })
    .where(eq(schema.leads.id, leadId))
    .run();
  void logActivity("pipeline.stage", note, { leadId });
}

/**
 * Forward-only auto-advance to the tenant's stage tagged `role`. No-ops if the
 * lead is missing, the tenant has no stage for that role, or `shouldAdvance`
 * says no (lost frozen / lapsed pull-out / forward-only-by-position).
 */
export function advanceStage(leadId: number, role: StageRole): void {
  const cur = currentStageRecord(leadId);
  if (!cur) return;
  const targetId = resolveStageIdByRole(role);
  if (targetId == null) return; // this tenant doesn't use that role → automation off
  const stages = listStages();
  const candidate = stages.find((s) => s.id === targetId);
  if (!candidate) return;
  if (!shouldAdvance(cur, candidate)) return;
  writeStageId(leadId, candidate.id, `Lead moved to ${candidate.name}`);
}

/** Operator override — set ANY stage by id (drag / picker / agent), bypassing forward-only. */
export function setStageToId(leadId: number, stageId: number): void {
  const exists = db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!exists) return;
  const stage = listStages().find((s) => s.id === stageId);
  if (!stage) return;
  writeStageId(leadId, stageId, `Lead set to ${stage.name} (manual)`);
}

/** Legacy name-based manual override — kept for callers not yet migrated (leads/actions, tools.sales). */
export function setStageManual(leadId: number, stage: import("./stages").PipelineStage): void {
  const role = roleOf(stage);
  const id = role ? resolveStageIdByRole(role) : null;
  if (id != null) setStageToId(leadId, id);
}

export function leadIdForClient(clientId: number): number | null {
  const row = db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.clientId, clientId)).get();
  return row?.id ?? null;
}

/** Legacy name accessor — kept for tools.sales until Task 9. */
export function currentStage(leadId: number): import("./stages").PipelineStage | null {
  const rec = currentStageRecord(leadId);
  if (!rec?.role) return null;
  return ROLE_TO_LEGACY_KEY[rec.role] as import("./stages").PipelineStage;
}

// ── Event hooks (signatures UNCHANGED — call sites in appointments/packages/whatsapp untouched) ──
export function onInboundFromLead(leadId: number): void {
  advanceStage(leadId, "engaged");
}
export function onInboundFromClient(clientId: number): void {
  const leadId = leadIdForClient(clientId);
  if (leadId) advanceStage(leadId, "engaged");
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
export function onPaymentRecorded(clientId: number): void {
  const leadId = leadIdForClient(clientId);
  if (!leadId) return;
  const row = db.select({ n: sql<number>`count(*)` }).from(schema.payments).where(and(eq(schema.payments.clientId, clientId), gt(schema.payments.amountEur, 0))).get();
  const paid = Number(row?.n ?? 0);
  if (paid >= 2) advanceStage(leadId, "repeat");
  else if (paid >= 1) advanceStage(leadId, "won");
}
