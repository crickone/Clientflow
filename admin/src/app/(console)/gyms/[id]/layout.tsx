import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { requireAdminSession } from "@/lib/session";
import { StatusChip } from "@/components/StatusChip";
import { OpenBusinessButton } from "@/components/OpenBusinessButton";
import { TenantTabs } from "@/components/TenantTabs";
import type { TenantDetail } from "@/lib/types";
import { openTenant } from "./actions";

/**
 * The tenant hub: one header and one set of tabs around every view of a
 * business.
 *
 * Before this, everything lived on a single 668-line page that grew a new
 * section each time the console learned to do something. Tabs are real
 * routes rather than client-side state, so each one fetches only what it
 * shows, a link into a tab works, and a new tab is a new folder rather than
 * another thousand lines here.
 *
 * Tabs appear as their slices land. The four in TENANT_TABS are what exists;
 * People, Integrations, Features, Data and Health arrive with theirs.
 */
export default async function TenantLayout(
  props: {
    children: ReactNode;
    params: Promise<{ id: string }>;
  }
) {
  const params = await props.params;

  const {
    children
  } = props;

  const id = Number(params.id);
  const me = await requireAdminSession();

  let data: TenantDetail;
  try {
    data = await api<TenantDetail>(`/tenants/${id}`, { revalidate: 15, tags: [`tenant-${id}`] });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const { tenant, usage } = data;
  const billing = tenant.billing;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Link href="/gyms" className="back-link">
          <ArrowLeft size={14} strokeWidth={1.75} aria-hidden />
          All businesses
        </Link>

        <div className="biz-head">
          <div className="biz-mark" aria-hidden>
            {tenant.name.trim().charAt(0).toUpperCase() || "?"}
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 className="page-title">{tenant.name}</h1>
              <StatusChip status={billing?.status ?? null} exempt={billing?.billingExempt} />
              {!tenant.isActive && (
                <span className="chip suspended">inactive</span>
              )}
            </div>
            <div className="biz-meta">
              <span className="mono">{tenant.slug}</span>
              <span className="sep">/</span>
              <span style={{ textTransform: "capitalize" }}>{tenant.venueType ?? "Venue not set"}</span>
              <span className="sep">/</span>
              <span>
                {usage.clients} {usage.clients === 1 ? "member" : "members"}, {usage.staff} staff
              </span>
              <span className="sep">/</span>
              <span>You are signed in as {me.role}</span>
            </div>
          </div>
          <OpenBusinessButton
            action={openTenant.bind(null, tenant.id)}
            label="Open business"
            className="btn btn--primary btn--md"
          />
        </div>
      </div>

      <TenantTabs tenantId={tenant.id} />

      {children}
    </div>
  );
}
