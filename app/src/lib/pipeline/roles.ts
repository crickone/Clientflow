/**
 * Pure pipeline ROLE model (Pipeline Management). Stages themselves are now
 * per-tenant DB rows (schema.pipelineStages); this file holds the fixed role
 * vocabulary those stages are tagged with, the seed defaults, the legacy
 * name→role map for the one-time backfill, and the pure advancement decision.
 * NO `server-only`, no DB — loads under the plain-tsx test runner (mirrors
 * boardMetrics.ts / humanName.ts).
 */

export type StageRole =
  | "new"
  | "engaged"
  | "booked"
  | "no_show"
  | "attended"
  | "won"
  | "repeat"
  | "lapsed"
  | "lost";

export const ALL_ROLES: StageRole[] = [
  "new", "engaged", "booked", "no_show", "attended", "won", "repeat", "lapsed", "lost",
];

/** The two out-of-band roles (today's rank:0): not ordered by position for advancement. */
export const OUT_OF_BAND: ReadonlySet<StageRole> = new Set<StageRole>(["lapsed", "lost"]);

// Role sets consumed by boardMetrics (Task 7).
export const WON_ROLES: ReadonlySet<StageRole> = new Set<StageRole>(["won", "repeat"]);
export const INACTIVE_ROLES: ReadonlySet<StageRole> = new Set<StageRole>(["won", "repeat", "lost"]);
export const STALE_SUPPRESSED_ROLES: ReadonlySet<StageRole> = new Set<StageRole>(["won", "repeat", "lost"]);

/** The 9 canonical stages seeded for every tenant — matches today's STAGES record verbatim. */
export const DEFAULT_STAGES: { name: string; colour: string; position: number; role: StageRole }[] = [
  { name: "New lead", colour: "#8b949e", position: 0, role: "new" },
  { name: "Hot lead", colour: "#ef5a24", position: 1, role: "engaged" },
  { name: "Consultation booked", colour: "#3b82f6", position: 2, role: "booked" },
  { name: "No-show", colour: "#d29922", position: 3, role: "no_show" },
  { name: "Attended", colour: "#2ea043", position: 4, role: "attended" },
  { name: "Sale", colour: "#1f9d55", position: 5, role: "won" },
  { name: "Repeat customer", colour: "#8a3fd1", position: 6, role: "repeat" },
  { name: "Lapsed", colour: "#6e7681", position: 7, role: "lapsed" },
  { name: "Lost", colour: "#484f58", position: 8, role: "lost" },
];

/** Old `leads.pipeline_stage` text value → role, for the one-time backfill. */
export const LEGACY_KEY_TO_ROLE: Record<string, StageRole> = {
  new_lead: "new",
  hot_lead: "engaged",
  consultation_booked: "booked",
  no_show: "no_show",
  attended: "attended",
  sale: "won",
  repeat_customer: "repeat",
  lapsed: "lapsed",
  lost: "lost",
};

/** Reverse: role → the legacy key the engine dual-writes into the frozen column during transition. */
export const ROLE_TO_LEGACY_KEY: Record<StageRole, string> = {
  new: "new_lead",
  engaged: "hot_lead",
  booked: "consultation_booked",
  no_show: "no_show",
  attended: "attended",
  won: "sale",
  repeat: "repeat_customer",
  lapsed: "lapsed",
  lost: "lost",
};

export function roleOf(legacyKey: string): StageRole | null {
  return LEGACY_KEY_TO_ROLE[legacyKey] ?? null;
}

/** Plain-English hints for the settings role dropdown. */
export const ROLE_HINTS: Record<StageRole, string> = {
  new: "New — where fresh leads land.",
  engaged: "Engaged — set automatically when a lead replies.",
  booked: "Booked — set when a consultation is booked.",
  no_show: "No-show — set when a booked lead doesn't attend.",
  attended: "Attended — set when a lead attends.",
  won: "Won — set on first payment.",
  repeat: "Repeat — set on a second payment.",
  lapsed: "Lapsed — set automatically after 90 days inactive.",
  lost: "Lost — a dead lead (never moved automatically).",
};

export interface StageLike {
  position: number;
  role: StageRole | null;
}

/**
 * PURE forward-only decision, role-aware. Mirrors today's rank semantics:
 *  - a `lost` current stage is frozen (no auto event moves it);
 *  - a `lapsed` current stage is pulled out by ANY forward funnel event
 *    (candidate must be a FUNNEL — non-out-of-band — role);
 *  - among funnel stages, advance only if candidate.position > current.position;
 *  - a candidate that is itself out-of-band (lapsed/lost) is never reached via
 *    this fn (the lapse job / manual override set those directly);
 *  - a null-role stage (manual-only) never auto-advances in or out.
 */
export function shouldAdvance(current: StageLike, candidate: StageLike): boolean {
  if (candidate.role == null || OUT_OF_BAND.has(candidate.role)) return false;
  if (current.role === "lost") return false;
  if (current.role === "lapsed") return true; // pull-out to any funnel stage
  if (current.role == null) return false;
  return candidate.position > current.position;
}

export interface StageRecord {
  id: number;
  name: string;
  colour: string;
  position: number;
  role: StageRole | null;
}

/** The stage new leads enter: the `role:new` stage, else the lowest position, else null. */
export function resolveEntryStage(stages: StageRecord[]): StageRecord | null {
  if (stages.length === 0) return null;
  const byRole = stages.find((s) => s.role === "new");
  if (byRole) return byRole;
  return stages.reduce((lo, s) => (s.position < lo.position ? s : lo));
}

/** Guard: a pipeline must always keep ≥1 stage. */
export function canDeleteStage(stages: StageRecord[], id: number): { ok: true } | { ok: false; reason: string } {
  if (stages.length <= 1) return { ok: false, reason: "A pipeline needs at least one stage." };
  return { ok: true };
}

/** The stage currently holding `role` (other than `exceptId`), or null — for the unique-role guard. */
export function roleConflict(stages: StageRecord[], role: StageRole, exceptId: number | null): StageRecord | null {
  return stages.find((s) => s.role === role && s.id !== exceptId) ?? null;
}
