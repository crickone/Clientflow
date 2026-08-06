"use client";

import { Bot } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { AssistantChat } from "@/components/messaging/AssistantChat";
import type { Agent } from "@/lib/db/schema";

/**
 * Per-agent copy layered onto the shared AssistantChat shell (see that
 * component's `endpoint`/`title`/... props). Only "sales" has copy today
 * because it's the only active agent in AGENT_CATALOG
 * (@/lib/agents/registry) — any other agent that goes active later just
 * falls back to AssistantChat's own generic defaults until it gets its own
 * entry here.
 */
const SALES_CHAT_COPY = {
  subtitle: "drafts replies + follow-ups for your leads, across email and WhatsApp",
  emptyTitle: "Ask the Sales agent to work your leads",
  emptyBody:
    "It can list new and stale leads, draft a first reply or a nudge, and prepare an email or WhatsApp for one — nothing sends until you click Approve.",
  suggestions: [
    "Work my leads — draft replies for anything new or stale",
    "Which leads have gone quiet and need a nudge?",
    "Draft a first reply for my newest lead",
    "Show me everyone currently in the pipeline",
  ],
  placeholder: "Ask the Sales agent…  (Enter to send)",
};

/**
 * The agent's working chat. Reuses AssistantChat byte-for-byte for the
 * SSE + Approve-card + `/api/assistant/execute` mechanics (see that
 * component's `endpoint` prop doc) — only the endpoint + cosmetic copy differ
 * per agent. Dormant agents (everything but Sales today) get a "coming soon"
 * placeholder instead of a chat, since their `/api/agents/<key>/chat` route
 * 404s (no playbook/tool slice wired yet).
 */
export function AgentChatPanel({ agent, tenantId }: { agent: Agent; tenantId: number }) {
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

  const copy = agent.key === "sales" ? SALES_CHAT_COPY : null;

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
    />
  );
}
