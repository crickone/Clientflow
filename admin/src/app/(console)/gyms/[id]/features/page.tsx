import { notFound } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { FeaturesPanel } from "@/components/features/FeaturesPanel";
import type { TenantFeatures } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The Features tab: which modules this business has, and the venue settings beside them. */
export default async function TenantFeaturesPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  let data: TenantFeatures;
  try {
    data = await api<TenantFeatures>(`/tenants/${id}/features`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  return <FeaturesPanel tenantId={id} data={data} />;
}
