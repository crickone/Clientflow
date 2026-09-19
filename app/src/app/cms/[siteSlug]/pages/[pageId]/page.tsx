import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { PageEditor, type EditorBlock } from "@/components/cms/PageEditor";
import { PageHistory, type HistoryEntry } from "@/components/cms/PageHistory";
import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { getPage } from "@/lib/cms/pages";
import { listBlocksForPage } from "@/lib/cms/blocks";
import { getSeo } from "@/lib/cms/seo";
import { listRevisions } from "@/lib/cms/pageRevisions";
import { authDb } from "@/lib/db/control";
import { users } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { getTemplate } from "@/lib/cms/templates";
// Side-effect: register site-specific templates so getTemplate("clientflow-live")
// resolves to its friendly label instead of undefined (→ raw id).
import "@/lib/cms/registerTemplates";

export const dynamic = "force-dynamic";

export default async function EditPagePage({
  params,
}: {
  params: { siteSlug: string; pageId: string };
}) {
  await requireAdminPage();
  const site = await getSiteBySlug(params.siteSlug);
  if (!site) notFound();
  const page = getPage(site.id, Number(params.pageId));
  if (!page) notFound();

  const tpl = getTemplate(page.templateId);
  const stored = listBlocksForPage(site.id, page.id);
  const rowByName = new Map(stored.map((b) => [b.name, b]));

  const blocks: EditorBlock[] = (tpl?.blocks ?? []).map((spec) => {
    const row = rowByName.get(spec.name);
    const value =
      spec.kind === "image"
        ? row?.mediaAssetId
          ? String(row.mediaAssetId)
          : ""
        : row?.value ?? spec.fallback ?? "";
    return { name: spec.name, kind: spec.kind, label: spec.label, value };
  });

  const seo = getSeo(site.id, page.id);
  const cleanPath = page.path === "/" ? "" : page.path;
  const previewUrl = site.primaryHost
    ? `https://${site.primaryHost}${cleanPath || "/"}`
    : `${"/site/"}${site.slug}${cleanPath}`;

  // Version history. Names are resolved here rather than stored on the
  // revision: a person can be renamed, and a history that keeps saying what
  // they used to be called is a small lie that gets worse with time.
  const revisions = listRevisions(site.id, page.id);
  const ids = [...new Set(revisions.map((r) => r.createdBy).filter((v): v is number => v != null))];
  const nameById = new Map<number, string>();
  if (ids.length > 0) {
    for (const u of authDb
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, ids))
      .all()) {
      nameById.set(u.id, u.name || u.email);
    }
  }
  const history: HistoryEntry[] = revisions.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    source: r.source,
    by: r.createdBy != null ? nameById.get(r.createdBy) ?? null : null,
    note: r.note,
    chars: r.body.length,
  }));

  return (
    <div className="app-page">
      <PageHeader eyebrow={`CMS · ${site.name} · Pages`} title={page.title || page.path} />
      <PageEditor
        siteSlug={site.slug}
        page={{
          id: page.id,
          title: page.title ?? "",
          path: page.path,
          status: page.status,
          templateLabel: tpl?.label ?? page.templateId,
        }}
        blocks={blocks}
        previewUrl={previewUrl}
        seo={{
          seoTitle: seo?.seoTitle ?? "",
          seoDescription: seo?.seoDescription ?? "",
          canonicalUrl: seo?.canonicalUrl ?? "",
          robots: seo?.robots ?? "index,follow",
          ogImageAssetId: seo?.ogImageAssetId ? String(seo.ogImageAssetId) : "",
        }}
      />
      <PageHistory siteSlug={site.slug} pageId={page.id} entries={history} />
    </div>
  );
}
