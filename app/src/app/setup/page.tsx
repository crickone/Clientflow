import { PageHeader } from "@/components/layout/PageHeader";
import { getCurrentMembership } from "@/lib/auth";
import { getSetupSummary } from "@/lib/setup/steps";
import { getVenueType, getSchedulingMode } from "@/lib/settings";
import { getBusinessProfile } from "@/lib/businessProfile";
import { SetupChecklist } from "@/components/setup/SetupChecklist";

export const dynamic = "force-dynamic";

export default function SetupPage() {
  const summary = getSetupSummary();
  const isAdmin = getCurrentMembership()?.role === "admin";
  const profile = getBusinessProfile();

  return (
    <div className="app-page" style={{ maxWidth: 860 }}>
      <PageHeader
        eyebrow="Get started"
        title="Set up your account"
        subtitle={`${summary.requiredDone}/${summary.requiredTotal} essentials done — work through the list to get fully up and running.`}
      />
      <SetupChecklist
        summary={summary}
        isAdmin={isAdmin}
        venue={getVenueType()}
        scheduling={getSchedulingMode()}
        businessDefaults={{
          businessName: profile.businessName,
          tagline: profile.tagline,
          location: profile.location,
          phone: profile.phone,
          website: profile.website,
        }}
      />
    </div>
  );
}
