import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/queries";
import { STAGES, nextAutoStage, type PipelineStage } from "./stages";

export { STAGES, STAGE_ORDER, nextAutoStage } from "./stages";
export type { PipelineStage } from "./stages";

export function currentStage(leadId: number): PipelineStage | null {
  const row = db
    .select({ s: schema.leads.pipelineStage })
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .get();
  return (row?.s as PipelineStage | undefined) ?? null;
}

function writeStage(leadId: number, stage: PipelineStage, note: string): void {
  db.update(schema.leads)
    .set({ pipelineStage: stage, updatedAt: new Date() })
    .where(eq(schema.leads.id, leadId))
    .run();
  void logActivity("pipeline.stage", note, { leadId });
}

/**
 * Forward-only auto-advance. No-ops if the lead is missing, is `lost`, or the
 * candidate is not strictly ahead of the current stage. Safe to call from event
 * hooks (idempotent — re-firing the same/earlier stage does nothing).
 */
export function advanceStage(leadId: number, candidate: PipelineStage): void {
  const cur = currentStage(leadId);
  if (cur === null) return;
  const next = nextAutoStage(cur, candidate);
  if (!next) return;
  writeStage(leadId, next, `Lead moved to ${STAGES[next].label}`);
}

/** Operator override — sets ANY stage (e.g. Lost, or correcting), bypassing forward-only. */
export function setStageManual(leadId: number, stage: PipelineStage): void {
  if (currentStage(leadId) === null) return;
  writeStage(leadId, stage, `Lead set to ${STAGES[stage].label} (manual)`);
}

/**
 * The originating lead for a client. Journey events that happen at the client
 * stage (booking, payment, attendance) resolve back to the lead via
 * `leads.clientId`. Returns null for walk-in clients with no originating lead.
 */
export function leadIdForClient(clientId: number): number | null {
  const row = db
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .where(eq(schema.leads.clientId, clientId))
    .get();
  return row?.id ?? null;
}

// --- Event hooks: thin, centralised entry points the app calls at each
//     journey milestone. All resolve to a lead and advance forward-only.

/** A lead sent an inbound message → hot lead. */
export function onInboundFromLead(leadId: number): void {
  advanceStage(leadId, "hot_lead");
}

/** A client sent an inbound message → resolve their lead → hot lead (usually a no-op for existing customers). */
export function onInboundFromClient(clientId: number): void {
  const leadId = leadIdForClient(clientId);
  if (leadId) advanceStage(leadId, "hot_lead");
}

/** An appointment was booked for a client → consultation booked (+ attended/no-show if created that way). */
export function onAppointmentBooked(clientId: number, status: string): void {
  const leadId = leadIdForClient(clientId);
  if (!leadId) return;
  advanceStage(leadId, "consultation_booked");
  if (status === "completed") advanceStage(leadId, "attended");
  else if (status === "no_show") advanceStage(leadId, "no_show");
}

/** An appointment's status changed → attended / no-show. */
export function onAppointmentStatus(appointmentId: number, status: string): void {
  if (status !== "completed" && status !== "no_show") return;
  const appt = db
    .select({ clientId: schema.appointments.clientId })
    .from(schema.appointments)
    .where(eq(schema.appointments.id, appointmentId))
    .get();
  if (!appt) return;
  const leadId = leadIdForClient(appt.clientId);
  if (!leadId) return;
  advanceStage(leadId, status === "completed" ? "attended" : "no_show");
}

/** A payment was recorded for a client → sale (their 1st) / repeat customer (2nd+). */
export function onPaymentRecorded(clientId: number): void {
  const leadId = leadIdForClient(clientId);
  if (!leadId) return;
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.payments)
    .where(
      and(eq(schema.payments.clientId, clientId), gt(schema.payments.amountEur, 0)),
    )
    .get();
  const paid = Number(row?.n ?? 0);
  if (paid >= 2) advanceStage(leadId, "repeat_customer");
  else if (paid >= 1) advanceStage(leadId, "sale");
}
