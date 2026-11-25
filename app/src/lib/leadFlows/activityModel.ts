/**
 * Pure: how a person's run through a follow-up flow reads on the
 * automation's People tab. See activity.ts for where the rows come from.
 */

export type RunStatus = "active" | "finished" | "stopped";

export interface ActivityStep {
  kind: string;
  channel: string;
  status: "queued" | "sent" | "failed" | "cancelled";
  dueAt: number;
  sentAt: number | null;
}

export interface RunProgress {
  /** Messages (not moves or checks) in the run. */
  messages: number;
  sent: number;
  failed: number;
  lastSentAt: number | null;
  next: { channel: string; dueAt: number; kind: string } | null;
}

export function runProgress(steps: ActivityStep[]): RunProgress {
  const msgs = steps.filter((s) => s.kind === "message");
  const sent = msgs.filter((s) => s.status === "sent");
  const queued = steps.filter((s) => s.status === "queued").sort((a, b) => a.dueAt - b.dueAt);
  return {
    messages: msgs.length,
    sent: sent.length,
    failed: msgs.filter((s) => s.status === "failed").length,
    lastSentAt: sent.reduce<number | null>((m, s) => (s.sentAt != null && (m == null || s.sentAt > m) ? s.sentAt : m), null),
    next: queued[0] ? { channel: queued[0].channel, dueAt: queued[0].dueAt, kind: queued[0].kind } : null,
  };
}

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email", push: "App alert", chat: "Chat" };
export const channelLabel = (c: string) => CHANNEL[c] ?? c;

/** "Replied", "Booked a treatment started"... first letter up, nothing else changed. */
export function stopReasonLabel(reason: string | null | undefined): string {
  const r = (reason ?? "").trim();
  if (!r) return "Stopped";
  return r.charAt(0).toUpperCase() + r.slice(1);
}

export function statusLabel(status: RunStatus, stopReason: string | null | undefined): string {
  if (status === "active") return "Active";
  if (status === "finished") return "Finished";
  return `Stopped: ${stopReasonLabel(stopReason).replace(/^Stopped$/, "by hand")}`;
}

/** What the next step is, in words: "WhatsApp, Thu 27 Nov 09:00" or "Move to Long-term nurture". */
export function nextStepLabel(next: RunProgress["next"], fmt: (ms: number) => string): string | null {
  if (!next) return null;
  if (next.kind === "move") return `Move on, ${fmt(next.dueAt)}`;
  if (next.kind !== "message") return `Check, ${fmt(next.dueAt)}`;
  return `${channelLabel(next.channel)}, ${fmt(next.dueAt)}`;
}

export interface ActivityCounts {
  entered: number;
  active: number;
  finished: number;
  stopped: number;
  replied: number;
}

export function countRuns(runs: { status: RunStatus; stopReason: string | null }[]): ActivityCounts {
  return {
    entered: runs.length,
    active: runs.filter((r) => r.status === "active").length,
    finished: runs.filter((r) => r.status === "finished").length,
    stopped: runs.filter((r) => r.status === "stopped").length,
    replied: runs.filter((r) => r.status === "stopped" && /repl/i.test(r.stopReason ?? "")).length,
  };
}
