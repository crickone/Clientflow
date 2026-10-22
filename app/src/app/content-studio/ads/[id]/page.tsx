import { notFound } from "next/navigation";

import { AdEditor } from "@/components/content-studio/ads/AdEditor";
import { getAdCreative } from "@/lib/ads/creatives";
import { getCurrentMembership } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const ad = getAdCreative(Number(params.id));
  if (!ad) notFound();
  return <AdEditor initial={ad} isAdmin={getCurrentMembership()?.role === "admin"} />;
}
