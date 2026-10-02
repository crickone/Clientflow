import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";

import {
  resolvePageContext,
  buildPageMetadata,
  studioEditZones,
  pathFromSlugParam,
} from "@/lib/cms/render";
import { studioEditability } from "@/lib/cms/pageBody";
import { resolvePublicSite } from "@/lib/cms/resolveHost";
import { getPublishedPostBySlug } from "@/lib/cms/blog";
import { resolveSiteRedirect } from "@/lib/cms/siteRedirects";
import { SiteTracking } from "@/components/cms/SiteTracking";
import { StudioCanvas } from "@/components/cms/StudioCanvas";
import { StudioUneditablePanel } from "@/components/cms/StudioUneditablePanel";

export const dynamic = "force-dynamic";

type Props = {
  params: { siteSlug: string; slug: string[] };
  searchParams: { site?: string; cmsedit?: string; preview?: string };
};

export function generateMetadata({ params, searchParams }: Props): Metadata {
  const pc = resolvePageContext(params, searchParams);
  if (pc) return buildPageMetadata(pc);
  return { title: "Not found" };
}

export default async function PublicSitePage({ params, searchParams }: Props) {
  // The edit canvas resolves through the operator's OWN tenant (see
  // studioEditZones), never the host, so it must not sit behind the
  // host-resolved lookup below: the admin host maps to no site, and a
  // cross-tenant slug search could land on a different tenant's page than the
  // one the operator opened. Anything unresolvable falls through to the
  // ordinary public render, revealing nothing.
  if (searchParams.cmsedit === "1") {
    const zones = await studioEditZones(params.siteSlug, pathFromSlugParam(params.slug));
    if (zones) {
      const editability = studioEditability(zones);
      if (!editability.ok) {
        return <StudioUneditablePanel reason={editability.reason} />;
      }
      return <StudioCanvas zones={zones} path={pathFromSlugParam(params.slug)} />;
    }
  }

  const pc = resolvePageContext(params, searchParams);
  if (!pc || !pc.template) {
    // No page at this path. Before 404ing, a bespoke site may map an OLD
    // URL here (public/sites/<slug>/_redirects.json — see lib/cms/siteRedirects).
    // A blog target is only issued when the post actually exists, so a
    // missing article gets a 404 rather than a redirect into another 404.
    // A page row with no template already resolved the site; only a missing
    // page needs the lookup done again.
    const resolved =
      pc?.resolved ?? resolvePublicSite({ host: headers().get("host"), siteParam: searchParams.site ?? params.siteSlug });
    if (resolved) {
      const hit = resolveSiteRedirect(resolved.site.slug, pathFromSlugParam(params.slug));
      if (hit) {
        if (hit.kind === "external") permanentRedirect(hit.target);
        const blog = /^\/blog\/([^/]+)$/.exec(hit.target);
        // pathFromSlugParam already decoded the segment once; the same string
        // is what lands in the Location header, so it is checked as-is.
        const postOk = !blog || getPublishedPostBySlug(resolved.db, resolved.site.id, blog[1]!) !== null;
        if (postOk) {
          // Root-relative keeps the browser on its current host; a mapped
          // domain serves the site at its root, the preview mount at /site/<slug>.
          const prefix = resolved.resolvedVia === "host" ? "" : `/site/${resolved.site.slug}`;
          permanentRedirect(`${prefix}${hit.target}`);
        }
      }
    }
    notFound();
  }
  const T = pc.template.Component;
  // Only reachable through ?preview=1 by an admin of this business (see
  // draftPageForPreview): label it, and keep the operator out of the pixel.
  if (pc.page.status !== "published") {
    return (
      <>
        <div
          style={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2147483647,
            padding: "6px 14px",
            borderRadius: 999,
            background: "#111",
            color: "#fff",
            font: "500 12px/1.4 system-ui, sans-serif",
            boxShadow: "0 4px 16px rgba(0,0,0,.25)",
            pointerEvents: "none",
          }}
        >
          Draft preview - not live yet
        </div>
        <T ctx={pc.ctx} page={pc.page} />
      </>
    );
  }
  return (
    <>
      {/* Public surface, so the client's pixel belongs here. Deliberately
          NOT reached by the cmsedit branch above: an operator editing a page
          is not a visitor, and counting them would poison the audiences the
          pixel builds. */}
      <SiteTracking
        siteSlug={pc.resolved.site.slug}
        pixelId={pc.resolved.site.metaPixelId}
        googleTagId={pc.resolved.site.googleTagId}
      />
      <T ctx={pc.ctx} page={pc.page} />
    </>
  );
}
