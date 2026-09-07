import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  resolvePageContext,
  buildPageMetadata,
  canEditNow,
  editBodyZones,
} from "@/lib/cms/render";
import { studioEditability } from "@/lib/cms/pageBody";
import { StudioCanvas } from "@/components/cms/StudioCanvas";
import { StudioUneditablePanel } from "@/components/cms/StudioUneditablePanel";

export const dynamic = "force-dynamic";

type Props = {
  params: { siteSlug: string; slug: string[] };
  searchParams: { site?: string; cmsedit?: string };
};

export function generateMetadata({ params, searchParams }: Props): Metadata {
  const pc = resolvePageContext(params, searchParams);
  if (pc) return buildPageMetadata(pc);
  return { title: "Not found" };
}

export default function PublicSitePage({ params, searchParams }: Props) {
  const pc = resolvePageContext(params, searchParams);
  if (!pc || !pc.template) notFound();
  // Only offer the canvas when this admin's own active tenant owns the
  // resolved site (canEditNow) AND the resolved site is genuinely the one
  // the route param asked for (site slugs are unique only WITHIN a tenant,
  // so a host/fallback resolution could otherwise land on a same-slug site
  // in a different tenant than the caller expects). Any failure falls
  // through to the ORDINARY public render below — never an error that
  // would reveal the page exists in another tenant.
  if (
    searchParams.cmsedit === "1" &&
    canEditNow(pc) &&
    pc.resolved.site.slug === params.siteSlug
  ) {
    const zones = editBodyZones(pc);
    const editability = studioEditability(zones);
    if (!editability.ok) {
      return <StudioUneditablePanel reason={editability.reason} />;
    }
    return <StudioCanvas zones={zones} path={pc.path} />;
  }
  const T = pc.template.Component;
  return <T ctx={pc.ctx} page={pc.page} />;
}
