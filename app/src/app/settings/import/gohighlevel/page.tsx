import { PageHeader } from "@/components/layout/PageHeader";
import { GhlImportWizard } from "@/components/settings/ghlImport/GhlImportWizard";
import { requireAdminPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function GhlImportPage() {
  await requireAdminPage();
  return (
    <div className="app-page" style={{ maxWidth: 1100 }}>
      <PageHeader
        eyebrow="Settings"
        title="Import from GoHighLevel"
        subtitle="Upload your exports, check what will happen to each person, then import. The import sends nothing."
      />
      <GhlImportWizard />
    </div>
  );
}
