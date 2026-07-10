import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { LeadList } from "@/components/leads/LeadList";
import { listLeads } from "@/lib/leads";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = listLeads();

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Pipeline"
        title="Leads"
        subtitle="Inbound leads from Facebook ads and manual entry. The AI drafts the first follow-up — you review and send."
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
          message={
            "Wire up Zapier or Make.com to POST your Facebook Lead Ads to /api/leads/inbound, " +
            "or add a lead manually to test the flow."
          }
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
        <LeadList leads={leads} />
      )}
    </div>
  );
}
