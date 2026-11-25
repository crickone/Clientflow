/**
 * What the /adonis chat is told while Adonis works, and how the page applies
 * it. Pure (no "server-only", no React) so the server bus, the SSE route and
 * the browser hook share one definition, and the tests can reach it.
 *
 *   text   words Adonis just wrote, for the reply at `index`
 *   tool   a tool Adonis just started, for the reply at `index`
 *   state  the whole conversation after a save; it wins over any delta
 *   end    the run is over; the stream closes
 *   ping   the heartbeat; changes nothing, but tells the page the stream is
 *          alive (EventSource never shows SSE comment frames to the page)
 *
 * Order matters and the server keeps it: a delta is always published BEFORE
 * the save that includes it, so a state never arrives ahead of a delta it
 * already contains (which would print those words twice).
 */

import type { ConversationView } from "@/lib/agents/conversationModel";

export type LiveEvent =
  | { type: "text"; index: number; delta: string }
  | { type: "tool"; index: number; name: string }
  | { type: "state"; conversation: ConversationView }
  | { type: "end" }
  | { type: "ping" };

/** What the reply being written is doing now, as far as the stream has said. */
export type LivePhase = "tool" | "writing";

/** One SSE frame. Unnamed, so the page needs one onmessage handler; JSON keeps any newline inside one data line. */
export function formatSse(event: LiveEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * The heartbeat, as a data frame: proxies see traffic on a quiet stream, and
 * the page sees it too, so it can tell a quiet stream from a dead one.
 */
export const SSE_HEARTBEAT = formatSse({ type: "ping" });

/** How long the browser waits before reconnecting a dropped stream. */
export const SSE_RETRY = "retry: 1500\n\n";

/** One message's data read back into an event, or null for anything unexpected. */
export function parseLiveEvent(data: string): LiveEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  switch (e.type) {
    case "text":
      return typeof e.index === "number" && typeof e.delta === "string" ? { type: "text", index: e.index, delta: e.delta } : null;
    case "tool":
      return typeof e.index === "number" && typeof e.name === "string" ? { type: "tool", index: e.index, name: e.name } : null;
    case "state": {
      const c = e.conversation as Record<string, unknown> | null | undefined;
      return c && typeof c === "object" && Array.isArray(c.messages)
        ? { type: "state", conversation: c as unknown as ConversationView }
        : null;
    }
    case "end":
      return { type: "end" };
    case "ping":
      return { type: "ping" };
    default:
      return null;
  }
}

/** The conversation after one event. Never mutates `conv`. */
export function applyLiveEvent(conv: ConversationView | null, e: LiveEvent): ConversationView | null {
  if (e.type === "state") return e.conversation;
  if (!conv || e.type === "end" || e.type === "ping") return conv;
  const m = conv.messages[e.index];
  if (!m || m.role !== "assistant") return conv;
  const next = e.type === "text" ? { ...m, content: m.content + e.delta } : { ...m, tools: [...m.tools, e.name] };
  const messages = conv.messages.slice();
  messages[e.index] = next;
  return { ...conv, messages };
}
