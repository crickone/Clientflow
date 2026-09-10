import "server-only";

import { readKey, readKeyForTenant, setKey } from "@/lib/settings";

/**
 * The call flow: WHEN the voice agent calls someone, and what happens after.
 *
 * One flow per tenant, with a FIXED spine — lead arrives, wait, check, call,
 * branch on the outcome — and editable settings at each step. Deliberately not
 * a free-form node graph: the diagram an operator edits at /settings/voice/flow
 * is generated from this same config by `describeFlow`, and the dialler
 * enforces this same config, so the picture cannot drift from what actually
 * runs. A drag-and-drop builder can draw a flow the engine doesn't implement;
 * this can't.
 *
 * Everything here is PURE except the two settings accessors, so the window and
 * retry decisions can be tested without a clock, a DB or a tenant.
 *
 * Times are Europe/Dublin, always. Not the server's timezone (Railway runs
 * UTC), and not the browser's — "don't call people before 9am" means 9am where
 * the person answering the phone lives, and every client is Irish. When that
 * stops being true this becomes a per-tenant setting, and this comment is the
 * marker for where.
 */

const FLOW_KEY = "voice_call_flow";

export interface CallFlowConfig {
  /** The ARM switch. While false NOTHING is enqueued and nothing dials on its own — an operator's manual Call button still works. */
  enabled: boolean;
  /** How long after a lead arrives before the first call. Speed matters, but an instant call to someone still on the form page reads as creepy. */
  triggerDelayMinutes: number;
  /** Days calling is allowed, 0 = Sunday … 6 = Saturday. */
  windowDays: number[];
  /** Inclusive start, "HH:MM" Dublin time. */
  windowStart: string;
  /** Exclusive end, "HH:MM" Dublin time. */
  windowEnd: string;
  /** Gap before trying someone who didn't answer. */
  retryAfterHours: number;
  /** Total attempts per lead, including the first. */
  maxAttempts: number;
  /** Pipeline stage role to move a lead to when a call is actually answered. Null = leave the stage alone. */
  onAnsweredStageRole: string | null;
  /** Email the operator a summary when a call finishes. */
  notifyOnComplete: boolean;
}

export const DEFAULT_CALL_FLOW: CallFlowConfig = {
  enabled: false, // ships disarmed: nothing dials on its own until an operator turns it on
  triggerDelayMinutes: 5,
  windowDays: [1, 2, 3, 4, 5], // Mon-Fri
  windowStart: "09:00",
  windowEnd: "20:00",
  retryAfterHours: 4,
  maxAttempts: 3,
  onAnsweredStageRole: null,
  notifyOnComplete: true,
};

export const MAX_TRIGGER_DELAY_MINUTES = 60 * 24 * 7;
export const MAX_RETRY_HOURS = 24 * 14;
export const MAX_ATTEMPTS_CEILING = 10;

/** Clamp/repair a stored or submitted config. Anything unusable falls back to the default rather than throwing — a corrupt settings row must not stop the page loading. */
export function normalizeFlow(raw: Partial<CallFlowConfig> | null | undefined): CallFlowConfig {
  const d = DEFAULT_CALL_FLOW;
  const r = raw ?? {};
  const days = Array.isArray(r.windowDays)
    ? Array.from(new Set(r.windowDays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))).sort()
    : d.windowDays;
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    triggerDelayMinutes: clampInt(r.triggerDelayMinutes, 0, MAX_TRIGGER_DELAY_MINUTES, d.triggerDelayMinutes),
    windowDays: days.length > 0 ? days : d.windowDays,
    windowStart: isHHMM(r.windowStart) ? r.windowStart! : d.windowStart,
    windowEnd: isHHMM(r.windowEnd) ? r.windowEnd! : d.windowEnd,
    retryAfterHours: clampInt(r.retryAfterHours, 1, MAX_RETRY_HOURS, d.retryAfterHours),
    maxAttempts: clampInt(r.maxAttempts, 1, MAX_ATTEMPTS_CEILING, d.maxAttempts),
    onAnsweredStageRole: typeof r.onAnsweredStageRole === "string" && r.onAnsweredStageRole ? r.onAnsweredStageRole : null,
    notifyOnComplete: typeof r.notifyOnComplete === "boolean" ? r.notifyOnComplete : d.notifyOnComplete,
  };
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function isHHMM(v: unknown): v is string {
  return typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export function getCallFlow(): CallFlowConfig {
  return normalizeFlow(readKey<Partial<CallFlowConfig>>(FLOW_KEY, {}));
}

/** For the dialler, which has no request scope. */
export function getCallFlowForTenant(tenantId: number): CallFlowConfig {
  return normalizeFlow(readKeyForTenant<Partial<CallFlowConfig>>(tenantId, FLOW_KEY, {}));
}

export function setCallFlow(patch: Partial<CallFlowConfig>): CallFlowConfig {
  const next = normalizeFlow({ ...getCallFlow(), ...patch });
  setKey(FLOW_KEY, next);
  return next;
}

// ─── The calling window (pure) ───────────────────────────────────────────────

const DUBLIN_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Dublin",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
  hour12: false,
});

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dublin-local weekday (0-6) and minutes-since-midnight for an instant. */
export function dublinClock(at: Date): { day: number; minutes: number } {
  const parts = DUBLIN_PARTS.formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = WEEKDAY_INDEX[get("weekday")] ?? 0;
  // en-GB hour12:false can render midnight as "24" — normalise it to 0.
  const hour = Number(get("hour")) % 24;
  return { day, minutes: hour * 60 + Number(get("minute")) };
}

