import "server-only";
import { asc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { TenantDb } from "@/lib/db/tenant";
import { resolveEntryStage, type StageRecord, type StageRole } from "./roles";

const SELECT = {
  id: schema.pipelineStages.id,
  name: schema.pipelineStages.name,
  colour: schema.pipelineStages.colour,
  position: schema.pipelineStages.position,
  role: schema.pipelineStages.role,
} as const;

function normalize(rows: Array<{ id: number; name: string; colour: string; position: number; role: string | null }>): StageRecord[] {
  return rows.map((r) => ({ ...r, role: (r.role as StageRole | null) }));
}

/** All stages for the current tenant, ordered by position (request-scoped). */
export function listStages(): StageRecord[] {
  return normalize(db.select(SELECT).from(schema.pipelineStages).orderBy(asc(schema.pipelineStages.position)).all());
}

/** Connection-based variant for the lapse job (no request context). */
export function listStagesOnConn(conn: TenantDb): StageRecord[] {
  return normalize(conn.select(SELECT).from(schema.pipelineStages).orderBy(asc(schema.pipelineStages.position)).all());
}

export function resolveStageIdByRole(role: StageRole): number | null {
  const row = db.select({ id: schema.pipelineStages.id }).from(schema.pipelineStages).where(eq(schema.pipelineStages.role, role)).get();
  return row?.id ?? null;
}
export function resolveStageIdByRoleOnConn(conn: TenantDb, role: StageRole): number | null {
  const row = conn.select({ id: schema.pipelineStages.id }).from(schema.pipelineStages).where(eq(schema.pipelineStages.role, role)).get();
  return row?.id ?? null;
}

export function resolveEntryStageId(): number | null {
  return resolveEntryStage(listStages())?.id ?? null;
}
export function resolveEntryStageIdOnConn(conn: TenantDb): number | null {
  return resolveEntryStage(listStagesOnConn(conn))?.id ?? null;
}

export function createStage(input: { name: string; colour: string; role: StageRole | null }): void {
  const maxPos = db.select({ p: schema.pipelineStages.position }).from(schema.pipelineStages).orderBy(asc(schema.pipelineStages.position)).all();
  const position = (maxPos.length ? Math.max(...maxPos.map((r) => r.p)) : -1) + 1;
  db.insert(schema.pipelineStages).values({ name: input.name, colour: input.colour, position, role: input.role }).run();
}

export function updateStage(id: number, patch: { name?: string; colour?: string; role?: StageRole | null }): void {
  db.update(schema.pipelineStages).set(patch).where(eq(schema.pipelineStages.id, id)).run();
}

/**
 * Persist a new order: positions become the index in `orderedIds`. Uses the
 * codebase's standard `db.transaction((tx) => …)` form (drizzle's better-sqlite3
 * `.transaction()` runs the callback synchronously against the passed `tx` and
 * returns its result directly — it is not the raw-better-sqlite3 "returns a
 * callable" form) so every position write commits atomically.
 */
export function reorderStages(orderedIds: number[]): void {
  db.transaction((tx) => {
    orderedIds.forEach((id, i) => {
      tx.update(schema.pipelineStages).set({ position: i }).where(eq(schema.pipelineStages.id, id)).run();
    });
  });
}

/** Move any leads on `id` to `moveToId`, then delete `id` — atomically. */
export function deleteStageWithMove(id: number, moveToId: number): void {
  db.transaction((tx) => {
    tx.update(schema.leads).set({ stageId: moveToId }).where(eq(schema.leads.stageId, id)).run();
    tx.delete(schema.pipelineStages).where(eq(schema.pipelineStages.id, id)).run();
  });
}
