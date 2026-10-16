/**
 * Lead scoring with Jev: what we know about a lead goes in as facts, and Jev
 * answers two typed questions, how ready they are to buy (0 to 4) and the
 * best next step. The score shown is that readiness out of 100. Pure, so the
 * questions, the reading and the "is it due a rescore" rule are tested
 * without a network or a database.
 */

import type { JevAnswer, JevQuestion } from "@/lib/ai/jevTriageModel";

export const NEXT_STEPS = {
  book: { label: "Offer a time", what: "They've asked to book, start or pay: offer them a time or send them the way to pay." },
  call: { label: "Call today", what: "They've replied and are engaged: a phone call would move this on." },
  message: { label: "Send a message", what: "They asked something we haven't answered yet, or nobody has written to them yet." },
  wait: { label: "Give it time", what: "We wrote last, within the past few days, and they haven't replied yet." },
  close: { label: "Close it", what: "They said no or asked us to stop, or haven't replied to several messages over two weeks or more." },
} as const;

export type NextStep = keyof typeof NEXT_STEPS;

export const LEAD_SCORE_QUESTIONS: Record<"readiness" | "nextStep", JevQuestion> = {
  readiness: {
    type: "score",
    instructions: "How ready is this person to become a paying customer of the business, judging by what they've said and done?",
    criteria: [
      "Cold: hasn't replied, isn't interested, or asked not to be contacted",
      "Cool: showed some interest but hasn't engaged",
      "Warm: engaged and asking general questions",
      "Hot: asking about price, times, or how to start",
      "Ready: asked to book, start or pay",
    ],
  },
  nextStep: {
    type: "choice",
    instructions: "What should the business do next with this lead?",
    criteria: Object.fromEntries(Object.entries(NEXT_STEPS).map(([k, v]) => [k, v.what])),
  },
};

export type LeadFacts = {
  source: string;
  campaign: string | null;
  interestedIn: string | null;
  stage: string | null;
  formNotes: string | null;
  hasPhone: boolean;
  hasEmail: boolean;
  doNotCall: boolean;
  createdAt: number;
  messages: { direction: "inbound" | "outbound" | "note"; channel: string; at: number; content: string }[];
};

const hoursAgo = (ms: number, now: number) => Math.max(0, Math.round((now - ms) / 3_600_000));

/** What Jev reads about a lead: facts and the last ten messages, with times as hours ago. */
export function leadScoreState(f: LeadFacts, now: number): Record<string, unknown> {
  const sent = f.messages.filter((m) => m.direction !== "note");
  const theirs = sent.filter((m) => m.direction === "inbound");
  const ours = sent.filter((m) => m.direction === "outbound");
  const last = (xs: typeof sent) => (xs.length ? hoursAgo(Math.max(...xs.map((m) => m.at)), now) : null);
  return {
    cameFrom: f.source,
    ...(f.campaign ? { campaign: f.campaign } : {}),
    ...(f.interestedIn ? { interestedIn: f.interestedIn } : {}),
    ...(f.stage ? { pipelineStage: f.stage } : {}),
    ...(f.formNotes ? { whatTheyWroteOnTheForm: f.formNotes.slice(0, 600) } : {}),
    hasPhone: f.hasPhone,
    hasEmail: f.hasEmail,
    askedNotToBeCalled: f.doNotCall,
    daysSinceFirstContact: Math.round(hoursAgo(f.createdAt, now) / 24),
    messagesFromThem: theirs.length,
    messagesFromUs: ours.length,
    hoursSinceTheirLastMessage: last(theirs),
    hoursSinceOurLastMessage: last(ours),
    recentMessages: sent
      .slice(-10)
      .map((m) => ({ from: m.direction === "inbound" ? "them" : "us", channel: m.channel, hoursAgo: hoursAgo(m.at, now), text: m.content.slice(0, 600) })),
  };
}

export type LeadScore = { score: number; next: NextStep };

/** Readiness out of 100 and the next step, or null when Jev refused or answered outside the options. */
export function readLeadScore(answers: Record<string, JevAnswer | undefined>): LeadScore | null {
  const r = answers.readiness;
  const n = answers.nextStep;
  if (r?.type !== "score" || n?.type !== "choice" || !Number.isFinite(r.score) || !(n.choice in NEXT_STEPS)) return null;
  return { score: Math.round((Math.max(0, Math.min(4, r.score)) / 4) * 100), next: n.choice as NextStep };
}

export type Band = "hot" | "warm" | "cold";

export function band(score: number): Band {
  return score >= 70 ? "hot" : score >= 40 ? "warm" : "cold";
}

export const BAND_LABEL: Record<Band, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };

/** Stage roles a score no longer helps with: they've bought, lapsed or been lost. */
const DONE_ROLES = new Set(["sale", "repeat_customer", "lapsed", "lost"]);

/**
 * Whether a lead needs scoring: never scored, something happened since the
 * last score, or the last score is over a day old (time alone cools a lead).
 * Leads that have become clients, bought, or been closed are left alone.
 */
export function scoreDue(l: { scoredAt: number | null; lastActivity: number; stageRole: string | null; isClient: boolean }, now: number): boolean {
  if (l.isClient || (l.stageRole && DONE_ROLES.has(l.stageRole))) return false;
  if (l.scoredAt === null) return true;
  return l.lastActivity > l.scoredAt || now - l.scoredAt > 24 * 3_600_000;
}
