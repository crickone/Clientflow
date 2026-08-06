import Link from "next/link";
import { Globe, Plus, ExternalLink, Inbox } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireAdminPage } from "@/lib/auth";
import { listSites } from "@/lib/cms/sites";
import { listRequests } from "@/lib/cms/requests";

export const dynamic = "force-dynamic";

export default async function CmsSitesPage({
  searchParams,
}: {
  searchParams: { requested?: string };
}) {
  await requireAdminPage();
  const sites = await listSites();
  const openRequests = listRequests().filter((r) => r.status === "new").length;

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="CMS"
        title="Sites"
        actions={
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <Link href="/cms/requests">
              <Button variant="ghost">
                <Inbox size={15} />
                Requests{openRequests > 0 ? ` (${openRequests})` : ""}
              </Button>
            </Link>
            <Link href="/cms/request">
              <Button variant="outline">Request a new website</Button>
            </Link>
            <Link href="/cms/new">
              <Button>
                <Plus size={15} />
                Add site
              </Button>
            </Link>
          </div>
        }
      />

      {searchParams.requested === "1" && (
        <Card style={{ marginBottom: 20, borderColor: "#3fb950" }}>
          <strong style={{ color: "var(--text-primary)" }}>Request submitted.</strong>{" "}
          <span style={{ color: "var(--text-secondary)" }}>
            We&apos;ll review it and start the build — track it under{" "}
            <Link href="/cms/requests" style={{ color: "var(--accent)" }}>Requests</Link>.
          </span>
        </Card>
      )}

      {sites.length === 0 ? (
        <EmptyState
          icon={<Globe size={32} strokeWidth={1.4} />}
          title="No sites yet"
          message="Sites appear here once a website request has been built."
          action={
            <Link href="/cms/request">
              <Button>
                <Plus size={15} />
                Request a new website
              </Button>
            </Link>
          }
        />
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 16,
          }}
        >
          {sites.map((s) => (
            <Card key={s.id}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 10,
                    background: "var(--surface-2)",
                    display: "grid",
                    placeItems: "center",
                    color: "var(--text-secondary)",
                  }}
                >
                  <Globe size={20} strokeWidth={1.5} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: 15 }}>
                    {s.name}
                  </div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 2 }}>
                    /{s.slug}
                  </div>
                </div>
                <Badge colour={s.status === "live" ? "#3fb950" : "#8b949e"}>
                  {s.status}
                </Badge>
              </div>
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 14,
                  borderTop: "1px solid var(--hairline)",
                  display: "flex",
                  gap: 14,
                  flexWrap: "wrap",
                }}
              >
                <Link href={`/cms/${s.slug}/studio`} style={{ fontSize: 13, color: "var(--accent)" }}>
                  Manage →
                </Link>
                <a
                  href={`/site/${s.slug}?site=${s.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    fontSize: 13,
                    color: "var(--text-tertiary)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  Preview <ExternalLink size={12} />
                </a>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
