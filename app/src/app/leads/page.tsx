import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { listLeadsForBoard } from "@/lib/leads";
import { listStages } from "@/lib/pipeline/stageRepo";
import { defaultPipelineId, listPipelines } from "@/lib/pipeline/pipelineRepo";
import { getCurrentMembership } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ searchParams }: { searchParams?: { pipeline?: string } }) {
  // One board per campaign: `?pipeline=<id>` picks the board, the default
  // board when absent or unknown. Leads and stages are both read for THAT
  // board only, so a campaign's sign-ups never mix into the main funnel.
  const pipelines = listPipelines();
  const requested = Number(searchParams?.pipeline);
  const activePipelineId = pipelines.some((p) => p.id === requested) ? requested : defaultPipelineId();
  const leads = listLeadsForBoard(activePipelineId);
  const stages = listStages(activePipelineId);
  // Only admins get the "Manage stages" affordance on the board (the editor
  // actions are admin-guarded server-side too).
  const canManageStages = getCurrentMembership()?.role === "admin";

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Pipeline"
        title="Leads"
        subtitle="Drag leads through the funnel as they progress. New Facebook and manual leads land in the first column — respond fast."
        actions={
          <Link href="/leads/new">
            <Button>
              <Plus size={15} />
              Add lead
            </Button>
          </Link>
        }
      />

      {leads.length === 0 && pipelines.length <= 1 ? (
        <EmptyState
          icon={<Sparkles size={32} strokeWidth={1.4} />}
          title="No leads yet"
          message="Facebook Lead Ads flow in automatically once a Page is connected, or add a lead manually to test the flow."
          action={
            <Link href="/leads/new">
              <Button>
                <Plus size={15} />
                Add lead manually
              </Button>
            </Link>
          }
        />
      ) : (
        <PipelineBoard leads={leads} stages={stages} canManageStages={canManageStages} pipelines={pipelines} activePipelineId={activePipelineId} />
      )}
    </div>
  );
}
