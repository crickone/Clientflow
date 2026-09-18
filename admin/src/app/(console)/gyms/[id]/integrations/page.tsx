import { notFound } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { IntegrationsBoard } from "@/components/integrations/IntegrationsBoard";
import type { TenantIntegrations } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The Integrations tab: every outside connection, its state, and what can be done to it. */
export default async function TenantIntegrationsPage({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  let data: TenantIntegrations;
  try {
    data = await api<TenantIntegrations>(`/tenants/${id}/integrations`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  return <IntegrationsBoard tenantId={id} data={data} />;
}
