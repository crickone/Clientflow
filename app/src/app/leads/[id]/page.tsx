import { notFound } from "next/navigation";
import { LeadDetail } from "@/components/leads/LeadDetail";
import { GhlImportCard } from "@/components/people/GhlImportCard";
import { PersonLinksCard } from "@/components/people/PersonLinksCard";
import { mapEnabled } from "@/lib/adonisMap/access";
import { personLinksForLead } from "@/lib/adonisMap/decisions";
import { getCurrentMembership } from "@/lib/auth";
import { getImportedPerson } from "@/lib/ghlImport/store";
import { listAssignableStaff } from "@/lib/leadFlows/assignment";
import { listLeadCalls } from "@/lib/leadFlows/calls";
import { leadFlowStatus } from "@/lib/leadFlows/runs";
import { getLead, getLeadMessages } from "@/lib/leads";
import { listStages } from "@/lib/pipeline/stageRepo";
import { voiceAvailability } from "@/lib/voice/dial";

export const dynamic = "force-dynamic";

export default async function LeadDetailPage(
  props: {
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;
  const id = Number(params.id);
  const lead = getLead(id);
  if (!lead) notFound();
  const messages = getLeadMessages(id);
  const stages = listStages(lead.pipelineId);
  const voice = voiceAvailability();
  const membership = getCurrentMembership();
  const staff = membership ? listAssignableStaff(membership.tenant.id).map((s) => ({ userId: s.userId, name: s.name })) : [];
  const flow = leadFlowStatus(id);
  const calls = listLeadCalls(id).map((c) => ({
    id: c.id,
    kind: c.kind,
    outcome: c.outcome,
    scheduledFor: c.scheduledFor,
    scheduledDay: c.scheduledDay,
    createdAt: c.createdAt,
  }));
  const personLinks = membership && mapEnabled(membership.tenant.id) ? personLinksForLead(membership.tenant.id, id) : null;
  const imported = getImportedPerson({ leadId: id });
  const showLinks = !!personLinks && (personLinks.linked.length > 0 || personLinks.reviews.length > 0);

  return (
    <div className="app-page">
      {showLinks && personLinks && (
        <div style={{ maxWidth: 560, marginBottom: 16 }}>
          <PersonLinksCard linked={personLinks.linked} reviews={personLinks.reviews} />
        </div>
      )}
      <LeadDetail lead={lead} messages={messages} stages={stages} voice={voice} staff={staff} flow={flow} calls={calls} />
      {imported && (
        <div style={{ maxWidth: 560, marginTop: 16 }}>
          <GhlImportCard person={imported} leadId={id} isAdmin={membership?.role === "admin"} />
        </div>
      )}
    </div>
  );
}
