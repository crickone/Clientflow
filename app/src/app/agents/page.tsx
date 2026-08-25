import { PageHeader } from "@/components/layout/PageHeader";
import { requireAdminPage, getCurrentMembership } from "@/lib/auth";
import { listAgents } from "@/lib/agents/registry";
import {
  getMonthlyUsageByAgent,
  getMonthlyUsageByModel,
  getMonthlyUsageCents,
  getTenantCapCents,
} from "@/lib/ai/usage";
import { getAiBalanceCents, listAiLedger } from "@/lib/ai/creditsLedger";
import { AgentOrgChart } from "@/components/agents/AgentOrgChart";
import { AiCreditsCard } from "@/components/agents/AiCreditsCard";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  await requireAdminPage();
  // requireAdminPage guarantees an admin membership in the active tenant.
  const tenantId = getCurrentMembership()!.tenant.id;

  const agents = listAgents(tenantId);
  const usageByAgent = getMonthlyUsageByAgent(tenantId);
  const usageByModel = getMonthlyUsageByModel(tenantId);
  const monthCents = getMonthlyUsageCents(tenantId);
  const capCents = getTenantCapCents(tenantId);
  const aiBalanceCents = getAiBalanceCents(tenantId);
  const aiLedger = listAiLedger(tenantId, 8);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="AI Staff"
        title="Agents"
        subtitle="Adonis handles the business directly — specialist agents are here for deep-dive work."
      />
      <AgentOrgChart
        agents={agents}
        usageByAgent={usageByAgent}
        usageByModel={usageByModel}
        capCents={capCents}
        monthCents={monthCents}
      />
      <AiCreditsCard
        monthCents={monthCents}
        freeTrancheCents={capCents}
        balanceCents={aiBalanceCents}
        ledger={aiLedger}
      />
    </div>
  );
}
