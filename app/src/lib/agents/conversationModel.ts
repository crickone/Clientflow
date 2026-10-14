/**
 * An Adonis conversation as the server holds it (lib/agents/conversation.ts)
 * and the chat shows it (AssistantChat). Pure, so both sides share one copy
 * and the import of old browser-saved chats can be tested.
 */

import type { CampaignProgressEvent } from "@/components/messaging/campaignProgress";

export type ConvAction = { name: string; input: Record<string, unknown>; summary: string };
export type ConvArtifact = { url: string; filename: string; label: string };

export type ConvMessage = {
  role: "user" | "assistant";
  /** Sent by the app for the operator (an approval's result handed back to Adonis); kept in the history, not shown. */
  hidden?: boolean;
  content: string;
  /** The tools this reply used, in order (names; old imported chats hold the label shown at the time). */
  tools: string[];
  artifacts: ConvArtifact[];
  pending?: { actions: ConvAction[]; status: "awaiting" | "approving" | "approved" | "cancelled" } | null;
};

export type ConversationSummary = { id: string; title: string; updatedAt: number; running: boolean };

export type ConversationView = ConversationSummary & {
  messages: ConvMessage[];
  campaignEvents: CampaignProgressEvent[];
  /** "Approve and build everything" (or Build the rest) is in progress. */
  building: boolean;
  stopRequested: boolean;
};

/** The messages Adonis is given for its next turn: the last 24 with something in them. */
export function modelHistory(messages: ConvMessage[]): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((m) => m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-24);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function artifacts(v: unknown): ConvArtifact[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((a) => a && typeof a === "object")
    .map((a) => a as Record<string, unknown>)
    .filter((a) => str(a.url) && str(a.filename))
    .map((a) => ({ url: str(a.url), filename: str(a.filename), label: str(a.label) || str(a.filename) }));
}

/**
 * One chat as an older build of the page saved it in the browser, turned
 * into what the server holds. Anything unreadable is dropped rather than
 * failing the whole import. A card that was mid-approval when the page went
 * away comes back as waiting, so the operator can approve it again.
 */
export function normalizeImported(raw: unknown): { id: string; title: string; updatedAt: number; messages: ConvMessage[]; campaignEvents: CampaignProgressEvent[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const id = str(c.id).trim();
  if (!id || id.length > 80 || !Array.isArray(c.messages)) return null;
  const messages: ConvMessage[] = [];
  for (const m of c.messages as unknown[]) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    if (r.role !== "user" && r.role !== "assistant") continue;
    const steps = Array.isArray(r.steps) ? (r.steps as unknown[]).map((s) => str((s as Record<string, unknown>)?.label)).filter(Boolean) : [];
    let pending: ConvMessage["pending"] = null;
    const p = r.pending as Record<string, unknown> | null | undefined;
    if (p && Array.isArray(p.actions)) {
      const actions = (p.actions as unknown[])
        .filter((a) => a && typeof a === "object" && str((a as Record<string, unknown>).name))
        .map((a) => {
          const x = a as Record<string, unknown>;
          return { name: str(x.name), input: (x.input && typeof x.input === "object" ? x.input : {}) as Record<string, unknown>, summary: str(x.summary) };
        });
      const status = p.status === "approved" || p.status === "cancelled" ? p.status : "awaiting";
      if (actions.length) pending = { actions, status };
    }
    messages.push({
      role: r.role,
      ...(r.hidden === true ? { hidden: true } : {}),
      content: str(r.content),
      tools: steps,
      artifacts: artifacts(r.artifacts),
      pending,
    });
  }
  if (messages.length === 0) return null;
  const updatedAt = typeof c.updatedAt === "number" && Number.isFinite(c.updatedAt) ? c.updatedAt : Date.now();
  return {
    id,
    title: (str(c.title).trim() || "Untitled").slice(0, 80),
    updatedAt,
    messages,
    campaignEvents: Array.isArray(c.campaignEvents) ? (c.campaignEvents as CampaignProgressEvent[]) : [],
  };
}
