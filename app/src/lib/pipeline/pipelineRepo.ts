import "server-only";

import { asc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { TenantDb } from "@/lib/db/tenant";
import { DEFAULT_STAGES } from "./roles";

/**
 * Pipelines: one board per campaign, plus the default board everything else
 * lives on.
 *
 * Every stage and every lead carries a `pipeline_id`. Before pipelines
 * existed there was exactly one board, and it survives as pipeline 1, the
 * default (migration 0005 seeds the row; the columns default to 1). Every
 * call in `stageRepo` that used to mean "the stages" now means "the stages of
 * this pipeline", defaulting to the default pipeline, so a caller that never
 * heard of pipelines still gets the board it always got.
 *
 * A campaign's pipeline is created WITH the campaign (store.createCampaign)
 * and cloned from the default board's current stages -- names, colours,
 * roles, order -- so it opens looking like the board the operator already
 * uses, and the role-driven automations (entry stage, engaged, booked, won,
 * lapsed) work on it without any setup.
 */
export interface PipelineRecord {
  id: number;
  name: string;
  campaignId: number | null;
  isDefault: boolean;
}

const SELECT = {
  id: schema.pipelines.id,
  name: schema.pipelines.name,
  campaignId: schema.pipelines.campaignId,
  isDefault: schema.pipelines.isDefault,
} as const;

export function listPipelines(): PipelineRecord[] {
  return db.select(SELECT).from(schema.pipelines).orderBy(asc(schema.pipelines.id)).all();
}

export function listPipelinesOnConn(conn: TenantDb): PipelineRecord[] {
  return conn.select(SELECT).from(schema.pipelines).orderBy(asc(schema.pipelines.id)).all();
}

export function getPipeline(id: number): PipelineRecord | null {
  return db.select(SELECT).from(schema.pipelines).where(eq(schema.pipelines.id, id)).get() ?? null;
}

/**
 * The board a caller means when it names none. The row flagged default, else
 * the lowest id, else 1 -- the last is the value every pipeline_id column
 * defaults to, so it is right even on a database the migration has not
 * reached yet.
 */
export function defaultPipelineId(): number {
  return defaultOf(listPipelines());
}

export function defaultPipelineIdOnConn(conn: TenantDb): number {
  return defaultOf(listPipelinesOnConn(conn));
}

function defaultOf(rows: PipelineRecord[]): number {
  const flagged = rows.find((p) => p.isDefault);
  if (flagged) return flagged.id;
  if (rows.length > 0) return rows[0].id;
  return 1;
}

export function pipelineForCampaign(campaignId: number): PipelineRecord | null {
  return (
    db.select(SELECT).from(schema.pipelines).where(eq(schema.pipelines.campaignId, campaignId)).get() ?? null
  );
}

/** The board a lead is on, or null when there is no such lead. */
export function leadPipelineId(leadId: number): number | null {
  const row = db.select({ pipelineId: schema.leads.pipelineId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  return row?.pipelineId ?? null;
}

export function leadPipelineIdOnConn(conn: TenantDb, leadId: number): number | null {
  const row = conn.select({ pipelineId: schema.leads.pipelineId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  return row?.pipelineId ?? null;
}

/**
 * Create a board, cloning the default board's stages onto it. A tenant whose
 * default board somehow has no stages gets the nine canonical ones, so a new
 * pipeline is never an empty board that nothing can enter.
 */
export function createPipeline(input: { name: string; campaignId?: number | null }): PipelineRecord {
  const name = input.name.trim() || "Pipeline";
  return db.transaction((tx) => {
    const row = tx
      .insert(schema.pipelines)
      .values({ name, campaignId: input.campaignId ?? null, isDefault: false })
      .returning(SELECT)
      .get();

    const sourceId = defaultOf(tx.select(SELECT).from(schema.pipelines).orderBy(asc(schema.pipelines.id)).all().filter((p) => p.id !== row.id));
    const source = tx
      .select({
        name: schema.pipelineStages.name,
        colour: schema.pipelineStages.colour,
        position: schema.pipelineStages.position,
        role: schema.pipelineStages.role,
      })
      .from(schema.pipelineStages)
      .where(eq(schema.pipelineStages.pipelineId, sourceId))
      .orderBy(asc(schema.pipelineStages.position))
      .all();
    const template = source.length > 0 ? source : DEFAULT_STAGES;

    for (const s of template) {
      tx.insert(schema.pipelineStages)
        .values({ pipelineId: row.id, name: s.name, colour: s.colour, position: s.position, role: s.role })
        .run();
    }
    return row;
  });
}

/** Rename a board. The default board can be renamed too; only its flag is fixed. */
export function renamePipeline(id: number, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  db.update(schema.pipelines).set({ name: trimmed }).where(eq(schema.pipelines.id, id)).run();
}
