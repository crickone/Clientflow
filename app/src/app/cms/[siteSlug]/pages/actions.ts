"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdminPage } from "@/lib/auth";
import { getSiteBySlug } from "@/lib/cms/sites";
import { upsertPage, setPageStatus, getPage } from "@/lib/cms/pages";
import { upsertBlock } from "@/lib/cms/blocks";
import { upsertSeo } from "@/lib/cms/seo";
import { getTemplate } from "@/lib/cms/templates";
import { db, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";

async function siteOrThrow(siteSlug: string) {
  await requireAdminPage();
  const site = await getSiteBySlug(siteSlug);
  if (!site) throw new Error(`Unknown site: ${siteSlug}`);
  return site;
}

function normalizePath(p: string): string {
  let path = p.trim();
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

export type NewPageState = { ok: boolean; error?: string };

export async function createPageAction(
  siteSlug: string,
  _prev: NewPageState,
  formData: FormData,
): Promise<NewPageState> {
  const site = await siteOrThrow(siteSlug);
  const templateId = String(formData.get("templateId") ?? "").trim();
  const path = normalizePath(String(formData.get("path") ?? ""));
  const title = String(formData.get("title") ?? "").trim();
  if (!templateId || !getTemplate(templateId))
    return { ok: false, error: "Pick a valid template." };
  if (!path) return { ok: false, error: "A path is required." };

  let pageId: number;
  try {
    pageId = upsertPage({
      siteId: site.id,
      pageKey: title || path,
      path,
      title: title || path,
      templateId,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not create page.",
    };
  }
  revalidatePath(`/cms/${siteSlug}/pages`);
  redirect(`/cms/${siteSlug}/pages/${pageId}`);
}

export async function savePageAction(
  siteSlug: string,
  pageId: number,
  formData: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const site = await siteOrThrow(siteSlug);
  const page = getPage(site.id, pageId);
  if (!page) return { ok: false, error: "Page not found." };
  const tpl = getTemplate(page.templateId);
  if (!tpl) return { ok: false, error: "Unknown template." };

  // Save each declared block from its form field. Image blocks store a media
  // asset id; text/richtext/html store their string value.
  for (const spec of tpl.blocks) {
    const raw = formData.get(`block__${spec.name}`);
    if (spec.kind === "image") {
      const id = Number(raw);
      upsertBlock({
        siteId: site.id,
        pageId: page.id,
        name: spec.name,
        kind: "image",
        value: null,
        mediaAssetId: Number.isFinite(id) && id > 0 ? id : null,
      });
    } else {
      upsertBlock({
        siteId: site.id,
        pageId: page.id,
        name: spec.name,
        kind: spec.kind,
        value: raw == null ? null : String(raw),
      });
    }
  }

  // Page title + SEO.
  const title = String(formData.get("title") ?? "").trim();
  if (title) {
    db.update(schema.pages)
      .set({ title, updatedAt: new Date() })
      .where(and(eq(schema.pages.siteId, site.id), eq(schema.pages.id, page.id)))
      .run();
  }
  const ogId = Number(formData.get("ogImageAssetId"));
  upsertSeo(site.id, page.id, {
    seoTitle: String(formData.get("seoTitle") ?? "").trim() || null,
    seoDescription: String(formData.get("seoDescription") ?? "").trim() || null,
    canonicalUrl: String(formData.get("canonicalUrl") ?? "").trim() || null,
    robots: String(formData.get("robots") ?? "").trim() || "index,follow",
    ogImageAssetId: Number.isFinite(ogId) && ogId > 0 ? ogId : null,
  });

  revalidatePath(`/cms/${siteSlug}/pages/${pageId}`);
  return { ok: true };
}

export async function publishPageAction(siteSlug: string, pageId: number) {
  const site = await siteOrThrow(siteSlug);
  setPageStatus(site.id, pageId, "published");
  revalidatePath(`/cms/${siteSlug}/pages/${pageId}`);
  revalidatePath(`/cms/${siteSlug}/pages`);
}

export async function unpublishPageAction(siteSlug: string, pageId: number) {
  const site = await siteOrThrow(siteSlug);
  setPageStatus(site.id, pageId, "draft");
  revalidatePath(`/cms/${siteSlug}/pages/${pageId}`);
  revalidatePath(`/cms/${siteSlug}/pages`);
}

export async function deletePageAction(siteSlug: string, pageId: number) {
  const site = await siteOrThrow(siteSlug);
  db.delete(schema.pages)
    .where(and(eq(schema.pages.siteId, site.id), eq(schema.pages.id, pageId)))
    .run();
  revalidatePath(`/cms/${siteSlug}/pages`);
  redirect(`/cms/${siteSlug}/pages`);
}
