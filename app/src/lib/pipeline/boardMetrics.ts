/**
 * Pure derivations for the leads pipeline board — NO `import "server-only"`, no
 * DB, no env (mirrors humanName.ts / webhook.ts), so it loads under the plain-tsx
 * test runner. The server wrapper (metrics.ts) injects `now` + DB rows; this file
 * is the fully-tested logic.
 */
import { WON_ROLES, INACTIVE_ROLES, STALE_SUPPRESSED_ROLES, type StageRole } from "./roles";

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

/** True when a card has sat in one stage > 7 days — except won/repeat/lost stages, where staleness is meaningless. */
export function isStale(msInStage: number, role: StageRole | null): boolean {
  if (role != null && STALE_SUPPRESSED_ROLES.has(role)) return false;
  return msInStage > STALE_MS;
}

export interface LeadMetricInput {
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  role: StageRole | null;
  firstOutboundAt: number | null; // epoch ms of first *sent* outbound, or null
}

export interface BoardMetrics {
  newThisWeek: number;
  newThisWeekDelta: number; // vs previous week (signed)
  avgSpeedToLeadMs: number | null; // mean first-response time over last 30d
  uncontactedNow: number;
  uncontactedBreaching: boolean; // any uncontacted active lead > 1h old
  conversionPct: number | null; // won / created over last 90d, 0..100
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start of the Monday-based week containing `now`, as epoch ms. */
export function startOfWeekMs(now: number): number {
  const d = new Date(now);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday-based (mirrors utils.startOfWeek)
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function computeBoardMetrics(leads: LeadMetricInput[], now: number): BoardMetrics {
  const weekStart = startOfWeekMs(now);
  const prevWeekStart = weekStart - 7 * DAY_MS;
  const cutoff30 = now - 30 * DAY_MS;
  const cutoff90 = now - 90 * DAY_MS;

  let newThisWeek = 0;
  let newPrevWeek = 0;
  let speedSum = 0;
  let speedCount = 0;
  let uncontactedNow = 0;
  let uncontactedBreaching = false;
  let created90 = 0;
  let won90 = 0;

  for (const l of leads) {
    if (l.createdAt >= weekStart) newThisWeek++;
    else if (l.createdAt >= prevWeekStart) newPrevWeek++;

    if (l.firstOutboundAt != null && l.createdAt >= cutoff30) {
      speedSum += l.firstOutboundAt - l.createdAt;
      speedCount++;
    }

    if (l.firstOutboundAt == null && (l.role == null || !INACTIVE_ROLES.has(l.role))) {
      uncontactedNow++;
      if (now - l.createdAt > SLA_RED_MS) uncontactedBreaching = true;
    }

    if (l.createdAt >= cutoff90) {
      created90++;
      if (l.role != null && WON_ROLES.has(l.role)) won90++;
    }
  }

  return {
    newThisWeek,
    newThisWeekDelta: newThisWeek - newPrevWeek,
    avgSpeedToLeadMs: speedCount ? Math.round(speedSum / speedCount) : null,
    uncontactedNow,
    uncontactedBreaching,
    conversionPct: created90 ? Math.round((won90 / created90) * 100) : null,
  };
}
