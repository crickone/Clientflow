import type { Metadata } from "next";

import { resolvePublicSite } from "@/lib/cms/resolveHost";
import { siteRequestHost } from "@/lib/cms/requestHost";
import { siteIconLink } from "@/lib/cms/siteIcon";

/**
 * Every page of a business's website carries that business's favicon, never
 * the platform's (lib/cms/siteIcon.ts). It replaces the root layout's icon
 * because a segment's `icons` overrides its parent's.
 */
export async function generateMetadata(props: { params: Promise<{ siteSlug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const resolved = resolvePublicSite({ host: siteRequestHost(), siteParam: params.siteSlug });
  if (!resolved) return { icons: null };
  const href = siteIconLink(resolved);
  return { icons: { icon: href } };
}

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
