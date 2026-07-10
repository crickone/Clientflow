import { PageHeader } from "@/components/layout/PageHeader";
import { RequestSiteForm } from "@/components/cms/RequestSiteForm";
import { requireUserPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RequestSitePage() {
  await requireUserPage();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="CMS"
        title="Request a new website"
        subtitle="Tell us about the project — we'll review it and start the build."
      />
      <RequestSiteForm />
    </div>
  );
}
