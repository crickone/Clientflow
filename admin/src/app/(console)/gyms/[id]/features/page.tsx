import { notFound } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { FeaturesPanel } from "@/components/features/FeaturesPanel";
import type { ModuleUsage, TenantFeatures } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The Features tab: which modules this business has, and the venue settings beside them. */
export default async function TenantFeaturesPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const id = Number(params.id);
  let data: TenantFeatures;
  try {
    data = await api<TenantFeatures>(`/tenants/${id}/features`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  let usage: ModuleUsage[] = [];
  try {
    usage = (await api<{ modules: ModuleUsage[] }>(`/tenants/${id}/usage?days=365`)).modules;
  } catch {
    usage = [];
  }
  return <FeaturesPanel tenantId={id} data={data} usage={usage} />;
}
