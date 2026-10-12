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
    <div className="app-page">
      <PageHeader
        eyebrow="Get started"
        title="Set up your account"
        subtitle="Everything the account needs to run fully. Each step ticks itself off once it is done."
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
