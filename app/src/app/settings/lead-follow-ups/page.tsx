import { PageHeader } from "@/components/layout/PageHeader";
import { LeadFollowUpsForm } from "@/components/settings/LeadFollowUpsForm";
import { getCurrentMembership, requireAdminPage } from "@/lib/auth";
import { listAssignableStaff } from "@/lib/leadFlows/assignment";
import { getLeadFlowSettings } from "@/lib/leadFlows/settings";

export const dynamic = "force-dynamic";

export default async function LeadFollowUpsSettingsPage() {
  await requireAdminPage();
  // requireAdminPage guarantees a membership in the active business.
  const tenantId = getCurrentMembership()!.tenant.id;
  const staff = listAssignableStaff(tenantId).map((s) => ({ userId: s.userId, name: s.name }));
  return (
    <div className="app-page" style={{ maxWidth: 720 }}>
      <PageHeader eyebrow="Settings" title="Lead follow-ups" subtitle="When follow-up messages go out, who new leads go to, and where staff alerts are sent." />
      <LeadFollowUpsForm initial={getLeadFlowSettings()} staff={staff} />
    </div>
  );
}
