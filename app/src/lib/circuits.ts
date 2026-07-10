import "server-only";

import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { circuitItems, circuits } from "@/lib/db/schema";
import type { CircuitInput } from "@/lib/workoutModel";

function parseTags(csv: string | null): string[] {
  if (!csv) return [];
  return csv.split(",").map((t) => t.trim()).filter(Boolean);
}

export interface CircuitListRow {
  id: number;
  name: string;
  tags: string[];
  rounds: number;
  exerciseCount: number;
  createdAt: number;
  updatedAt: number;
}

export function listCircuits(): CircuitListRow[] {
  const rows = db.select().from(circuits).orderBy(desc(circuits.updatedAt)).all();
  if (rows.length === 0) return [];
  const ids = rows.map((c) => c.id);
  const items = db
    .select({ id: circuitItems.id, circuitId: circuitItems.circuitId })
    .from(circuitItems)
    .where(inArray(circuitItems.circuitId, ids))
    .all();
  const countBy = new Map<number, number>();
  for (const it of items) countBy.set(it.circuitId, (countBy.get(it.circuitId) ?? 0) + 1);
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    tags: parseTags(c.tags),
    rounds: c.rounds,
    exerciseCount: countBy.get(c.id) ?? 0,
    createdAt: c.createdAt.getTime(),
    updatedAt: c.updatedAt.getTime(),
  }));
}

export function getCircuit(id: number): CircuitInput | null {
  const c = db.select().from(circuits).where(eq(circuits.id, id)).get();
  if (!c) return null;
  const items = db
    .select()
    .from(circuitItems)
    .where(eq(circuitItems.circuitId, id))
    .orderBy(asc(circuitItems.position))
    .all();
  return {
    id: c.id,
    name: c.name,
    tags: parseTags(c.tags),
    rounds: c.rounds,
    restBetweenSeconds: c.restBetweenSeconds,
    instructions: c.instructions,
    exercises: items.map((it) => ({
      id: it.id,
      exerciseId: it.exerciseId,
      section: "workout" as const,
      name: it.name,
      sets: it.sets,
      reps: it.reps,
      restSeconds: it.restSeconds,
      notes: it.notes,
      muscleGroups: parseTags(it.muscleGroups),
    })),
  };
}

export function saveCircuit(input: CircuitInput): number {
  return db.transaction((tx) => {
    const base = {
      name: input.name.trim() || "New Circuit",
      tags: input.tags.map((t) => t.trim()).filter(Boolean).join(",") || null,
      rounds: input.rounds,
      restBetweenSeconds: input.restBetweenSeconds,
      instructions: input.instructions,
      updatedAt: new Date(),
    };
    let circuitId = input.id ?? 0;
    if (circuitId) {
      tx.update(circuits).set(base).where(eq(circuits.id, circuitId)).run();
      tx.delete(circuitItems).where(eq(circuitItems.circuitId, circuitId)).run();
    } else {
      const [row] = tx.insert(circuits).values(base).returning({ id: circuits.id }).all();
      circuitId = row.id;
    }
    input.exercises.forEach((ex, xi) => {
      if (!ex.name.trim()) return;
      tx.insert(circuitItems)
        .values({
          circuitId,
          exerciseId: ex.exerciseId,
          name: ex.name.trim(),
          position: xi,
          sets: ex.sets,
          reps: ex.reps,
          restSeconds: ex.restSeconds,
          notes: ex.notes,
          muscleGroups: ex.muscleGroups.map((g) => g.trim()).filter(Boolean).join(",") || null,
        })
        .run();
    });
    return circuitId;
  });
}

export function deleteCircuit(id: number) {
  db.delete(circuits).where(eq(circuits.id, id)).run();
}

export function duplicateCircuit(id: number): number | null {
  const c = getCircuit(id);
  if (!c) return null;
  return saveCircuit({ ...c, id: undefined, name: `${c.name} (copy)` });
}