function hhmmToMinutes(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

/**
 * May an AUTOMATED call go out at this instant? Manual calls deliberately do
 * NOT consult this: an operator returning a missed call at 20:30 is exercising
 * judgement about one person in front of them, which is a different thing from
 * a machine working a list unattended.
 */
export function isWithinWindow(at: Date, flow: CallFlowConfig): boolean {
  const { day, minutes } = dublinClock(at);
  if (!flow.windowDays.includes(day)) return false;
  const start = hhmmToMinutes(flow.windowStart);
  const end = hhmmToMinutes(flow.windowEnd);
  if (start >= end) return false; // an inverted window means "never", not "all night"
  return minutes >= start && minutes < end;
}

/**
 * The next instant calling is allowed, at or after `from`. Steps forward a
 * minute at a time within the day, then day by day — at most 8 days of search,
 * which covers every window shape including a single-day-a-week one. Returns
 * `null` if the window can never open (no days, or an inverted range), so a
 * caller parks the item rather than looping forever.
 */
export function nextWindowOpening(from: Date, flow: CallFlowConfig): Date | null {
  if (flow.windowDays.length === 0) return null;
  if (hhmmToMinutes(flow.windowStart) >= hhmmToMinutes(flow.windowEnd)) return null;
  if (isWithinWindow(from, flow)) return from;

  // Probe on 15-minute boundaries: fine enough that nobody notices, cheap
  // enough that 8 days is a few hundred iterations.
  const STEP_MS = 15 * 60_000;
  const limit = from.getTime() + 8 * 24 * 60 * 60_000;
  for (let t = from.getTime() + STEP_MS; t <= limit; t += STEP_MS) {
    const candidate = new Date(t);
    if (isWithinWindow(candidate, flow)) return candidate;
  }
  return null;
}

/** When the next attempt on a lead becomes due, given the flow's retry gap. */
export function nextAttemptAt(after: Date, flow: CallFlowConfig): Date {
  return new Date(after.getTime() + flow.retryAfterHours * 60 * 60_000);
}

// ─── The flow, as the UI draws it ────────────────────────────────────────────

export type FlowStepKind = "trigger" | "wait" | "checks" | "call" | "branch";

export interface FlowStep {
  kind: FlowStepKind;
  title: string;
  /** The human sentence under the title — always rendered FROM the config, never hardcoded, so the diagram can't describe behaviour that isn't configured. */
  detail: string;
  /** Which settings field this step edits, for the editor to focus. */
  fields: (keyof CallFlowConfig)[];
  /** Outcome branches, on the `branch` step only. */
  branches?: { label: string; detail: string; fields: (keyof CallFlowConfig)[] }[];
}

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describeDays(days: number[]): string {
  if (days.length === 7) return "every day";
  if (days.length === 0) return "no days (calling is off)";
  const sorted = [...days].sort();
  if (sorted.join() === "1,2,3,4,5") return "Mon to Fri";
  if (sorted.join() === "0,6") return "weekends";
  return sorted.map((d) => DAY_LABEL[d]).join(", ");
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The flow as steps for rendering. Generated from the config, so editing a
 * setting immediately changes the sentence the operator reads — which is the
 * whole point of drawing it rather than listing fields.
 */
export function describeFlow(flow: CallFlowConfig): FlowStep[] {
  return [
    {
      kind: "trigger",
      title: "A new lead arrives",
      detail: flow.enabled
        ? "From a Facebook lead ad, a website form, or added by hand."
        : "Automatic calling is off — nothing starts this flow. You can still call a lead by hand from their page.",
      fields: ["enabled"],
    },
    {
      kind: "wait",
      title: "Wait",
      detail:
        flow.triggerDelayMinutes === 0
          ? "Call straight away."
          : `Wait ${plural(flow.triggerDelayMinutes, "minute")} before calling.`,
      fields: ["triggerDelayMinutes"],
    },
    {
      kind: "checks",
      title: "Check it's OK to call",
      detail:
        `Only ${describeDays(flow.windowDays)}, between ${flow.windowStart} and ${flow.windowEnd}. ` +
        "Never anyone marked do-not-call. Stops at the monthly spend cap, or when minutes and credits run out.",
      fields: ["windowDays", "windowStart", "windowEnd"],
    },
    {
      kind: "call",
      title: "The agent calls",
      detail:
        "It says it is an AI, that the call is recorded, and follows your instructions. " +
        "The transcript and a summary land on the lead's timeline.",
      fields: [],
    },
    {
      kind: "branch",
      title: "What happens next",
      detail: "",
      fields: [],
      branches: [
        {
          label: "They answered",
          detail: flow.onAnsweredStageRole
            ? `Move the lead to "${flow.onAnsweredStageRole}".${flow.notifyOnComplete ? " Email you a summary." : ""}`
            : `Leave the stage alone.${flow.notifyOnComplete ? " Email you a summary." : ""}`,
          fields: ["onAnsweredStageRole", "notifyOnComplete"],
        },
        {
          label: "No answer",
          detail:
            flow.maxAttempts <= 1
              ? "Don't try again."
              : `Try again in ${plural(flow.retryAfterHours, "hour")}, up to ${plural(flow.maxAttempts, "attempt")} in total.`,
          fields: ["retryAfterHours", "maxAttempts"],
        },
        {
          label: "They ask not to be called",
          detail: "Marked do-not-call immediately, and never called again. This can't be turned off.",
          fields: [],
        },
      ],
    },
  ];
}
