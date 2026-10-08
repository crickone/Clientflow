import { notFound } from "next/navigation";

import { AdEditor } from "@/components/content-studio/ads/AdEditor";
import { getAdCreative } from "@/lib/ads/creatives";
import { getCurrentMembership } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default function AdPage({ params }: { params: { id: string } }) {
  const ad = getAdCreative(Number(params.id));
  if (!ad) notFound();
  return <AdEditor initial={ad} isAdmin={getCurrentMembership()?.role === "admin"} />;
}
