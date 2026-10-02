import "server-only";

import type { TenantDb } from "@/lib/db/tenant";
import { schema } from "@/lib/db";

export type StageActor = "user" | "agent" | "automation" | "system";

/**
 * Append one stage move to lead_stage_events. Append-only and fail-soft: a
 * recorder problem is logged and swallowed, never failing the stage write
 * that triggered it. A same-stage write is not a move and is skipped.
 */
export function recordStageEvent(
  conn: TenantDb,
  ev: { leadId: number; pipelineId: number; fromStageId: number | null; toStageId: number; actor: StageActor },
): void {
  if (ev.fromStageId === ev.toStageId) return;
  try {
    conn.insert(schema.leadStageEvents).values(ev).run();
  } catch (err) {
    console.error("[recorder:stage_history] could not record stage event", err);
  }
}
