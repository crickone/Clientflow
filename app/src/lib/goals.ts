import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientGoals, clientMeasurements } from "@/lib/db/schema";
import { getScanProfile, listClientScans, type ScanView } from "@/lib/inbody/scans";
import { bodyFromManual, recommend, recommendAll, type ActivityKey, type Body, type GoalKey, type GoalTarget, type ManualBody } from "@/lib/goalsModel";

/** A client's goal, from their InBody scan or the numbers they typed in, for the CURRENT tenant (ambient `db`). */

export interface ClientGoal {
  goal: GoalKey;
  activity: ActivityKey;
  setAt: number;
}

export function getGoal(clientId: number): ClientGoal | null {
  const r = db.select().from(clientGoals).where(eq(clientGoals.clientId, clientId)).get();
  return r ? { goal: r.goal, activity: r.activity, setAt: r.setAt } : null;
}

export function setGoal(clientId: number, goal: GoalKey, activity: ActivityKey): void {
  const setAt = Date.now();
  db.insert(clientGoals)
    .values({ clientId, goal, activity, setAt })
    .onConflictDoUpdate({ target: clientGoals.clientId, set: { goal, activity, setAt } })
    .run();
}

export function clearGoal(clientId: number): void {
  db.delete(clientGoals).where(eq(clientGoals.clientId, clientId)).run();
}

// ── the numbers a client typed in ──

export function getManualBody(clientId: number): (ManualBody & { enteredAt: number }) | null {
  const r = db.select().from(clientMeasurements).where(eq(clientMeasurements.clientId, clientId)).get();
  return r ? { weightKg: r.weightKg, heightCm: r.heightCm, age: r.age, sex: r.sex, pbf: r.pbf, enteredAt: r.enteredAt } : null;
}

export function setManualBody(clientId: number, m: ManualBody): void {
  const enteredAt = Date.now();
  const row = { weightKg: m.weightKg, heightCm: m.heightCm, age: m.age, sex: m.sex, pbf: m.pbf, enteredAt };
  db.insert(clientMeasurements)
    .values({ clientId, ...row })
    .onConflictDoUpdate({ target: clientMeasurements.clientId, set: row })
    .run();
}

// ── what the goal rests on ──

export type GoalBody = { source: "scan"; at: number; body: Body; scan: ScanView } | { source: "manual"; at: number; body: Body; manual: ManualBody };

/** The client's latest scan with numbers, only when they've turned scans on in the app. */
export function latestScanForGoal(clientId: number): ScanView | null {
  if (!getScanProfile(clientId).consentAt) return null;
  return listClientScans(clientId).find((s) => Object.keys(s.metrics).length > 0) ?? null;
}

/** A scan when there is one (it measures more), else the numbers they typed in, else null. */
export function bodyForGoal(clientId: number): GoalBody | null {
  const scan = latestScanForGoal(clientId);
  if (scan) return { source: "scan", at: scan.measuredAt, body: scan.metrics, scan };
  const manual = getManualBody(clientId);
  if (manual) return { source: "manual", at: manual.enteredAt, body: bodyFromManual(manual), manual };
  return null;
}

export interface GoalOptions {
  from: GoalBody;
  activity: ActivityKey;
  targets: Record<GoalKey, GoalTarget>;
}

/** The three options at a given activity, or null without usable numbers. */
export function goalOptions(clientId: number, activity: ActivityKey): GoalOptions | null {
  const from = bodyForGoal(clientId);
  if (!from) return null;
  const targets = recommendAll(from.body, activity);
  return targets ? { from, activity, targets } : null;
}

/** The chosen goal's target, or null when no goal is set or nothing can price it. */
export function goalTarget(clientId: number): { goal: ClientGoal; target: GoalTarget; from: GoalBody } | null {
  const goal = getGoal(clientId);
  if (!goal) return null;
  const from = bodyForGoal(clientId);
  if (!from) return null;
  const target = recommend(from.body, goal.goal, goal.activity);
  return target ? { goal, target, from } : null;
}
