import { notFound } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { HealthPanel } from "@/components/health/HealthPanel";
import type { TenantHealth } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The Health tab: is anything broken for this business, and the repairs worth offering. */
export default async function TenantHealthPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const id = Number(params.id);
  let data: TenantHealth;
  try {
    data = await api<TenantHealth>(`/tenants/${id}/health`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  return <HealthPanel tenantId={id} data={data} />;
}
