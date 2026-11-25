import "server-only";

import { eq, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { listAssignableStaff } from "@/lib/leadFlows/assignment";
import { getFlowDefinition } from "@/lib/leadFlows/definitions";
import { CALL_BOOKED_FLOW, LEAD_FLOW_KEYS } from "@/lib/leadFlows/flowModel";
import { getLeadFlowSettings } from "@/lib/leadFlows/settings";
import { defaultPipelineId } from "@/lib/pipeline/pipelineRepo";
import { listStages } from "@/lib/pipeline/stageRepo";

import type { Snapshot } from "./plan";

/** This business, as the GoHighLevel planner needs it. Ambient tenant. Reads only. */
export function loadSnapshot(tenantId: number): Snapshot {
  const pipelineId = defaultPipelineId();
  const lastStage = new Map<number, number>();
  for (const r of db
    .select({ leadId: schema.leadStageEvents.leadId, at: sql<number>`max(${schema.leadStageEvents.at})` })
    .from(schema.leadStageEvents)
    .groupBy(schema.leadStageEvents.leadId)
    .all()) {
    lastStage.set(r.leadId, Number(r.at));
  }
  const inFlow = new Set(
    db.select({ leadId: schema.leadFlowRuns.leadId }).from(schema.leadFlowRuns).where(eq(schema.leadFlowRuns.status, "active")).all().map((r) => r.leadId),
  );
  const lower = (s: string | null) => (s ?? "").trim().toLowerCase() || null;
  const settings = getLeadFlowSettings();
  return {
    pipelineId,
    importedContactIds: new Set(db.select({ id: schema.ghlImportPeople.ghlContactId }).from(schema.ghlImportPeople).all().map((r) => r.id)),
    leads: db
      .select({
        id: schema.leads.id,
        email: schema.leads.email,
        phone: schema.leads.phone,
        clientId: schema.leads.clientId,
        pipelineId: schema.leads.pipelineId,
        therapyInterest: schema.leads.therapyInterest,
        marketingConsentAt: schema.leads.marketingConsentAt,
        createdAt: schema.leads.createdAt,
      })
      .from(schema.leads)
      .all()
      .map((l) => ({ ...l, email: lower(l.email), lastStageAt: lastStage.get(l.id) ?? l.createdAt.getTime(), inActiveFlow: inFlow.has(l.id) })),
    clients: db
      .select({ id: schema.clients.id, email: schema.clients.email, phone: schema.clients.phone })
      .from(schema.clients)
      .all()
      .map((c) => ({ ...c, email: lower(c.email) })),
    contactEmails: new Set(db.select({ email: schema.contacts.email }).from(schema.contacts).all().map((r) => r.email.trim().toLowerCase())),
    suppressedEmails: new Set(db.select({ email: schema.suppressions.email }).from(schema.suppressions).all().map((r) => r.email.trim().toLowerCase())),
    columns: listStages(pipelineId).map((s) => ({ id: s.id, name: s.name, role: s.role, systemKey: s.systemKey ?? null, position: s.position })),
    flows: LEAD_FLOW_KEYS.filter((k) => k !== CALL_BOOKED_FLOW).map((k) => {
      const d = getFlowDefinition(k);
      return {
        key: d.key,
        label: d.label,
        enabled: d.enabled,
        messages: d.messages.map((m) => ({ channel: m.channel, delayMs: m.delayMs, matchInterest: m.matchInterest })),
        startColumn: d.startColumn,
        finish: d.finish,
      };
    }),
    staff: listAssignableStaff(tenantId).map((s) => ({ userId: s.userId, name: s.name })),
    defaultAssigneeUserId: settings.defaultAssigneeUserId,
    window: settings.window,
  };
}
