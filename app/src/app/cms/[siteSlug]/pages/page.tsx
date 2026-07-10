import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { listPages } from "@/lib/cms/pages";
import { listTemplates } from "@/lib/cms/templates";
import { NewPageForm } from "@/components/cms/NewPageForm";

export const dynamic = "force-dynamic";

export default async function SitePagesList({
  params,
}: {
  params: { siteSlug: string };
}) {
  await requireAdminPage();
  const site = await getSiteBySlug(params.siteSlug);
  if (!site) notFound();
  const pages = listPages(site.id);
  const templates = listTemplates().map((t) => ({ id: t.id, label: t.label }));

  return (
    <div className="app-page">
      <PageHeader eyebrow={`CMS · ${site.name}`} title="Pages" />

      <div style={{ marginBottom: 28 }}>
        <NewPageForm siteSlug={site.slug} templates={templates} />
      </div>

      {pages.length === 0 ? (
        <p style={{ color: "var(--text-tertiary)" }}>No pages yet — create one above.</p>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {pages.map((p) => (
            <Link key={p.id} href={`/cms/${site.slug}/pages/${p.id}`} style={{ display: "block" }}>
              <Card style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <FileText size={18} strokeWidth={1.5} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>
                    {p.title || p.path}
                  </div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 12 }}>
                    {p.path} · {p.templateId}
                  </div>
                </div>
                <Badge colour={p.status === "published" ? "#3fb950" : "#8b949e"}>
                  {p.status}
                </Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
