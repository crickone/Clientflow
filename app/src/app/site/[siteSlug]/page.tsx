import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { resolvePublicSite } from "@/lib/cms/resolveHost";
import {
  resolvePageContext,
  buildPageMetadata,
  studioEditZones,
} from "@/lib/cms/render";
import { studioEditability } from "@/lib/cms/pageBody";
import { StudioCanvas } from "@/components/cms/StudioCanvas";
import { StudioUneditablePanel } from "@/components/cms/StudioUneditablePanel";

export const dynamic = "force-dynamic";

type Props = {
  params: { siteSlug: string };
  searchParams: { site?: string; cmsedit?: string };
};

export function generateMetadata({ params, searchParams }: Props): Metadata {
  const pc = resolvePageContext(params, searchParams);
  if (pc) return buildPageMetadata(pc);
  return { title: "Site" };
}

export default async function PublicSiteHome({ params, searchParams }: Props) {
  // The edit canvas resolves through the operator's OWN tenant (see
  // studioEditZones), never the host — the admin host maps to no site, and a
  // cross-tenant slug search could otherwise land on a different tenant's
  // page than the one the operator opened. Anything unresolvable falls
  // through to the ordinary public render below, revealing nothing.
  if (searchParams.cmsedit === "1") {
    const zones = await studioEditZones(params.siteSlug, "/");
    if (zones) {
      const editability = studioEditability(zones);
      if (!editability.ok) {
        return <StudioUneditablePanel reason={editability.reason} />;
      }
      return <StudioCanvas zones={zones} path={"/"} />;
    }
  }

  // A published home page ('/') renders via its template.
  const pc = resolvePageContext(params, searchParams);
  if (pc?.template) {
    const T = pc.template.Component;
    return <T ctx={pc.ctx} page={pc.page} />;
  }

  // No home page yet — show a minimal holding screen if the site exists.
  const host = headers().get("host");
  const resolved = resolvePublicSite({
    host,
    siteParam: searchParams.site ?? params.siteSlug,
  });
  if (!resolved) notFound();

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "var(--font-body), system-ui, sans-serif",
        background: "#0b0b0c",
        color: "#f5f3ef",
        padding: 40,
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 640 }}>
        <p style={{ letterSpacing: "0.2em", textTransform: "uppercase", fontSize: 12, opacity: 0.6 }}>
          CMS-served site
        </p>
        <h1 style={{ fontSize: "clamp(32px,6vw,64px)", margin: "16px 0", fontWeight: 600 }}>
          {resolved.site.name}
        </h1>
        <p style={{ opacity: 0.7 }}>
          No home page published yet. Add one in the CMS, or visit{" "}
          <a href={`/site/${resolved.site.slug}/blog`} style={{ color: "#ef5a24" }}>
            the blog
          </a>
          .
        </p>
      </div>
    </main>
  );
}
