import { PageHeader } from "@/components/layout/PageHeader";
import { requireAdminPage } from "@/lib/auth";
import { CATALOG } from "@/lib/dashboard/catalog";
import { DOMAIN_LABELS, type WidgetMeta } from "@/lib/dashboard/types";
import { staffCanSeeByDefault } from "@/lib/dashboard/visibility";
import { getVisibilityOverrides } from "@/lib/dashboard/visibilityStore";
import { VisibilityTable, type VisibilityRow } from "./VisibilityTable";

export const dynamic = "force-dynamic";

export default async function DashboardSettingsPage() {
  await requireAdminPage();
  const overrides = getVisibilityOverrides();
  const rows: VisibilityRow[] = (CATALOG as readonly WidgetMeta[]).map((m) => ({
    key: m.key,
    title: m.title,
    description: m.description,
    domainLabel: DOMAIN_LABELS[m.domain],
    sensitivity: m.sensitivity,
    visible: typeof overrides[m.key] === "boolean" ? overrides[m.key] : staffCanSeeByDefault(m),
    overridden: typeof overrides[m.key] === "boolean",
  }));
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Settings"
        title="Dashboard widgets"
        subtitle="Choose which dashboard widgets staff can see. Admins always see everything."
      />
      <VisibilityTable rows={rows} />
    </div>
  );
}
