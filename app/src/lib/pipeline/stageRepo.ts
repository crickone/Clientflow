import "server-only";

import { and, asc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { TenantDb } from "@/lib/db/tenant";
import { resolveEntryStage, type StageRecord, type StageRole } from "./roles";
import { defaultPipelineId, defaultPipelineIdOnConn } from "./pipelineRepo";

/**
 * The stages of ONE pipeline.
 *
 * Every read here is scoped to a board. The `pipelineId` argument defaults to
 * the tenant's default pipeline, which is the board that existed before
 * pipelines did -- so every caller written against the single-board world
 * keeps its meaning. A caller working a specific lead must pass that lead's
 * own pipeline (see pipelineRepo.leadPipelineId), or it will resolve a stage
 * on the wrong board: the ids differ per board even when the names match.
 */

const SELECT = {
  id: schema.pipelineStages.id,
  pipelineId: schema.pipelineStages.pipelineId,
  name: schema.pipelineStages.name,
  colour: schema.pipelineStages.colour,
  position: schema.pipelineStages.position,
  role: schema.pipelineStages.role,
} as const;

function normalize(
  rows: Array<{ id: number; pipelineId: number; name: string; colour: string; position: number; role: string | null }>,
): StageRecord[] {
  return rows.map((r) => ({ ...r, role: r.role as StageRole | null }));
}

export function listStages(pipelineId: number = defaultPipelineId()): StageRecord[] {
  return normalize(
    db.select(SELECT).from(schema.pipelineStages).where(eq(schema.pipelineStages.pipelineId, pipelineId)).orderBy(asc(schema.pipelineStages.position)).all(),
  );
}

export function listStagesOnConn(conn: TenantDb, pipelineId: number = defaultPipelineIdOnConn(conn)): StageRecord[] {
  return normalize(
    conn.select(SELECT).from(schema.pipelineStages).where(eq(schema.pipelineStages.pipelineId, pipelineId)).orderBy(asc(schema.pipelineStages.position)).all(),
  );
}

/** Every stage on every board -- for name lookups across a mixed list of leads. */
export function listAllStagesOnConn(conn: TenantDb): StageRecord[] {
  return normalize(conn.select(SELECT).from(schema.pipelineStages).orderBy(asc(schema.pipelineStages.pipelineId), asc(schema.pipelineStages.position)).all());
}

export function resolveStageIdByRole(role: StageRole, pipelineId: number = defaultPipelineId()): number | null {
  const row = db
    .select({ id: schema.pipelineStages.id })
    .from(schema.pipelineStages)
    .where(and(eq(schema.pipelineStages.pipelineId, pipelineId), eq(schema.pipelineStages.role, role)))
    .get();
  return row?.id ?? null;
}

export function resolveStageIdByRoleOnConn(conn: TenantDb, role: StageRole, pipelineId: number = defaultPipelineIdOnConn(conn)): number | null {
  const row = conn
    .select({ id: schema.pipelineStages.id })
    .from(schema.pipelineStages)
    .where(and(eq(schema.pipelineStages.pipelineId, pipelineId), eq(schema.pipelineStages.role, role)))
    .get();
  return row?.id ?? null;
}

/** The ids of every stage with this role, across all boards. */
export function stageIdsByRoleOnConn(conn: TenantDb, role: StageRole): number[] {
  return conn
    .select({ id: schema.pipelineStages.id })
    .from(schema.pipelineStages)
    .where(eq(schema.pipelineStages.role, role))
    .all()
    .map((r) => r.id);
}

export function resolveEntryStageId(pipelineId: number = defaultPipelineId()): number | null {
  return resolveEntryStage(listStages(pipelineId))?.id ?? null;
}

export function resolveEntryStageIdOnConn(conn: TenantDb, pipelineId: number = defaultPipelineIdOnConn(conn)): number | null {
  return resolveEntryStage(listStagesOnConn(conn, pipelineId))?.id ?? null;
}

export function createStage(input: { name: string; colour: string; role: StageRole | null; pipelineId?: number }): void {
  const pipelineId = input.pipelineId ?? defaultPipelineId();
  const maxPos = db
    .select({ p: schema.pipelineStages.position })
    .from(schema.pipelineStages)
    .where(eq(schema.pipelineStages.pipelineId, pipelineId))
    .orderBy(asc(schema.pipelineStages.position))
    .all();
  const position = (maxPos.length ? Math.max(...maxPos.map((r) => r.p)) : -1) + 1;
  db.insert(schema.pipelineStages).values({ pipelineId, name: input.name, colour: input.colour, position, role: input.role }).run();
}

export function updateStage(id: number, patch: { name?: string; colour?: string; role?: StageRole | null }): void {
  db.update(schema.pipelineStages).set(patch).where(eq(schema.pipelineStages.id, id)).run();
}

export function reorderStages(orderedIds: number[]): void {
  db.transaction((tx) => {
    orderedIds.forEach((id, i) => {
      tx.update(schema.pipelineStages).set({ position: i }).where(eq(schema.pipelineStages.id, id)).run();
    });
  });
}

export function deleteStageWithMove(id: number, moveToId: number): void {
  db.transaction((tx) => {
    tx.update(schema.leads).set({ stageId: moveToId }).where(eq(schema.leads.stageId, id)).run();
    tx.delete(schema.pipelineStages).where(eq(schema.pipelineStages.id, id)).run();
  });
}
