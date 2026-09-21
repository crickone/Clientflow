import "server-only";
import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { resources, therapies, therapyResources } from "@/lib/db/schema";
import { demandFrom, mergeDemand, type Demand, type ResourceLimit } from "./resourceDemand";

/**
 * Loading side of the resource model: concurrency limits, and what each
 * therapy consumes.
 *
 * THE FALLBACK IS THE IMPORTANT PART. A therapy with no resource mapped —
 * added after the seeding migration, or by a tenant who has never opened the
 * settings — would otherwise consume nothing and therefore clash with
 * nothing, quietly turning a clinic's diary into a free-for-all. So an
 * unmapped therapy falls back to a virtual resource of its own at concurrency
 * 1, keyed by a NEGATIVE id so it can never collide with a real row. That is
 * precisely the old "one of each therapy at a time" rule, which means an
 * unconfigured tenant behaves exactly as it did before any of this existed.
 */

/** Virtual resource id for a therapy with no mapping of its own. Negative, so it cannot collide with a resources.id. */
const virtualResourceId = (therapyId: number) => -therapyId;

export function resourceLimits(): Map<number, ResourceLimit> {
  const rows = db
    .select({ id: resources.id, name: resources.name, concurrency: resources.concurrency })
    .from(resources)
    .where(eq(resources.isActive, true))
    .all();
  return new Map(rows.map((r) => [r.id, r]));
}

/** What one booking of these therapies consumes, together. */
export function demandForTherapies(therapyIds: number[]): Demand {
  if (therapyIds.length === 0) return new Map();

  const rows = db
    .select({
      therapyId: therapyResources.therapyId,
      resourceId: therapyResources.resourceId,
      units: therapyResources.units,
    })
    .from(therapyResources)
    .where(inArray(therapyResources.therapyId, therapyIds))
    .all();

  const mapped = new Set(rows.map((r) => r.therapyId));
  const unmapped = therapyIds.filter((id) => !mapped.has(id));

  return mergeDemand([
    demandFrom(rows),
    demandFrom(unmapped.map((id) => ({ resourceId: virtualResourceId(id), units: 1 }))),
  ]);
}

/**
 * Demand for many appointments at once, keyed by the JSON therapy_ids string
 * they carry. Appointments repeat the same therapy combinations constantly, so
 * this resolves each distinct combination once instead of per row.
 */
export function demandResolver(): (therapyIdsJson: string | null) => Demand {
  const cache = new Map<string, Demand>();
  return (json) => {
    const key = json || "[]";
    const hit = cache.get(key);
    if (hit) return hit;
    let ids: number[] = [];
    try {
      const parsed = JSON.parse(key);
      if (Array.isArray(parsed)) ids = parsed.filter((n) => Number.isFinite(n)).map(Number);
    } catch {
      ids = [];
    }
    const demand = demandForTherapies(ids);
    cache.set(key, demand);
    return demand;
  };
}

/**
 * Every resource id in play — real rows, plus a virtual one for each therapy
 * that has no mapping. A block-out has to occupy all of them, or closing the
 * place would still leave an unmapped therapy bookable.
 */
export function allResourceIds(): number[] {
  const real = db.select({ id: resources.id }).from(resources).where(eq(resources.isActive, true)).all().map((r) => r.id);
  const mapped = new Set(
    db.selectDistinct({ id: therapyResources.therapyId }).from(therapyResources).all().map((r) => r.id),
  );
  const virtual = db
    .select({ id: therapies.id })
    .from(therapies)
    .all()
    .filter((t) => !mapped.has(t.id))
    .map((t) => virtualResourceId(t.id));
  return [...real, ...virtual];
}

// ─── Editing (settings screen) ───────────────────────────────────────────────

export interface ResourceRow {
  id: number;
  name: string;
  kind: "space" | "equipment";
  concurrency: number;
  isActive: boolean;
  /** Therapy ids that consume this resource. */
  therapyIds: number[];
}

/** Every resource, active or not, with the therapies mapped onto it. */
export function listResources(): ResourceRow[] {
  const rows = db.select().from(resources).orderBy(resources.id).all();
  const links = db
    .select({ therapyId: therapyResources.therapyId, resourceId: therapyResources.resourceId })
    .from(therapyResources)
    .all();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    concurrency: r.concurrency,
    isActive: r.isActive,
    therapyIds: links.filter((l) => l.resourceId === r.id).map((l) => l.therapyId),
  }));
}

export function createResource(input: { name: string; kind: "space" | "equipment"; concurrency: number }): number {
  const inserted = db
    .insert(resources)
    .values({ name: input.name, kind: input.kind, concurrency: input.concurrency })
    .returning({ id: resources.id })
    .all();
  return inserted[0]!.id;
}

export function updateResource(
  id: number,
  patch: { name?: string; kind?: "space" | "equipment"; concurrency?: number; isActive?: boolean },
): void {
  db.update(resources).set({ ...patch, updatedAt: new Date() }).where(eq(resources.id, id)).run();
}

/** Removing a resource unmaps it too (FK cascade), so the therapies fall back to one-at-a-time. */
export function deleteResource(id: number): void {
  db.delete(resources).where(eq(resources.id, id)).run();
}

/**
 * Replace the set of therapies that use a resource.
 *
 * This is the screen's whole point: a clinic with four kinds of massage and
 * one table ticks all four against "Massage table", and they stop being four
 * independent things that can all be booked at 2pm.
 */
export function setResourceTherapies(resourceId: number, therapyIds: number[]): void {
  db.transaction((tx) => {
    tx.delete(therapyResources).where(eq(therapyResources.resourceId, resourceId)).run();
    for (const therapyId of therapyIds) {
      tx.insert(therapyResources).values({ therapyId, resourceId, units: 1 }).run();
    }
  });
}

/** Therapies with no resource at all — they fall back to a virtual one-at-a-time resource. */
export function unmappedTherapyIds(): number[] {
  const mapped = new Set(
    db.selectDistinct({ id: therapyResources.therapyId }).from(therapyResources).all().map((r) => r.id),
  );
  return db.select({ id: therapies.id }).from(therapies).all().map((t) => t.id).filter((id) => !mapped.has(id));
}
