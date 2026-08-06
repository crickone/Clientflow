import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/PageHeader";
import { PageEditor, type EditorBlock } from "@/components/cms/PageEditor";
import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { getPage } from "@/lib/cms/pages";
import { listBlocksForPage } from "@/lib/cms/blocks";
import { getSeo } from "@/lib/cms/seo";
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
    </div>
  );
}
