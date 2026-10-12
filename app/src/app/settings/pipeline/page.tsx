import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { requireAdminPage } from "@/lib/auth";
import { listStages } from "@/lib/pipeline/stageRepo";
import { defaultPipelineId } from "@/lib/pipeline/pipelineRepo";
import { PipelineStagesManager } from "@/components/settings/PipelineStagesManager";

export const dynamic = "force-dynamic";

export default async function PipelineSettingsPage() {
  await requireAdminPage();
  // requireAdminPage guarantees an admin membership in the active tenant;
  // listStages() reads against that same request-scoped tenant DB.
  const pipelineId = defaultPipelineId();
  const stages = listStages(pipelineId);

  return (
    <div className="app-page" style={{ maxWidth: 1000 }}>
      <PageHeader
        eyebrow="Configure"
        title="Pipeline"
        subtitle="Add, rename, reorder or recolour the stages leads move through. Tag a stage with a role to wire up the automations."
      />
      <PipelineStagesManager stages={stages} pipelineId={pipelineId} />
    </div>
  );
}
