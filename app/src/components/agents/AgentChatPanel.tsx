"use client";

import Link from "next/link";
import { Bot, ConciergeBell } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { AssistantChat } from "@/components/messaging/AssistantChat";
import type { Agent } from "@/lib/db/schema";

/**
 * Per-agent copy layered onto the shared AssistantChat shell (see that
 * component's `endpoint`/`title`/... props). Orchestrator, Sales, Marketing
 * and Operations (the active agents in AGENT_CATALOG, @/lib/agents/registry)
 * each have an entry in CHAT_COPY; any other agent that goes active later
 * falls back to AssistantChat's own generic defaults until it gets its own
 * entry here.
 */
const ORCHESTRATOR_CHAT_COPY = {
  subtitle: "routes work to Sales, Marketing and Operations and reports back — you approve before anything sends, saves, or publishes",
  emptyTitle: "Ask Adonis to run the business",
  emptyBody:
    "It breaks a request into sub-tasks, delegates each to the right specialist, and summarises what came back — nothing any specialist drafts sends, saves, or publishes until you click Approve.",
  suggestions: [
    "Work my leads and win back anyone who's gone quiet",
    "Draft a blog about our new class and line up a win-back for last week's no-shows",
    "What should I focus on today?",
    "Get Marketing to draft a post and Sales to chase new leads",
  ],
  placeholder: "Ask Adonis…  (Enter to send)",
};

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

const MARKETING_CHAT_COPY = {
  subtitle: "drafts on-brand blogs + carousels from your Marketing Brain — you approve before anything saves or publishes",
  emptyTitle: "Ask the Marketing agent to draft content",
  emptyBody:
    "It can draft an on-brand blog or carousel, save a draft, and publish a blog to your live site — nothing saves or publishes until you click Approve. It can't post to social or schedule posts yet.",
  suggestions: [
    "Draft a blog post about our newest class, in our voice",
    "Draft a 5-slide carousel on why strength training matters",
    "What blog posts do we have, and what's their status?",
    "Draft a blog and get it ready for me to publish",
  ],
  placeholder: "Ask the Marketing agent…  (Enter to send)",
};

const OPERATIONS_CHAT_COPY = {
  subtitle: "recovers no-shows + wins back quiet members, across WhatsApp and email",
  emptyTitle: "Ask the Operations agent to fill gaps and win people back",
  emptyBody:
    "It can find recent no-shows, spot members who've gone quiet, and draft a WhatsApp or email nudge or rebooking for one — nothing sends or books until you click Approve.",
  suggestions: [
    "Who no-showed in the last 2 weeks?",
    "Which members have gone quiet?",
    "Draft a win-back message for my lapsed members",
    "Which classes this week are under-filled?",
  ],
  placeholder: "Ask the Operations agent…  (Enter to send)",
};

const CHAT_COPY: Record<string, typeof SALES_CHAT_COPY> = {
  orchestrator: ORCHESTRATOR_CHAT_COPY,
  sales: SALES_CHAT_COPY,
  marketing: MARKETING_CHAT_COPY,
  operations: OPERATIONS_CHAT_COPY,
};

/**
 * The agent's working chat. Reuses AssistantChat byte-for-byte for the
 * SSE + Approve-card + `/api/assistant/execute` mechanics (see that
 * component's `endpoint` prop doc) — only the endpoint + cosmetic copy differ
 * per agent. Dormant agents (Finance today) get a "coming soon" placeholder
 * instead of a chat, since their `/api/agents/<key>/chat` route 404s (no
 * playbook/tool slice wired yet).
 *
 * The Concierge is active but is its OWN separate case (checked first,
 * below): it deliberately has no `SPECIALISTS` entry (see
 * specialistToolSlice.test.ts's pinned assertion), so `/api/agents/concierge/
 * chat` 404s too — not because it isn't running, but because it only ever
 * runs through the Orchestrator's `delegate_to_concierge` tool
 * (@/lib/agents/tools.orchestrator), never its own direct chat route. Without
 * this case AssistantChat would render a live-looking chat box that replies
 * "Sorry — the assistant is unavailable (404)" to every message — pointing
 * the operator at the Orchestrator instead is the honest version of the same
 * "coming soon" idea. Its model + editable instructions (above, on this same
 * page) still apply the moment it actually runs via delegation.
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

  if (agent.key === "concierge") {
    return (
      <Card style={{ textAlign: "center", padding: "56px 28px" }}>
        <ConciergeBell size={26} strokeWidth={1.5} style={{ color: "var(--text-tertiary)", marginBottom: 14 }} />
        <div
          style={{
            fontFamily: "var(--font-heading), sans-serif",
            fontSize: 18,
            textTransform: "uppercase",
            color: "var(--text-primary)",
            marginBottom: 8,
          }}
        >
          Runs through Adonis
        </div>
        <p style={{ color: "var(--text-tertiary)", fontSize: 13, lineHeight: 1.5, maxWidth: 440, margin: "0 auto 18px" }}>
          The Concierge has no chat of its own — hand it a general, inbox, money, or plan task from Adonis&apos;s
          chat and it delegates automatically. Its model and instructions above still apply whenever it runs.
        </p>
        <Link
          href="/agents/orchestrator"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12.5,
            color: "var(--accent-ink)",
            background: "var(--accent-soft)",
            border: "1px solid var(--accent)",
            borderRadius: "var(--radius)",
            padding: "8px 16px",
            textDecoration: "none",
          }}
        >
          Open Adonis
        </Link>
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
    />
  );
}
