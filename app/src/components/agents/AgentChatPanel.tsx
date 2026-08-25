"use client";

import { Bot } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { AssistantChat } from "@/components/messaging/AssistantChat";
import type { Agent } from "@/lib/db/schema";

/**
 * Per-agent copy layered onto the shared AssistantChat shell (see that
 * component's `endpoint`/`title`/... props). Adonis (`orchestrator`) is the
 * only active AGENT_CATALOG entry now (@/lib/agents/registry — single-agent
 * product, 2026-08-25: the Sales/Marketing/Operations/Concierge cards were
 * retired) and the only entry in CHAT_COPY; any other agent that goes active
 * later (e.g. Finance) falls back to AssistantChat's own generic defaults
 * until it gets its own entry here. The Sales/Marketing/Operations copy
 * blocks this file used to hold were removed alongside their AGENT_CATALOG
 * entries — their agent detail pages 404 before this component would ever
 * mount for one of those keys (see agents/[key]/page.tsx's `getAgent` +
 * `notFound()` guard), so dead copy for them here would only invite drift.
 */
const ORCHESTRATOR_CHAT_COPY = {
  subtitle: "handles leads, marketing, operations and admin directly — you approve before anything sends, saves, or publishes",
  emptyTitle: "Ask Adonis to run the business",
  emptyBody:
    "It works leads, drafts on-brand content, keeps the schedule full, and handles the inbox, invoices and admin — directly, no hand-offs. Nothing it drafts sends, saves, or publishes until you click Approve.",
  suggestions: [
    "Work my leads and win back anyone who's gone quiet",
    "Draft a blog about our new class and line up a win-back for last week's no-shows",
    "What should I focus on today?",
    "Draft a marketing post and follow up on new leads",
  ],
  placeholder: "Ask Adonis…  (Enter to send)",
};

const CHAT_COPY: Record<string, typeof ORCHESTRATOR_CHAT_COPY> = {
  orchestrator: ORCHESTRATOR_CHAT_COPY,
};

/**
 * The agent's working chat. Reuses AssistantChat byte-for-byte for the
 * SSE + Approve-card + `/api/assistant/execute` mechanics (see that
 * component's `endpoint` prop doc) — only the endpoint + cosmetic copy differ
 * per agent. Dormant agents (Finance today) get a "coming soon" placeholder
 * instead of a chat, since their `/api/agents/<key>/chat` route 404s (no
 * playbook/tool slice wired yet).
 *
 * Single-agent product (2026-08-25): this used to special-case `agent.key
 * === "concierge"` here (the Concierge deliberately has no `SPECIALISTS`
 * entry — see specialistToolSlice.test.ts's pinned assertion — and only ever
 * ran through the Orchestrator's `delegate_to_concierge` tool, never its own
 * chat route, so it rendered a "Runs through Adonis" placeholder instead of a
 * live-looking chat box that would 404 on every message). That case was
 * removed along with the Concierge's AGENT_CATALOG entry:
 * `agents/[key]/page.tsx`'s `getAgent` + `notFound()` guard now 404s before
 * this component ever mounts for `"concierge"`, so the placeholder it
 * rendered is no longer reachable.
 */
export function AgentChatPanel({
  agent,
  tenantId,
  initialInput,
  voiceEnabled = false,
}: {
  agent: Agent;
  tenantId: number;
  /** Campaign Engine Slice 3: see AssistantChat's `initialInput` doc — threaded straight through, only ever non-empty for the orchestrator (Adonis) agent (see AgentDetailPage). Was the Marketing agent's until the single-agent-product task (2026-08-25) repointed the campaign-seed flow at Adonis, which absorbed the campaign-kit tools. */
  initialInput?: string;
  /** Voice T2: see AssistantChat's `voiceEnabled` doc — threaded straight through from AgentDetail. Defaults false so any other/future caller of this panel keeps rendering without a mic button. */
  voiceEnabled?: boolean;
}) {
  if (agent.status !== "active") {
    return (
      <Card style={{ textAlign: "center", padding: "56px 28px" }}>
        <Bot size={26} strokeWidth={1.5} style={{ color: "var(--text-tertiary)", marginBottom: 14 }} />
        <div
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: 18,
            textTransform: "uppercase",
            color: "var(--text-primary)",
            marginBottom: 8,
          }}
        >
          Coming soon
        </div>
        <p style={{ color: "var(--text-tertiary)", fontSize: 13, lineHeight: 1.5, maxWidth: 420, margin: "0 auto" }}>
          This agent isn&apos;t running yet — there&apos;s nothing to chat with until {agent.name} is switched on.
        </p>
      </Card>
    );
  }

  const copy = CHAT_COPY[agent.key] ?? null;

  return (
    <AssistantChat
      tenantId={tenantId}
      endpoint={`/api/agents/${agent.key}/chat`}
      title={`${agent.name} agent`}
      subtitle={copy?.subtitle}
      emptyTitle={copy?.emptyTitle}
      emptyBody={copy?.emptyBody}
      suggestions={copy?.suggestions}
      placeholder={copy?.placeholder}
      initialInput={initialInput}
      voiceEnabled={voiceEnabled}
    />
  );
}
