import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { clientGoals } from "@/lib/db/schema";
import { getScanProfile, listClientScans, type ScanView } from "@/lib/inbody/scans";
import { recommend, recommendAll, type ActivityKey, type GoalKey, type GoalTarget } from "@/lib/goalsModel";

/** A client's goal from their InBody scan, for the CURRENT tenant (ambient `db`). */

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

/** The client's latest scan with numbers, only when they've turned scans on in the app. */
export function latestScanForGoal(clientId: number): ScanView | null {
  if (!getScanProfile(clientId).consentAt) return null;
  return listClientScans(clientId).find((s) => Object.keys(s.metrics).length > 0) ?? null;
}

export interface GoalOptions {
  scan: ScanView;
  activity: ActivityKey;
  targets: Record<GoalKey, GoalTarget>;
}

/** The three options from the latest scan at a given activity, or null without a usable scan. */
export function goalOptions(clientId: number, activity: ActivityKey): GoalOptions | null {
  const scan = latestScanForGoal(clientId);
  if (!scan) return null;
  const targets = recommendAll(scan.metrics, activity);
  return targets ? { scan, activity, targets } : null;
}

/** The chosen goal's target from the latest scan, or null when no goal is set or the scan can't price it. */
export function goalTarget(clientId: number): { goal: ClientGoal; target: GoalTarget; scan: ScanView } | null {
  const goal = getGoal(clientId);
  if (!goal) return null;
  const scan = latestScanForGoal(clientId);
  if (!scan) return null;
  const target = recommend(scan.metrics, goal.goal, goal.activity);
  return target ? { goal, target, scan } : null;
}
