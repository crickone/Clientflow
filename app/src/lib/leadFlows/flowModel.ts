/**
 * The lead flows' vocabulary. Pure: no DB, no server-only.
 *
 * A flow is one of the lead entries of the automations catalog
 * (automationModel LEAD_SEQUENCE_KEYS). Some start when a lead enters a
 * column; some end by moving the card to another column. A column is named
 * by a column reference so the same flow works on every board:
 *   role:<role>       a column by its role ("role:booked")
 *   key:<system key>  a follow-up column ("key:nurture")
 *   stage:<id>        any other column, on its own board only
 */
import { LEAD_SEQUENCE_KEYS, type IntervalUnit } from "@/lib/automationModel";
import { isFollowUpKey, type FollowUpKey } from "@/lib/pipeline/followUpColumns";
import { ALL_ROLES, type StageRole } from "@/lib/pipeline/roles";

export const LEAD_FLOW_KEYS: readonly string[] = LEAD_SEQUENCE_KEYS;
export const LEAD_FLOW_KEY_SET: ReadonlySet<string> = new Set(LEAD_FLOW_KEYS);

export const NEW_LEAD_FLOW = "new_lead";
export const NO_ANSWER_FLOW = "lead_no_answer";
export const CALL_BACK_FLOW = "lead_call_back";
export const CALL_BOOKED_FLOW = "lead_call_booked";
export const THINKING_FLOW = "lead_thinking";
export const NURTURE_FLOW = "lead_nurture";

/** Queue rows for staff alerts sent as they happen (new lead, hot lead). No flow ever stops them. */
export const STAFF_ALERT_KEY = "alert";
/** Queue rows that belong to a scheduled call: its staff alerts and the call-back check. */
export const CALL_ALERT_KEY = "call_alert";

/** Triggers that are on by default (no automation_triggers row yet). Every new flow is off. */
export const DEFAULT_ENABLED_TRIGGERS: ReadonlySet<string> = new Set(["campaign_signup"]);

export function isTriggerEnabled(key: string, state: { enabled: boolean } | undefined | null): boolean {
  if (state) return state.enabled;
  return DEFAULT_ENABLED_TRIGGERS.has(key);
}

export type ColumnRef = string;

export interface ColumnLike {
  id: number;
  role: StageRole | null;
  systemKey?: FollowUpKey | null;
}

/** The reference a flow stores for a column: its role, else its follow-up key, else its id. */
export function columnRefFor(c: ColumnLike): ColumnRef {
  if (c.role) return `role:${c.role}`;
  if (c.systemKey) return `key:${c.systemKey}`;
  return `stage:${c.id}`;
}

function splitRef(ref: string): [string, string] | null {
  const i = ref.indexOf(":");
  if (i <= 0) return null;
  return [ref.slice(0, i), ref.slice(i + 1)];
}

export function isColumnRef(v: unknown): v is ColumnRef {
  if (typeof v !== "string") return false;
  const p = splitRef(v);
  if (!p) return false;
  const [kind, value] = p;
  if (kind === "role") return (ALL_ROLES as string[]).includes(value);
  if (kind === "key") return isFollowUpKey(value);
  if (kind === "stage") return /^[1-9]\d*$/.test(value);
  return false;
}

export function columnMatches(ref: ColumnRef, c: ColumnLike): boolean {
  const p = splitRef(ref);
  if (!p) return false;
  const [kind, value] = p;
  if (kind === "role") return c.role === value;
  if (kind === "key") return (c.systemKey ?? null) === value;
  if (kind === "stage") return String(c.id) === value;
  return false;
}

/** The column a reference names among one board's columns, or null when that board has none. */
export function resolveColumn<T extends ColumnLike>(ref: ColumnRef, columns: T[]): T | null {
  return columns.find((c) => columnMatches(ref, c)) ?? null;
}

export interface FlowDefaults {
  /** The column whose entry starts the flow; null = started by its fixed trigger. */
  startColumn: ColumnRef | null;
  /** Where the card goes when the flow ends with no reply; null = it stays put. */
  finishColumn: ColumnRef | null;
  /** When that move happens, counted from the start like the message delays. */
  finishAfter: { value: number; unit: IntervalUnit } | null;
}

const NONE: FlowDefaults = { startColumn: null, finishColumn: null, finishAfter: null };

/** What a flow does before an operator changes it in /automations. */
export const FLOW_DEFAULTS: Record<string, FlowDefaults> = {
  new_lead: { startColumn: null, finishColumn: "key:nurture", finishAfter: { value: 14, unit: "days" } },
  lead_no_answer: { startColumn: "key:no_answer", finishColumn: "key:nurture", finishAfter: { value: 4, unit: "days" } },
  lead_call_back: { startColumn: "key:call_back", finishColumn: "key:nurture", finishAfter: { value: 6, unit: "days" } },
  lead_call_booked: NONE,
  lead_thinking: { startColumn: "key:thinking", finishColumn: "key:nurture", finishAfter: { value: 17, unit: "days" } },
  lead_nurture: { startColumn: "key:nurture", finishColumn: null, finishAfter: null },
  lead_booked: { startColumn: "role:booked", finishColumn: null, finishAfter: null },
  lead_no_show: { startColumn: "role:no_show", finishColumn: null, finishAfter: null },
  campaign_signup: NONE,
  checkout_abandoned: NONE,
};

export function flowDefaults(key: string): FlowDefaults {
  return FLOW_DEFAULTS[key] ?? NONE;
}

/** Flows an operator points at a column (the editor shows "Starts when a lead enters"). */
export function isColumnStartedFlow(key: string): boolean {
  return flowDefaults(key).startColumn !== null;
}

/** Flows that can end by moving the card. A booked call ends at the call. */
export function hasFinishStep(key: string): boolean {
  return LEAD_FLOW_KEY_SET.has(key) && key !== CALL_BOOKED_FLOW;
}

/** What one automation_queue row is. Messages are the only kind a lead receives. */
export type QueueKind = "message" | "move" | "callback_check" | "reply_check" | "staff_alert";

/** The JSON a non-message queue row carries (automation_queue.payload). Every field optional. */
export interface QueuePayload {
  /** move: where to. */
  column?: ColumnRef;
  /** message: a call reminder is dropped rather than sent at or after this time. */
  notAfter?: number;
  /** callback_check: the picked day, "YYYY-MM-DD". */
  day?: string;
  /** reply_check: what they said, and which inbound message it was. */
  text?: string;
  messageId?: number;
  /** staff_alert: an in-app alert for one person, and/or a WhatsApp to the alert number. */
  userId?: number | null;
  title?: string;
  body?: string;
  href?: string;
  whatsappText?: string;
}

export function parsePayload(raw: string | null | undefined): QueuePayload {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as QueuePayload) : {};
  } catch {
    return {};
  }
}
