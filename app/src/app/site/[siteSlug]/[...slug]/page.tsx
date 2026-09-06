import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  resolvePageContext,
  buildPageMetadata,
  canEditNow,
  editBodyZones,
} from "@/lib/cms/render";
import { StudioCanvas } from "@/components/cms/StudioCanvas";

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
  if (searchParams.cmsedit === "1" && canEditNow()) {
    return <StudioCanvas zones={editBodyZones(pc)} path={pc.path} />;
  }
  const T = pc.template.Component;
  return <T ctx={pc.ctx} page={pc.page} />;
}
