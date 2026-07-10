import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { resolvePublicSite } from "@/lib/cms/resolveHost";
import {
  resolvePageContext,
  buildPageMetadata,
  canEditNow,
  editBodyHtml,
} from "@/lib/cms/render";
import { RenovaEditCanvas } from "@/components/cms/RenovaEditCanvas";

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

export default function PublicSiteHome({ params, searchParams }: Props) {
  // A published home page ('/') renders via its template.
  const pc = resolvePageContext(params, searchParams);
  if (pc?.template) {
    if (searchParams.cmsedit === "1" && canEditNow()) {
      return <RenovaEditCanvas html={editBodyHtml(pc)} path={pc.path} />;
    }
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
