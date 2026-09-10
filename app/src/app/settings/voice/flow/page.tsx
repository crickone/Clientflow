import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { requireAdminPage } from "@/lib/auth";
import { getCurrentTenantDb } from "@/lib/db/tenant";
import { describeFlow, getCallFlow } from "@/lib/voice/flow";
import { listPending } from "@/lib/voice/queue";
import { listStages } from "@/lib/pipeline/stageRepo";
import { getLead } from "@/lib/leads";
import { CallFlowView } from "@/components/settings/CallFlowView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Call flow — AdonisAgent" };

export default async function CallFlowPage() {
  await requireAdminPage();
  const flow = getCallFlow();
  const tdb = getCurrentTenantDb();

  const pending = listPending(tdb, 20).map((item) => {
    const lead = getLead(item.leadId);
    return {
      leadName:
        [lead?.firstName, lead?.lastName].filter(Boolean).join(" ").trim() ||
        lead?.phone ||
        `Lead #${item.leadId}`,
      dueAt: item.dueAt,
      attempt: item.attempt,
    };
  });

  return (
    <div className="app-page" style={{ maxWidth: 780 }}>
      <PageHeader
        eyebrow="Voice agent"
        title="Call flow"
        subtitle="What happens when a new lead arrives. Click any step to change it."
        actions={
          <Link href="/settings/voice">
            <Button variant="outline">
              <ArrowLeft size={15} />
              Voice agent
            </Button>
          </Link>
        }
      />
      <CallFlowView
        flow={flow}
        steps={describeFlow(flow)}
        // A tenant-added custom stage has no fixed role, and the flow refers to
        // stages BY role (roles are frozen; names are tenant-editable and would
        // break the setting on a rename) — so custom stages aren't offerable here.
        stageOptions={listStages()
          .filter((s): s is typeof s & { role: string } => !!s.role)
          .map((s) => ({ role: s.role, name: s.name }))}
        pending={pending}
      />
    </div>
  );
}
