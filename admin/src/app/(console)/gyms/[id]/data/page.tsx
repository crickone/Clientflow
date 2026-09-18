import { notFound } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { requireAdminSession } from "@/lib/session";
import { DataPanel } from "@/components/data/DataPanel";
import type { TenantData } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The Data tab. The person search is a query parameter rather than client
 * state so a support conversation can link straight to "this is who I
 * found" — and so the search survives a refresh after a deletion.
 */
export default async function TenantDataPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { q?: string };
}) {
  const id = Number(params.id);
  const me = await requireAdminSession();
  const q = searchParams.q ?? "";
  let data: TenantData;
  try {
    data = await api<TenantData>(`/tenants/${id}/data${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  return <DataPanel tenantId={id} data={data} query={q} isOwner={me.role === "owner"} />;
}
