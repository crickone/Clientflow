import { PageHeader } from "@/components/layout/PageHeader";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { listAgents } from "@/lib/agents/registry";
import {
  getMonthlyUsageByAgent,
  getMonthlyUsageCents,
  MONTHLY_CAP_CENTS,
} from "@/lib/ai/usage";
import { AgentOrgChart } from "@/components/agents/AgentOrgChart";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  await requireAdminPage();
  // requireAdminPage guarantees an admin membership in the active tenant.
  const tenantId = getCurrentMembership()!.tenant.id;

  const agents = listAgents(tenantId);
  const usageByAgent = getMonthlyUsageByAgent(tenantId);
  const monthCents = getMonthlyUsageCents(tenantId);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="AI Staff"
        title="Agents"
        subtitle="One orchestrator routing work to your specialist agents."
      />
      <AgentOrgChart
        agents={agents}
        usageByAgent={usageByAgent}
        capCents={MONTHLY_CAP_CENTS}
        monthCents={monthCents}
      />
    </div>
  );
}
