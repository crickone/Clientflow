import { notFound } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { PeopleTable } from "@/components/people/PeopleTable";
import type { TenantPeople } from "@/lib/types";

export const dynamic = "force-dynamic";

/** The People tab: everyone who can get into this business, and the controls to change that. */
export default async function TenantPeoplePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const id = Number(params.id);
  let data: TenantPeople;
  try {
    data = await api<TenantPeople>(`/tenants/${id}/people`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  return <PeopleTable tenantId={id} data={data} />;
}
