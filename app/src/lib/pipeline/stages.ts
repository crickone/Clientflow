/**
 * Pure pipeline-stage vocabulary + transition logic. NO I/O and no server-only
 * imports, so it can be unit-tested in isolation and imported anywhere. The
 * DB-backed engine lives in ./stage.ts and builds on this.
 */

/** The single, mutually-exclusive customer-journey stage of a lead. */
export type PipelineStage =
  | "new_lead"
  | "hot_lead"
  | "consultation_booked"
  | "no_show"
  | "attended"
  | "sale"
  | "repeat_customer"
  | "lapsed"
  | "lost";

/**
 * Stage metadata. `rank` drives forward-only auto-advance on the main funnel.
 * `lapsed` and `lost` are out-of-band (rank 0): never auto-advance *targets*
 * (set by the lapse job / manual override), and any genuine forward event pulls
 * a lead back out of `lapsed`. `lost` is frozen against auto events.
 */
export const STAGES: Record<
  PipelineStage,
  { label: string; colourHex: string; rank: number }
> = {
  new_lead: { label: "New lead", colourHex: "#8b949e", rank: 10 },
  hot_lead: { label: "Hot lead", colourHex: "#ef5a24", rank: 20 },
  consultation_booked: { label: "Consultation booked", colourHex: "#3b82f6", rank: 30 },
  no_show: { label: "No-show", colourHex: "#d29922", rank: 35 },
  attended: { label: "Attended", colourHex: "#2ea043", rank: 40 },
  sale: { label: "Sale", colourHex: "#1f9d55", rank: 50 },
  repeat_customer: { label: "Repeat customer", colourHex: "#8a3fd1", rank: 60 },
  lapsed: { label: "Lapsed", colourHex: "#6e7681", rank: 0 },
  lost: { label: "Lost", colourHex: "#484f58", rank: 0 },
};

/** Display order for filters / pickers (funnel order, then branch states). */
export const STAGE_ORDER: PipelineStage[] = [
  "new_lead",
  "hot_lead",
  "consultation_booked",
  "no_show",
  "attended",
  "sale",
  "repeat_customer",
  "lapsed",
  "lost",
];

/**
 * PURE forward-only decision: the stage to set, or null for a no-op. Never
 * regresses; `lost` is frozen against auto events.
 */
export function nextAutoStage(
  current: PipelineStage,
  candidate: PipelineStage,
): PipelineStage | null {
  if (current === "lost") return null; // terminal — only manual moves it
  if (STAGES[candidate].rank <= STAGES[current].rank) return null;
  return candidate;
}
