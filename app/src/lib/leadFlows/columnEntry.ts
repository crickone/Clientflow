import "server-only";

import type { StageRecord } from "@/lib/pipeline/roles";
import type { StageActor } from "@/lib/pipeline/stageEvents";

import { flowForStage } from "./definitions";
import { columnEntryEffect } from "./flowPlan";
import { cancelCallRows, startFlow, stopFlows } from "./runs";

/**
 * What a lead entering a column does to its flows (lib/leadFlows/flowPlan
 * columnEntryEffect). Called by the one stage writer, lib/pipeline/stage.ts
 * writeStageId, after the move is saved.
 */
export function applyColumnEntry(leadId: number, stage: StageRecord, actor: StageActor, opts: { startFlow?: boolean } = {}): void {
  const effect = columnEntryEffect({ actor, role: stage.role, flowKey: flowForStage(stage), startFlow: opts.startFlow !== false });
  const why = actor === "user" || actor === "agent" ? `moved to ${stage.name} by a person` : `moved to ${stage.name}`;
  if (effect.stop !== "none") stopFlows(leadId, why, effect.stop);
  if (effect.cancelCallRows) cancelCallRows(leadId, why);
  if (effect.start) startFlow(leadId, effect.start);
}
