/**
 * A conversation shown as exchanges (the answer-page layout): each visible
 * question with every reply that follows it until the next question. The
 * hidden hand-backs the app sends after an approval stay inside the same
 * exchange, so "approve, then Adonis carries on" reads as one answer.
 * Pure, so the grouping is tested without React.
 */

import type { ConvArtifact, ConvMessage } from "@/lib/agents/conversationModel";
import type { LivePhase } from "@/lib/agents/liveEvents";
import { splitAttachments } from "@/components/messaging/chatText";
import { splitFollowups } from "./followups";
import { toolLabel } from "./toolLabels";

export type ExchangeReply = { index: number; message: ConvMessage; body: string };

export type ChatExchange = {
  /** `q<index of the question>`, or `a<index>` for an exchange that starts with a reply. Stable as messages are added. */
  key: string;
  questionIndex: number | null;
  question: string;
  attached: { name: string; kind: string; id: string }[];
  replies: ExchangeReply[];
  tools: string[];
  artifacts: ConvArtifact[];
  /** From the latest reply that says anything. */
  followups: string[];
  startedAt: number | null;
  /** The sum of the replies' durations; null when none was timed (replies saved before timing existed). */
  durationMs: number | null;
};

export function groupExchanges(messages: ConvMessage[]): ChatExchange[] {
  const out: ChatExchange[] = [];
  let cur: ChatExchange | null = null;
  const start = (key: string, questionIndex: number | null, question: string, attached: ChatExchange["attached"]): ChatExchange => {
    const x: ChatExchange = { key, questionIndex, question, attached, replies: [], tools: [], artifacts: [], followups: [], startedAt: null, durationMs: null };
    out.push(x);
    return x;
  };
  for (let index = 0; index < messages.length; index++) {
    const m = messages[index];
    if (m.hidden) continue;
    if (m.role === "user") {
      const { body, attached } = splitAttachments(m.content);
      cur = start(`q${index}`, index, body, attached);
      continue;
    }
    if (!cur) cur = start(`a${index}`, null, "", []);
    const split = splitFollowups(m.content);
    cur.replies.push({ index, message: m, body: split.body });
    cur.tools.push(...m.tools);
    for (const a of m.artifacts) if (!cur.artifacts.some((x) => x.url === a.url)) cur.artifacts.push(a);
    if (split.body.trim() || split.followups.length) cur.followups = split.followups;
    if (cur.startedAt === null && typeof m.startedAt === "number") cur.startedAt = m.startedAt;
    if (typeof m.durationMs === "number") cur.durationMs = (cur.durationMs ?? 0) + m.durationMs;
  }
  return out;
}

export type StepRow = { key: string; label: string; state: "running" | "done" };

/**
 * The steps panel's rows. While live: the latest tool spins until words
 * start, then every tool is ticked and "Writing the answer" spins. Without a
 * phase from the stream (polling), the latest tool is taken as running.
 */
export function stepRows(tools: string[], live: boolean, phase: LivePhase | null): StepRow[] {
  const rows: StepRow[] = tools.map((t, i) => ({ key: `t${i}`, label: toolLabel(t), state: "done" }));
  if (!live || rows.length === 0) return rows;
  if (phase === "writing") return [...rows, { key: "write", label: "Writing the answer", state: "running" }];
  rows[rows.length - 1] = { ...rows[rows.length - 1], state: "running" };
  return rows;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function stepsSummary(durationMs: number | null, steps: number): string {
  const count = `${steps} step${steps === 1 ? "" : "s"}`;
  if (durationMs !== null && steps > 0) return `Done in ${formatDuration(durationMs)}, ${count}`;
  if (durationMs !== null) return `Done in ${formatDuration(durationMs)}`;
  if (steps > 0) return `Done, ${count}`;
  return "Done";
}

/** The first sentence of an answer in plain text, for a folded exchange. */
export function firstSentence(text: string, max = 140): string {
  const plain = text
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/^#{1,6}\s+.*$/gm, " ")
    .replace(/^\s*([-*•]|\d{1,3}[.)])\s+/gm, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*|`/g, "")
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = /^(.+?[.!?])(\s|$)/.exec(plain);
  const s = m ? m[1] : plain;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
