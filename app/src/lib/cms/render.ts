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
import { splitPageBody, type PageBodyZones } from "@/lib/cms/pageBody";
import { getDraftContentFrom } from "@/lib/cms/pageDraft";
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

/**
 * Page body HTML with scripts stripped, for stable editing in the Studio.
 *
 * NOTE: kept alongside editBodyZones (below) rather than replaced. The two
 * public site routes (src/app/site/[siteSlug]/page.tsx and
 * src/app/site/[siteSlug]/[...slug]/page.tsx) still import this to feed
 * RenovaEditCanvas; repointing them at editBodyZones/the new canvas belongs to
 * a later task. Remove this once those routes no longer call it.
 */
export function editBodyHtml(pc: PageContext): string {
  const row = getBlockValue(pc.ctx.db, pc.ctx.siteId, pc.ctx.pageId, "body");
  return sanitizeHtmlKeepStyles(row?.value ?? "");
}

/**
 * The Studio canvas's view of a page: its three zones (see lib/cms/pageBody),
 * with the DRAFT content zone substituted when one exists.
 *
 * Deliberately NOT sanitised. The live clientflow-live template already renders
 * this exact stored HTML verbatim, scripts included, on the same origin; the
 * canvas is admin-only (canEditNow) and renders strictly less than the live
 * page does (it never renders `tail`). Running it through
 * sanitizeHtmlKeepStyles here was not a security boundary — that sanitiser
 * drops <style> by design, which is what left the canvas unstyled and would
 * have written a CSS-less body back over the live page on the first save.
 */
export function editBodyZones(
  pc: PageContext,
): PageBodyZones & { hasDraft: boolean } {
  // Both reads MUST resolve through the same host-resolved db (pc.ctx.db,
  // from resolvePublicSite) rather than mixing in the ambient session-tenant
  // proxy: an agency staffer's active tenant (their session cookie) can
  // differ from the tenant that owns the host/domain being viewed, and
  // siteId/pageId are per-tenant numeric ids that collide across tenant
  // databases. See getDraftContentFrom's doc comment in lib/cms/pageDraft.ts.
  const row = getBlockValue(pc.ctx.db, pc.ctx.siteId, pc.ctx.pageId, "body");
  const zones = splitPageBody(row?.value ?? "");
  const draft = getDraftContentFrom(pc.ctx.db, pc.ctx.siteId, pc.ctx.pageId);
  return {
    ...zones,
    content: draft ?? zones.content,
    hasDraft: draft != null,
  };
}

/** Per-site default OpenGraph image (a static asset shipped with the site),
 *  used when a page has no explicit media-library OG image. Scoped by slug so
 *  other tenants are unaffected. */
const SITE_OG_DEFAULTS: Record<string, string> = {
  clientflow: "/sites/clientflow/assets/og.png",
};

export function buildPageMetadata(pc: PageContext): Metadata {
  const seo = getSeoPublic(pc.resolved.db, pc.resolved.site.id, pc.page.id);
  const title = seo?.seoTitle || pc.page.title || pc.resolved.site.name;
  const description = seo?.seoDescription || undefined;
  const canonical = seo?.canonicalUrl || siteUrl(pc.resolved, pc.path, pc.host);
  // Per-page OG image (media library asset) wins; otherwise a site can ship a
  // default share image at /sites/<slug>/assets/og.png (see SITE_OG_DEFAULTS).
  const ogImages = seo?.ogImageAssetId
    ? [absoluteUrl(pc.resolved, `/site-media/${pc.resolved.site.slug}/${seo.ogImageAssetId}`, pc.host)]
    : SITE_OG_DEFAULTS[pc.resolved.site.slug]
      ? [absoluteUrl(pc.resolved, SITE_OG_DEFAULTS[pc.resolved.site.slug], pc.host)]
      : undefined;
  return {
    // Suffix the site name only when the title doesn't already carry it —
    // imported pages often brand their own <title> ("Pricing … | AdonisAgent"),
    // and a blind suffix would double-brand ("… | AdonisAgent — AdonisAgent").
    title: title.toLowerCase().includes(pc.resolved.site.name.toLowerCase())
      ? title
      : `${title} — ${pc.resolved.site.name}`,
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
