import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { AGENT_CATALOG, getAgent } from "@/lib/agents/registry";
import { SAFETY_RAILS } from "@/lib/agents/context";
import { SALES_SPECIALIST } from "@/lib/agents/specialists/sales";
import { getBusinessContext } from "@/lib/ai/businessContext";
import { getMonthlyUsageByAgent, MONTHLY_CAP_CENTS } from "@/lib/ai/usage";
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
  // runWithTenant(), is correct.
  const layers = {
    base: key === "sales" ? SALES_SPECIALIST.basePlaybook : "You are a helpful business agent.",
    businessContext: getBusinessContext(),
    operator: agent.instructions,
    rails: SAFETY_RAILS,
  };

  const usageCents = getMonthlyUsageByAgent(tenantId)[key] ?? 0;

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
        toolNames={key === "sales" ? SALES_SPECIALIST.toolNames : []}
        usageCents={usageCents}
        capCents={MONTHLY_CAP_CENTS}
        tenantId={tenantId}
      />
    </div>
  );
}
