/**
 * What happens to one GoHighLevel person, by the rules agreed with the
 * operator (docs/superpowers/specs/2026-11-25-ghl-import-design.md). Pure.
 *
 * This decides the destination only. Whether the person is already in
 * Adonis, which flow a column starts and which steps are left are worked
 * out later (plan.ts, placement.ts).
 */
import type { ColumnRef } from "@/lib/leadFlows/flowModel";

/** A follow-up stage older than this goes to Long-term nurture from week 1. */
export const STALE_AFTER_DAYS = 14;

/** The Holding column: created on import when the board has none. No role, no flow. */
export const HOLDING = "holding" as const;
export type ImportColumn = ColumnRef | typeof HOLDING;

/** No opportunity, and one of these tags: a client. */
export const CLIENT_TAGS: readonly string[] = ["member", "visited-once", "lapsed-2-months"];
/** No opportunity, and one of these tags: a lost lead, never messaged. */
export const LOST_TAGS: readonly string[] = ["lost", "not interested"];
/** This tag anywhere, or DND: do not contact. */
export const DO_NOT_CONTACT_TAG = "not interested";

/** leads.source for imported leads (never "facebook": no Meta event may fire for them). */
export const GHL_LEAD_SOURCE = "gohighlevel";
/** leads.marketing_consent_source for imported leads (operator decision, 2026-11-25). */
export const GHL_CONSENT_SOURCE = "Carried over from GoHighLevel (operator decision 2026-11-25)";

export interface FlowIntent {
  /** "column": the flow that starts in the column; "new_lead": the New lead flow. */
  via: "column" | "new_lead";
  /** "resume": carry on after day N; "start": from the first step, now. */
  from: "resume" | "start";
  /** WhatsApp steps go by email (Message undelivered). */
  emailOnly: boolean;
}

export type Placement =
  | { kind: "lead"; column: ImportColumn; flow: FlowIntent | null; won: boolean; lost: boolean }
  | { kind: "client" }
  | { kind: "contact" };

export interface Decision {
  placement: Placement;
  doNotContact: boolean;
  /** Record marketing consent (a lead that is neither lost nor do-not-contact). */
  consent: boolean;
  /** Why, in a few plain words, for the dry run. */
  rule: string;
}

export function stageKey(stage: string): string {
  return (stage ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

const FOLLOW_UPS: Record<string, { column: ColumnRef; via: FlowIntent["via"] }> = {
  "call back later": { column: "key:call_back", via: "column" },
  "thinking about it": { column: "key:thinking", via: "column" },
  "no answer call back": { column: "key:no_answer", via: "column" },
  "new lead": { column: "role:new", via: "new_lead" },
};

type LeadPlacement = Extract<Placement, { kind: "lead" }>;

function toLead(column: ImportColumn, flow: FlowIntent | null, extra: { won?: boolean; lost?: boolean } = {}): LeadPlacement {
  return { kind: "lead", column, flow, won: extra.won ?? false, lost: extra.lost ?? false };
}

const NURTURE_FROM_START: LeadPlacement = toLead("key:nurture", { via: "column", from: "start", emailOnly: false });

function forStage(stage: string, n: number | null): { placement: LeadPlacement; rule: string } {
  const key = stageKey(stage);
  const resume = (via: FlowIntent["via"], emailOnly = false): FlowIntent => ({ via, from: "resume", emailOnly });
  const follow = Object.prototype.hasOwnProperty.call(FOLLOW_UPS, key) ? FOLLOW_UPS[key] : undefined;
  if (follow) {
    if (n == null) return { placement: toLead(follow.column, null), rule: "Days in stage unknown: column only" };
    if (n <= STALE_AFTER_DAYS) return { placement: toLead(follow.column, resume(follow.via)), rule: `In ${stage} for ${n} days: carried on` };
    return { placement: NURTURE_FROM_START, rule: `In ${stage} for ${n} days: Long-term nurture from week 1` };
  }
  switch (key) {
    case "long term nurture":
      return n == null
        ? { placement: toLead("key:nurture", null), rule: "Days in stage unknown: column only" }
        : { placement: toLead("key:nurture", resume("column")), rule: "Long-term nurture, carried on" };
    case "consult booked":
      if (n != null && n > STALE_AFTER_DAYS) return { placement: NURTURE_FROM_START, rule: `Booked ${n} days ago: Long-term nurture from week 1` };
      return { placement: toLead("role:booked", null), rule: "Consultation booked" };
    case "message undelivered":
      return n == null
        ? { placement: toLead("key:undelivered", null), rule: "Days in stage unknown: column only" }
        : { placement: toLead("key:undelivered", resume("column", true)), rule: "Message undelivered: email follow-ups only" };
    case "holding":
      return { placement: toLead(HOLDING, null), rule: "Holding" };
    case "send deposit link":
      return { placement: toLead("role:engaged", null), rule: "Deposit link sent: Hot lead" };
    case "won":
      return { placement: toLead("role:won", null, { won: true }), rule: "Won: a client" };
    case "lost":
      return { placement: toLead("role:lost", null, { lost: true }), rule: "Lost: never messaged" };
    default:
      return { placement: toLead("role:new", null), rule: `Unknown GoHighLevel stage "${stage}": New lead, no follow-up` };
  }
}

export function decide(input: { stage: string | null; daysInStage: number | null; tags: string[]; dnd: boolean }): Decision {
  const tags = new Set(input.tags.map((t) => t.trim().toLowerCase()));
  const doNotContact = input.dnd || tags.has(DO_NOT_CONTACT_TAG);
  let placement: Placement;
  let rule: string;
  if (!input.stage || !input.stage.trim()) {
    if (CLIENT_TAGS.some((t) => tags.has(t))) {
      placement = { kind: "client" };
      rule = "Tagged as a client in GoHighLevel";
    } else if (LOST_TAGS.some((t) => tags.has(t))) {
      placement = toLead("role:lost", null, { lost: true });
      rule = "Tagged lost or not interested: never messaged";
    } else {
      placement = { kind: "contact" };
      rule = "No opportunity: email contact only";
    }
  } else {
    ({ placement, rule } = forStage(input.stage.trim(), input.daysInStage));
  }
  if (doNotContact && placement.kind === "lead") placement = { ...placement, flow: null };
  if (doNotContact) rule = `${rule}. Do not contact`;
  const consent = !doNotContact && placement.kind === "lead" && !placement.lost;
  return { placement, doNotContact, consent, rule };
}

/** A name for matching: no accents, lowercase, letters and single spaces only. */
export function nameKey(name: string): string {
  return (name ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** GoHighLevel's assigned user to an Adonis staff member: the full name, else a first name only one person has. */
export function matchStaff(ghlName: string, staff: { userId: number; name: string }[]): number | null {
  const k = nameKey(ghlName);
  if (!k) return null;
  const full = staff.filter((s) => nameKey(s.name) === k);
  if (full.length === 1) return full[0].userId;
  const first = k.split(" ")[0];
  const byFirst = staff.filter((s) => nameKey(s.name).split(" ")[0] === first);
  return byFirst.length === 1 ? byFirst[0].userId : null;
}
