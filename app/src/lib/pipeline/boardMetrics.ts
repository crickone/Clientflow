/**
 * Pure derivations for the leads pipeline board — NO `import "server-only"`, no
 * DB, no env (mirrors humanName.ts / webhook.ts), so it loads under the plain-tsx
 * test runner. The server wrapper (metrics.ts) injects `now` + DB rows; this file
 * is the fully-tested logic.
 */
import type { PipelineStage } from "./stages";

export const SLA_AMBER_MS = 15 * 60 * 1000; // 900000
export const SLA_RED_MS = 60 * 60 * 1000; // 3600000
export const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 604800000

export type SlaTone = "neutral" | "amber" | "red";

/** Colour tone for how long an uncontacted lead has been waiting for a first reply. */
export function slaTone(waitingMs: number): SlaTone {
  if (waitingMs > SLA_RED_MS) return "red";
  if (waitingMs >= SLA_AMBER_MS) return "amber";
  return "neutral";
}

const STALE_SUPPRESSED: ReadonlySet<PipelineStage> = new Set<PipelineStage>([
  "sale",
  "repeat_customer",
  "lost",
]);

/** True when a card has sat in one stage > 7 days — except won/lost stages, where staleness is meaningless. */
export function isStale(msInStage: number, stage: PipelineStage): boolean {
  if (STALE_SUPPRESSED.has(stage)) return false;
  return msInStage > STALE_MS;
}
