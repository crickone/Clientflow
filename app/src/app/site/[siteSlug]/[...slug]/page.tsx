import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  resolvePageContext,
  buildPageMetadata,
  studioEditZones,
  pathFromSlugParam,
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
  if (!pc || !pc.template) notFound();
  const T = pc.template.Component;
  return <T ctx={pc.ctx} page={pc.page} />;
}
