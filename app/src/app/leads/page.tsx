import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { listLeadsForBoard } from "@/lib/leads";
import { listStages } from "@/lib/pipeline/stageRepo";
import { defaultPipelineId, listPipelines } from "@/lib/pipeline/pipelineRepo";
import { getCurrentMembership } from "@/lib/auth";
import { readKey } from "@/lib/settings";
import { zonedTimeToUtc } from "@/lib/leadFlows/sendingWindow";

export const dynamic = "force-dynamic";

export default async function LeadsPage(props: { searchParams?: Promise<{ pipeline?: string }> }) {
  const searchParams = await props.searchParams;
  // One board per campaign: `?pipeline=<id>` picks the board, the default
  // board when absent or unknown. Leads and stages are both read for THAT
  // board only, so a campaign's sign-ups never mix into the main funnel.
  const pipelines = listPipelines();
  const requested = Number(searchParams?.pipeline);
  const activePipelineId = pipelines.some((p) => p.id === requested) ? requested : defaultPipelineId();
  // The day this business started running its leads here: figures and "waiting" count from it.
  const sinceDay = readKey<string | null>("lead_figures_since", null);
  const figuresSince = sinceDay && /^\d{4}-\d{2}-\d{2}$/.test(sinceDay) ? zonedTimeToUtc(sinceDay, "00:00") : null;
  const leads = listLeadsForBoard(activePipelineId).map((l) => (figuresSince != null && l.createdAt.getTime() < figuresSince ? { ...l, beforeFigures: true } : l));
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

      {/* The stages always show, so an account with no leads yet still sees
          the funnel its leads will move through. */}
      {leads.length === 0 && (
        <div className="leads-empty-hint">
          <Sparkles size={15} strokeWidth={1.75} />
          <span>
            No leads yet. Facebook Lead Ads land in the first column once a Page is connected, or add one manually to
            test the flow.
          </span>
        </div>
      )}
      <PipelineBoard leads={leads} stages={stages} canManageStages={canManageStages} pipelines={pipelines} activePipelineId={activePipelineId} figuresSince={figuresSince} />
    </div>
  );
}
