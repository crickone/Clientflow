import { notFound } from "next/navigation";
import { LeadDetail } from "@/components/leads/LeadDetail";
import { getLead, getLeadMessages } from "@/lib/leads";

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

  return (
    <div className="app-page">
      <LeadDetail lead={lead} messages={messages} />
    </div>
  );
}
