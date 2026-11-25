/**
 * The five follow-up columns the lead flows move cards between. Pure: no DB.
 *
 * They have no role (every role is taken by the nine default columns, and a
 * role is unique per board), so each carries a stable `system_key` instead.
 * Flows find "Long-term nurture" by that key on whichever board the lead is
 * on, whatever the operator has renamed the column to.
 */
import { OUT_OF_BAND, type StageRole } from "./roles";

export type FollowUpKey = "no_answer" | "call_back" | "thinking" | "nurture" | "undelivered";

export const FOLLOW_UP_KEYS: readonly FollowUpKey[] = ["no_answer", "call_back", "thinking", "nurture", "undelivered"];

export function isFollowUpKey(v: unknown): v is FollowUpKey {
  return typeof v === "string" && (FOLLOW_UP_KEYS as readonly string[]).includes(v);
}

export const FOLLOW_UP_COLUMNS: Record<FollowUpKey, { name: string; colour: string }> = {
  no_answer: { name: "No answer", colour: "#a371f7" },
  call_back: { name: "Call back later", colour: "#58a6ff" },
  thinking: { name: "Thinking about it", colour: "#e3b341" },
  nurture: { name: "Long-term nurture", colour: "#56d4dd" },
  undelivered: { name: "Message undelivered", colour: "#f85149" },
};

/** Worked straight after the first contact: next to Hot lead. */
const EARLY: FollowUpKey[] = ["no_answer", "call_back", "thinking"];
/** Where flows end up: before Lapsed and Lost. */
const LATE: FollowUpKey[] = ["nurture", "undelivered"];

export interface ColumnSlot {
  id: number;
  position: number;
  role: StageRole | null;
  systemKey: FollowUpKey | null;
}

export interface FollowUpPlan {
  inserts: { key: FollowUpKey; name: string; colour: string; position: number }[];
  /** Existing columns whose position changes so the new ones fit. Relative order is kept. */
  moves: { id: number; position: number }[];
}

type Slot = { kind: "stage"; s: ColumnSlot } | { kind: "new"; key: FollowUpKey };

/**
 * Where the missing follow-up columns go on one board: No answer, Call back
 * later and Thinking about it right after Hot lead (or after New lead, or
 * first); Long-term nurture and Message undelivered right before the first
 * Lapsed or Lost column (or last). Positions come out as 0..n-1.
 */
export function planFollowUpColumns(stages: ColumnSlot[]): FollowUpPlan {
  const have = new Set(stages.map((s) => s.systemKey).filter((k): k is FollowUpKey => k != null));
  const early = EARLY.filter((k) => !have.has(k));
  const late = LATE.filter((k) => !have.has(k));
  if (early.length === 0 && late.length === 0) return { inserts: [], moves: [] };

  const ordered: Slot[] = [...stages]
    .sort((a, b) => a.position - b.position || a.id - b.id)
    .map((s) => ({ kind: "stage", s }));

  let after = ordered.findIndex((x) => x.kind === "stage" && x.s.role === "engaged");
  if (after < 0) after = ordered.findIndex((x) => x.kind === "stage" && x.s.role === "new");
  ordered.splice(after + 1, 0, ...early.map((key): Slot => ({ kind: "new", key })));

  let before = ordered.findIndex((x) => x.kind === "stage" && x.s.role != null && OUT_OF_BAND.has(x.s.role));
  if (before < 0) before = ordered.length;
  ordered.splice(before, 0, ...late.map((key): Slot => ({ kind: "new", key })));

  const plan: FollowUpPlan = { inserts: [], moves: [] };
  ordered.forEach((x, position) => {
    if (x.kind === "new") plan.inserts.push({ key: x.key, ...FOLLOW_UP_COLUMNS[x.key], position });
    else if (x.s.position !== position) plan.moves.push({ id: x.s.id, position });
  });
  return plan;
}
