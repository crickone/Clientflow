import "server-only";

import type { Metadata } from "next";
import { headers } from "next/headers";

import { resolvePublicSite, absoluteUrl, siteUrl, type PublicSite } from "@/lib/cms/resolveHost";
import { getPublishedPageByPath } from "@/lib/cms/pages";
import { getSeoPublic } from "@/lib/cms/seo";
import { getTemplate, type TemplateDef } from "@/lib/cms/templates";
import { getCurrentMembership } from "@/lib/auth";
import { getBlockValue } from "@/lib/cms/blocks";
import { sanitizeHtmlKeepStyles } from "@/lib/cms/html";
import type { RenderCtx } from "@/components/cms/Block";
import type { Page } from "@/lib/db/schema";
// Side-effect import: registers site-specific templates (Renova etc.).
import "@/lib/cms/registerTemplates";

export interface PageContext {
  resolved: PublicSite;
  page: Page;
  ctx: RenderCtx;
  template: TemplateDef | null;
  host: string | null;
  path: string;
}

function pathFromSlug(slug?: string[]): string {
  if (!slug || slug.length === 0) return "/";
  return "/" + slug.map((s) => decodeURIComponent(s)).join("/");
}

export function resolvePageContext(
  params: { siteSlug: string; slug?: string[] },
  searchParams: { site?: string },
): PageContext | null {
  const host = headers().get("host");
  const resolved = resolvePublicSite({
    host,
    siteParam: searchParams.site ?? params.siteSlug,
  });
  if (!resolved) return null;

  const path = pathFromSlug(params.slug);
  const page = getPublishedPageByPath(resolved.db, resolved.site.id, path);
  if (!page) return null;

  const ctx: RenderCtx = {
    db: resolved.db,
    siteId: resolved.site.id,
    siteSlug: resolved.site.slug,
    pageId: page.id,
  };
  return { resolved, page, ctx, template: getTemplate(page.templateId), host, path };
}

/** Admin-only: is the current request allowed to use the in-place editor? */
export function canEditNow(): boolean {
  return getCurrentMembership()?.role === "admin";
}

/** Page body HTML with scripts stripped, for stable editing in the Studio. */
export function editBodyHtml(pc: PageContext): string {
  const row = getBlockValue(pc.ctx.db, pc.ctx.siteId, pc.ctx.pageId, "body");
  return sanitizeHtmlKeepStyles(row?.value ?? "");
}

export function buildPageMetadata(pc: PageContext): Metadata {
  const seo = getSeoPublic(pc.resolved.db, pc.resolved.site.id, pc.page.id);
  const title = seo?.seoTitle || pc.page.title || pc.resolved.site.name;
  const description = seo?.seoDescription || undefined;
  const canonical = seo?.canonicalUrl || siteUrl(pc.resolved, pc.path, pc.host);
  const ogImages = seo?.ogImageAssetId
    ? [absoluteUrl(pc.resolved, `/site-media/${pc.resolved.site.slug}/${seo.ogImageAssetId}`, pc.host)]
    : undefined;
  return {
    title:
      title === pc.resolved.site.name ? title : `${title} — ${pc.resolved.site.name}`,
    description,
    alternates: { canonical },
    robots: seo?.robots || undefined,
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: pc.resolved.site.name,
      images: ogImages,
    },
  };
}
