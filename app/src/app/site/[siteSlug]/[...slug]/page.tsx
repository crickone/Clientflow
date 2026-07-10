import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  resolvePageContext,
  buildPageMetadata,
  canEditNow,
  editBodyHtml,
} from "@/lib/cms/render";
import { RenovaEditCanvas } from "@/components/cms/RenovaEditCanvas";

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
    return <RenovaEditCanvas html={editBodyHtml(pc)} path={pc.path} />;
  }
  const T = pc.template.Component;
  return <T ctx={pc.ctx} page={pc.page} />;
}
