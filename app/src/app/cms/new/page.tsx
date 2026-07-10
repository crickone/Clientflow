import { PageHeader } from "@/components/layout/PageHeader";
import { AddSiteForm } from "@/components/cms/AddSiteForm";
import { requireAdminPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AddSitePage() {
  await requireAdminPage();
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="CMS"
        title="Add a site"
        subtitle="Provision a new client website. You can import its pages next."
      />
      <AddSiteForm />
    </div>
  );
}
