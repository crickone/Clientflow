import { notFound } from "next/navigation";
import { LeadDetail } from "@/components/leads/LeadDetail";
import { getLead, getLeadMessages } from "@/lib/leads";
import { listStages } from "@/lib/pipeline/stageRepo";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  const lead = getLead(id);
  if (!lead) notFound();
  const messages = getLeadMessages(id);
  const stages = listStages();

  return (
    <div className="app-page">
      <LeadDetail lead={lead} messages={messages} stages={stages} />
    </div>
  );
}
