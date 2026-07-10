import Link from "next/link";
import { notFound } from "next/navigation";
import { Newspaper, Plus } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { listSiteBlogPosts } from "@/lib/cms/blog";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

const STATE_COLOUR: Record<string, string> = {
  published: "#3fb950",
  scheduled: "#d29922",
  draft: "#8b949e",
};

export default async function SiteBlogList({
  params,
}: {
  params: { siteSlug: string };
}) {
  await requireAdminPage();
  const site = await getSiteBySlug(params.siteSlug);
  if (!site) notFound();
  const posts = listSiteBlogPosts(site.id);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow={`CMS · ${site.name}`}
        title="Blog"
        actions={
          <Link href={`/cms/${site.slug}/blog/new`}>
            <Button>
              <Plus size={15} />
              New post
            </Button>
          </Link>
        }
      />

      {posts.length === 0 ? (
        <EmptyState
          icon={<Newspaper size={32} strokeWidth={1.4} />}
          title="No posts yet"
          message="Draft a post with AI, edit it, set its SEO, then publish."
          action={
            <Link href={`/cms/${site.slug}/blog/new`}>
              <Button>
                <Plus size={15} />
                New post
              </Button>
            </Link>
          }
        />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {posts.map((p) => (
            <Link key={p.id} href={`/cms/${site.slug}/blog/${p.id}`} style={{ display: "block" }}>
              <Card style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: 15 }}>
                    {p.title}
                  </div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 3 }}>
                    /{p.slug ?? "—"} · updated {formatDate(new Date(p.updatedAt).toISOString())}
                  </div>
                </div>
                {p.status !== "ready" && (
                  <Badge colour={p.status === "failed" ? "#f85149" : "#58a6ff"}>
                    {p.status === "generating" ? "generating…" : p.status}
                  </Badge>
                )}
                <Badge colour={STATE_COLOUR[p.publishState] ?? "#8b949e"}>
                  {p.publishState}
                </Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
