import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";

import { schema } from "@/lib/db";
import { getTenantDbById, type TenantDb } from "@/lib/db/tenant";
import type { AutomationQueueRow } from "@/lib/db/schema";
import { TRIGGER_LABELS } from "@/lib/automationModel";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";

/**
 * A flow's first WhatsApp could not be delivered: the card moves to Message
 * undelivered, and the rest of the flow goes by email when the lead has an
 * address (otherwise the WhatsApps stop). Called from the dispatch (the
 * send threw on a connected WhatsApp) and the WhatsApp webhook (a "failed"
 * delivery status). Runs in the ambient tenant (both callers bind it).
 */

const MARK = "Undelivered:";

/** Whether this row is its run's first WhatsApp message. */
export function isFirstWhatsAppOfRun(tdb: TenantDb, row: AutomationQueueRow): boolean {
  if (row.runId == null || row.step == null || row.channel !== "whatsapp" || row.kind !== "message") return false;
  const first = tdb
    .select({ step: schema.automationQueue.step })
    .from(schema.automationQueue)
    .where(and(eq(schema.automationQueue.runId, row.runId), eq(schema.automationQueue.kind, "message"), eq(schema.automationQueue.channel, "whatsapp")))
    .orderBy(asc(schema.automationQueue.step))
    .limit(1)
    .get();
  return first?.step === row.step;
}

export async function handleUndelivered(tenantId: number, row: AutomationQueueRow, reason: string): Promise<void> {
  const tdb = getTenantDbById(tenantId);
  if (row.leadId == null || !isFirstWhatsAppOfRun(tdb, row)) return;
  // Once per message: a webhook can report the same failure twice.
  const current = tdb.select({ error: schema.automationQueue.error }).from(schema.automationQueue).where(eq(schema.automationQueue.id, row.id)).get();
  if (current?.error?.startsWith(MARK)) return;
  tdb.update(schema.automationQueue).set({ status: "failed", error: `${MARK} ${reason}`.slice(0, 300) }).where(eq(schema.automationQueue.id, row.id)).run();

  const lead = tdb
    .select({ id: schema.leads.id, email: schema.leads.email, pipelineId: schema.leads.pipelineId, stageId: schema.leads.stageId })
    .from(schema.leads)
    .where(eq(schema.leads.id, row.leadId))
    .get();
  if (!lead) return;
  const label = TRIGGER_LABELS[row.triggerKey] ?? row.triggerKey;
  const business = getBusinessProfileForTenant(tenantId).businessName;

  const rest = tdb
    .select({ id: schema.automationQueue.id })
    .from(schema.automationQueue)
    .where(
      and(
        eq(schema.automationQueue.runId, row.runId!),
        eq(schema.automationQueue.status, "queued"),
        eq(schema.automationQueue.kind, "message"),
        eq(schema.automationQueue.channel, "whatsapp"),
      ),
    )
    .all()
    .map((r) => r.id);
  if (rest.length > 0) {
    if (lead.email) {
      tdb.update(schema.automationQueue)
        .set({ channel: "email", sendTo: lead.email, subject: `A message from ${business}` })
        .where(inArray(schema.automationQueue.id, rest))
        .run();
    } else {
      tdb.update(schema.automationQueue)
        .set({ status: "cancelled", error: "WhatsApp undelivered and no email address." })
        .where(inArray(schema.automationQueue.id, rest))
        .run();
    }
  }

  // Loaded here: the stage writer and leads import the flows.
  const { listStages } = await import("@/lib/pipeline/stageRepo");
  const target = listStages(lead.pipelineId).find((s) => s.systemKey === "undelivered");
  if (target && lead.stageId !== target.id) {
    const { writeStageId } = await import("@/lib/pipeline/stage");
    writeStageId(lead.id, target.id, `Lead moved to ${target.name}: the first WhatsApp of ${label} was not delivered`, "automation");
  }
  const { addMessage } = await import("@/lib/leads");
  addMessage({
    leadId: lead.id,
    direction: "note",
    channel: "system",
    content: lead.email
      ? `The first WhatsApp of the ${label} follow-up could not be delivered. The rest of it goes by email.`
      : `The first WhatsApp of the ${label} follow-up could not be delivered, and there is no email address, so its WhatsApps are stopped.`,
  });
}

/** The WhatsApp webhook reported a message as failed. */
export async function onWhatsAppDeliveryFailed(tenantId: number, providerMessageId: string): Promise<void> {
  const tdb = getTenantDbById(tenantId);
  const row = tdb.select().from(schema.automationQueue).where(eq(schema.automationQueue.providerMessageId, providerMessageId)).get();
  if (!row) return;
  await handleUndelivered(tenantId, row, "WhatsApp reported the message as failed.");
}
