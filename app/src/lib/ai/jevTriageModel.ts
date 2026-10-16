/**
 * The Jev trial for inbox sorting: the same three judgments Claude makes for
 * every inbound message (category, priority, sensitive), asked of Jev as typed
 * questions, and the comparison between the two. Jev can't write text, so the
 * summary and suggested reply stay with Claude either way. Pure, so tested
 * without a network.
 */

import type { TriageCategory, TriageHistoryItem, TriagePriority } from "@/lib/ai/triageMessage";

export const JEV_MODEL = "typesafe-ai/jev";

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "boolean"; instructions: string };

export type JevAnswer =
  | { type: "choice"; choice: string; probabilities?: Record<string, number> }
  | { type: "score"; score: number; probabilities?: Record<string, number> }
  | { type: "boolean"; probability: number }
  | { type: "refusal" };

/** Same categories and meanings as Claude's triage (lib/ai/triageMessage CATEGORY_GUIDE). */
export const JEV_TRIAGE_QUESTIONS: Record<"category" | "priority" | "sensitive", JevQuestion> = {
  category: {
    type: "choice",
    instructions: "Classify this inbound customer message for a gym or clinic's inbox.",
    criteria: {
      new_lead: "A prospective customer making first contact or asking about starting or trying a service. Not yet a client.",
      booking: "Wants to book, reschedule, confirm or cancel an appointment or class.",
      existing_client: "A known current or past client writing about their sessions, care or account.",
      faq: "A general information question: hours, price, location, parking, what a service is.",
      sensitive: "Medical or health-condition questions, complaints, distress, disputes, refunds.",
      spam: "Irrelevant, promotional or junk.",
      other: "Anything that doesn't fit the others.",
    },
  },
  priority: {
    type: "score",
    instructions: "How urgent is this message for the business?",
    criteria: ["Low: FYI, spam or vague", "Normal: a standard enquiry or booking", "High: urgent, time-sensitive, a hot lead, upset, or a complaint"],
  },
  sensitive: {
    type: "boolean",
    instructions: "Is this medical, about a health condition, a complaint, distress, legal, or a refund or cancellation dispute?",
  },
};

const CATEGORIES = new Set<TriageCategory>(["new_lead", "booking", "existing_client", "faq", "sensitive", "spam", "other"]);

/** What Jev reads: the message plus the same context Claude gets, minus the business facts. */
export function jevTriageState(input: {
  messageText: string;
  channel: string;
  isExistingClient: boolean;
  senderName?: string | null;
  history?: TriageHistoryItem[];
}): Record<string, unknown> {
  return {
    channel: input.channel,
    senderIsKnownClient: input.isExistingClient,
    ...(input.senderName ? { senderName: input.senderName } : {}),
    recentConversation: (input.history ?? []).slice(-6).map((m) => ({ from: m.direction === "inbound" ? "them" : m.direction === "outbound" ? "us" : "note", text: m.content.slice(0, 1000) })),
    newMessage: input.messageText.slice(0, 4000),
  };
}

export type JevTriage = { category: TriageCategory; priority: TriagePriority; sensitive: boolean; confidence: number | null };

/** Jev's answers as Claude-shaped labels. Null when a question was refused or came back malformed. */
export function readJevTriage(answers: Record<string, JevAnswer | undefined>): JevTriage | null {
  const c = answers.category;
  const p = answers.priority;
  const s = answers.sensitive;
  if (c?.type !== "choice" || p?.type !== "score" || s?.type !== "boolean") return null;
  if (!CATEGORIES.has(c.choice as TriageCategory) || !Number.isFinite(p.score) || !Number.isFinite(s.probability)) return null;
  const level = Math.round(Math.max(0, Math.min(2, p.score)));
  const confidence = c.probabilities?.[c.choice];
  return {
    category: c.choice as TriageCategory,
    priority: (["low", "normal", "high"] as const)[level],
    sensitive: s.probability >= 0.5,
    confidence: typeof confidence === "number" && Number.isFinite(confidence) ? confidence : null,
  };
}

export type TrialRow = {
  claudeCategory: string;
  claudePriority: string;
  claudeSensitive: boolean;
  jevCategory: string | null;
  jevPriority: string | null;
  jevSensitive: boolean | null;
  jevMs: number | null;
  error: string | null;
};

export type TrialStats = {
  compared: number;
  failed: number;
  category: number | null;
  priority: number | null;
  sensitive: number | null;
  /** Messages where Claude held something as sensitive and Jev didn't: the costly kind of miss. */
  missedSensitive: number;
  medianMs: number | null;
};

/** How often Jev agreed with Claude, as whole percentages of the messages both answered. */
export function trialStats(rows: TrialRow[]): TrialStats {
  const ok = rows.filter((r) => !r.error && r.jevCategory !== null);
  const pct = (n: number) => (ok.length ? Math.round((n / ok.length) * 100) : null);
  const ms = ok.map((r) => r.jevMs).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
  return {
    compared: ok.length,
    failed: rows.length - ok.length,
    category: pct(ok.filter((r) => r.jevCategory === r.claudeCategory).length),
    priority: pct(ok.filter((r) => r.jevPriority === r.claudePriority).length),
    sensitive: pct(ok.filter((r) => r.jevSensitive === r.claudeSensitive).length),
    missedSensitive: ok.filter((r) => r.claudeSensitive && r.jevSensitive === false).length,
    medianMs: ms.length ? ms[Math.floor(ms.length / 2)] : null,
  };
}
