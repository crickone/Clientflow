import type { ReactNode } from "react";
import Link from "next/link";
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
export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { id: string };
}) {
  const id = Number(params.id);
  const me = await requireAdminSession();

  let data: TenantDetail;
  try {
    data = await api<TenantDetail>(`/tenants/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const { tenant, usage } = data;
  const billing = tenant.billing;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <Link href="/gyms" style={{ fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}>
          ← All businesses
        </Link>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>{tenant.name}</h1>
          <StatusChip status={billing?.status ?? null} exempt={billing?.billingExempt} />
          <span
            style={{
              fontFamily: "var(--font-mono), ui-monospace, monospace",
              fontSize: 11,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--text-secondary)",
              background: "var(--surface-2)",
              border: "1px solid var(--grid)",
              borderRadius: 999,
              padding: "3px 10px",
            }}
          >
            {tenant.venueType ?? "Not set"}
          </span>
          {!tenant.isActive && (
            <span className="chip" style={{ background: "rgba(240,128,154,.15)", color: "var(--red)" }}>
              inactive
            </span>
          )}
          <span style={{ marginLeft: "auto" }}>
            <OpenBusinessButton
              action={openTenant.bind(null, tenant.id)}
              label="Open business"
              className="btn btn--primary btn--sm"
            />
          </span>
        </div>
        <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{tenant.slug}</span>
          {"  ·  "}
          {usage.clients} members · {usage.staff} staff
          {"  ·  "}
          you are signed in as {me.role}
        </div>
      </div>

      <TenantTabs tenantId={tenant.id} />

      {children}
    </div>
  );
}
