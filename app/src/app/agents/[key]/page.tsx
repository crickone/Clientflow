import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { AGENT_CATALOG, getAgent } from "@/lib/agents/registry";
import { SAFETY_RAILS } from "@/lib/agents/context";
import { SPECIALISTS } from "@/lib/agents/specialists";
import { getBusinessContext } from "@/lib/ai/businessContext";
import { getMonthlyUsageByAgent, getTenantCapCents } from "@/lib/ai/usage";
import { conciergeToolSlice } from "@/lib/assistant/tools";
import { getSchedulingMode } from "@/lib/settings";
import { isDriveConnected } from "@/lib/gmail";
import { AgentDetail } from "@/components/agents/AgentDetail";

export const dynamic = "force-dynamic";

export default async function AgentDetailPage({ params }: { params: { key: string } }) {
  await requireAdminPage();
  // requireAdminPage guarantees an admin membership in the active tenant.
  const tenantId = getCurrentMembership()!.tenant.id;

  const key = params.key;
  const agent = getAgent(tenantId, key);
  if (!agent) notFound();

  const catalogEntry = AGENT_CATALOG.find((a) => a.key === key);
  // Same registry composeAgentSystem (@/lib/agents/context) reads from — see
  // that file's `SPECIALISTS[key]?.basePlaybook ?? "..."` fallback, mirrored
  // exactly below so this page never drifts from what a real chat run sends.
  const spec = SPECIALISTS[key];

  // The Concierge is deliberately NOT a SPECIALISTS entry (see
  // specialistToolSlice.test.ts's pinned `!("concierge" in SPECIALISTS)`
  // assertion) — its base "playbook" + tool slice are computed at RUNTIME by
  // buildAssistantSystem/conciergeToolSlice (@/lib/agents/tools.orchestrator's
  // delegateToConcierge) rather than a fixed registry entry, so `spec` above
  // is `undefined` for it. Without this, the generic fallbacks below would
  // show a meaningless "You are a helpful business agent." line and falsely
  // claim it has NO tools ("this agent isn't running") for an agent that
  // actually has the full general toolkit — handled gracefully here instead,
  // per Requirement 5 (.superpowers/sdd/concierge-agent-brief.md): the base
  // layer explains its remit + that it's the general toolkit, and the Tools
  // card gets its REAL current tool slice, computed the exact same way
  // `delegateToConcierge` computes it for a live run.
  const isConcierge = key === "concierge";
  const conciergeToolNames = isConcierge
    ? conciergeToolSlice(getSchedulingMode(), isDriveConnected(tenantId)).map((t) => t.name)
    : [];

  // The 4 raw composition layers, sourced exactly the way composeAgentSystem
  // (@/lib/agents/context) builds them for a real run — but kept SEPARATE
  // (rather than calling composeAgentSystem and getting one flattened
  // string) so the UI can render each as its own labelled, individually
  // read-only card. This intentionally mirrors context.ts's layering without
  // modifying that file.
  //
  // Ambient tenant note (see composeAgentSystem's own doc comment):
  // getBusinessContext() takes no tenantId and instead reads the AMBIENT
  // tenant via the `@/lib/db` request-scoped proxy. In this normal
  // server-page request that ambient tenant IS the admin's active tenant —
  // both `tenantId` above and the ambient one resolve from the same signed-in
  // session/membership — so calling it directly here, with no
  // runWithTenant(), is correct. `getSchedulingMode()` (@/lib/settings) reads
  // that same ambient tenant the same way; `isDriveConnected(tenantId)` takes
  // an explicit tenantId and has no ambient dependency at all.
  const layers = {
    base:
      spec?.basePlaybook ??
      (isConcierge
        ? "You are the Concierge — the general business assistant: inbox/email + WhatsApp, invoices & money, nutrition/workout plans, admin, and anything else outside Sales/Marketing/Operations. You have no single fixed playbook — your system prompt and full toolkit (see Tools, right) are computed fresh for every task from this account's current scheduling mode and Google Drive connection."
        : "You are a helpful business agent."),
    businessContext: getBusinessContext(),
    operator: agent.instructions,
    rails: SAFETY_RAILS,
  };

  const usageCents = getMonthlyUsageByAgent(tenantId)[key] ?? 0;
  const capCents = getTenantCapCents(tenantId);

  // Computed here (server component — process.env is safe to read) and
  // passed down as a plain boolean prop: AgentDetail is "use client" and
  // must never read process.env itself (env vars aren't guaranteed to be
  // inlined for client bundles the way NEXT_PUBLIC_* ones are), and the key
  // itself must never reach the client at all. This is the only thing the
  // picker needs to know to gate the DeepSeek/OpenRouter option.
  const openRouterConfigured = !!process.env.OPENROUTER_API_KEY;

  return (
    <div className="app-page">
      <Link
        href="/agents"
        style={{
          color: "var(--text-tertiary)",
          fontSize: 13,
          marginBottom: 24,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          textDecoration: "none",
        }}
      >
        <ArrowLeft size={14} /> Back to Agents
      </Link>
      <PageHeader eyebrow="AI Staff" title={agent.name} subtitle={catalogEntry?.mandate} />
      <AgentDetail
        // Forces a fresh mount (and thus fresh useState seeding — model
        // picker, operator-instructions dirty state) if this ever renders for
        // a DIFFERENT agent key without an intervening unmount, e.g. a future
        // direct agent-to-agent link. Without this, React would reuse the
        // component instance across a client-side navigation and carry over
        // the previous agent's local state.
        key={agent.key}
        agent={agent}
        layers={layers}
        toolNames={isConcierge ? conciergeToolNames : spec?.toolNames ?? []}
        usageCents={usageCents}
        capCents={capCents}
        tenantId={tenantId}
        openRouterConfigured={openRouterConfigured}
      />
    </div>
  );
}
