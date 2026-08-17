import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { listLeadsForBoard } from "@/lib/leads";
import { listStages } from "@/lib/pipeline/stageRepo";
import { getCurrentMembership } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = listLeadsForBoard();
  const stages = listStages();
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

      {leads.length === 0 ? (
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
        <PipelineBoard leads={leads} stages={stages} canManageStages={canManageStages} />
      )}
    </div>
  );
}
