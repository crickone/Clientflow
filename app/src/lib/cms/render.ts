import "server-only";

import type { Metadata } from "next";
import { headers } from "next/headers";

import { resolvePublicSite, absoluteUrl, siteUrl, type PublicSite } from "@/lib/cms/resolveHost";
import { getPublishedPageByPath } from "@/lib/cms/pages";
import { getSeoPublic } from "@/lib/cms/seo";
import { getTemplate, type TemplateDef } from "@/lib/cms/templates";
import { getCurrentMembership } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSiteBySlug } from "@/lib/cms/sites";
import { getBlockValue, getBlock } from "@/lib/cms/blocks";
import {
  splitPageBody,
  headForCanvas,
  type PageBodyZones,
} from "@/lib/cms/pageBody";
import { getDraftContentFrom, getDraftContent } from "@/lib/cms/pageDraft";
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

/** The catch-all route's slug segments as a page path ("/a/b"); "/" when empty. */
export function pathFromSlugParam(slug?: string[]): string {
  return pathFromSlug(slug);
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


/**
 * The Studio canvas's view of a page: its three zones (see lib/cms/pageBody),
 * with the DRAFT content zone substituted when one exists.
 *
 * Deliberately NOT sanitised. The live clientflow-live template already renders
 * this exact stored HTML verbatim, scripts included, on the same origin; the
 * canvas is admin-only (see studioEditZones) and renders strictly less than the live
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

/**
 * The Studio's OWN resolution of a page to edit: the caller's SESSION tenant
 * plus the route's site slug — deliberately NOT the host.
 *
 * The public render resolves a site by hostname (or, on an unmapped host, by
 * searching every tenant for the slug). The Studio's save/publish actions
 * resolve it by slug against the session tenant. When the edit canvas used the
 * host-resolved context, those two halves could disagree — and on the admin
 * host, where no domain is mapped, the cross-tenant slug search could land on a
 * different tenant than the operator's own, so the canvas silently refused to
 * render and the operator got the ordinary public page inside the editor.
 *
 * Resolving here exactly as the actions do fixes both: the canvas and the save
 * path are the same page by construction, and because only the session tenant's
 * database is ever opened, an operator cannot read another tenant's page or its
 * unpublished draft even if a site slug collides across tenants.
 *
 * Returns null when the caller is not an admin, the site or published page does
 * not exist in their tenant, or the page has no body — callers fall through to
 * the ordinary public render, which reveals nothing.
 */
export async function studioEditZones(
  siteSlug: string,
  path: string,
): Promise<(PageBodyZones & { hasDraft: boolean }) | null> {
  const m = getCurrentMembership();
  if (m?.role !== "admin") return null;

  const site = await getSiteBySlug(siteSlug);
  if (!site) return null;

  const page = getPublishedPageByPath(db, site.id, path);
  if (!page) return null;

  const zones = splitPageBody(getBlock(site.id, page.id, "body")?.value ?? "");
  const draft = getDraftContent(site.id, page.id);
  return {
    ...zones,
    // Styles and fonts, never scripts: the canvas is server-rendered, so a
    // script here would be executed by the browser's parser (see
    // headForCanvas). The page's own progressive-enhancement flag would
    // otherwise switch on CSS that hides every scroll-reveal section, which
    // only the tail zone's GSAP -- never rendered here -- would undo.
    head: headForCanvas(zones.head),
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
