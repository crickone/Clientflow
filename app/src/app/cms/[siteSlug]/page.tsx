import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, FileText, Globe, Image as ImageIcon, Newspaper, Pencil } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";

export const dynamic = "force-dynamic";

const SECTIONS = [
  { key: "pages", label: "Pages", icon: FileText, desc: "Edit page content blocks" },
  { key: "blog", label: "Blog", icon: Newspaper, desc: "Write & publish posts" },
  { key: "media", label: "Media", icon: ImageIcon, desc: "Images & uploads" },
  { key: "domains", label: "Domains", icon: Globe, desc: "Map hostnames to this site" },
] as const;

export default async function SiteDashboard({
  params,
}: {
  params: { siteSlug: string };
}) {
  await requireAdminPage();
  const site = await getSiteBySlug(params.siteSlug);
  if (!site) notFound();

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="CMS · Site"
        title={site.name}
        subtitle={site.primaryHost ?? `/${site.slug}`}
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <a
              href={`/site/${site.slug}?site=${site.slug}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                color: "var(--text-secondary)",
              }}
            >
              Preview <ExternalLink size={13} />
            </a>
            <Link href={`/cms/${site.slug}/studio`}>
              <Button>
                <Pencil size={15} />
                Open visual editor
              </Button>
            </Link>
          </div>
        }
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        {SECTIONS.map(({ key, label, icon: Icon, desc }) => (
          <Link key={key} href={`/cms/${site.slug}/${key}`} style={{ display: "block" }}>
            <Card>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Icon size={20} strokeWidth={1.5} />
                <div style={{ color: "var(--text-primary)", fontWeight: 500 }}>{label}</div>
              </div>
              <p style={{ color: "var(--text-tertiary)", fontSize: 13, marginTop: 10 }}>
                {desc}
              </p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
