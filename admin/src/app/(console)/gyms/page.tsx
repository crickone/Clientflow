import Link from "next/link";
import { Suspense } from "react";

import { api } from "@/lib/api";
import { SaveViewButton } from "@/components/SaveViewButton";
import { requireAdminSession } from "@/lib/session";
import { BusinessesTable } from "@/components/BusinessesTable";
import { Card } from "@/components/ui/Card";
import type { FleetResponse } from "@/lib/types";
import { openTenant } from "./[id]/actions";
import { PageHeader } from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

/**
 * The console's front door: every business, filtered.
 *
 * Filters are query parameters rather than client state, so a view worth
 * looking at twice ("everything past due", "every archived account") is a
 * link somebody can keep or paste into a conversation.
 */
const STATUS_FILTERS = [
  { value: "", label: "All" },
  { value: "active", label: "Active" },
  { value: "past_due", label: "Past due" },
  { value: "suspended", label: "Suspended" },
  { value: "pending_payment", label: "Awaiting payment" },
  { value: "exempt", label: "Exempt" },
  { value: "archived", label: "Archived" },
];

export default async function GymsPage(
  props: {
    searchParams: Promise<{ q?: string; status?: string; venueType?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  await requireAdminSession();
  const qs = new URLSearchParams();
  if (searchParams.q) qs.set("q", searchParams.q);
  if (searchParams.status) qs.set("status", searchParams.status);
  if (searchParams.venueType) qs.set("venueType", searchParams.venueType);

  const { tenants } = await api<FleetResponse>(`/fleet${qs.toString() ? `?${qs}` : ""}`, { revalidate: 30, tags: ["fleet"] });
  const filtered = Boolean(searchParams.q || searchParams.status || searchParams.venueType);
  const paying = tenants.filter((t) => !t.billingExempt && t.billingStatus === "active").length;
  const exempt = tenants.filter((t) => t.billingExempt).length;
  const plural = tenants.length === 1 ? "business" : "businesses";
  // The saved views are plain links to this page, so a client navigation keeps
  // the form mounted; keying it on the filters remounts the uncontrolled
  // inputs with the right defaultValue.
  const formKey = JSON.stringify([searchParams.q ?? "", searchParams.status ?? "", searchParams.venueType ?? ""]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader
        eyebrow="Fleet"
        title="Businesses"
        sub={`${tenants.length} ${plural} · ${paying} paying · ${exempt} exempt${filtered ? " (filtered)" : ""}`}
        actions={
          <Link href="/provision" className="btn btn--primary btn--md">
            Provision business
          </Link>
        }
      />

      <form key={formKey} method="GET" className="toolbar">
        <input
          className="input toolbar-search"
          type="search"
          name="q"
          placeholder="Name, slug or a staff email…"
          defaultValue={searchParams.q ?? ""}
        />
        <select className="input" name="status" defaultValue={searchParams.status ?? ""}>
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <select className="input" name="venueType" defaultValue={searchParams.venueType ?? ""}>
          <option value="">Any venue</option>
          <option value="gym">Gym</option>
          <option value="clinic">Clinic</option>
        </select>
        <button className="btn btn--secondary btn--md" type="submit">Filter</button>
        {filtered && (
          <Link href="/gyms" className="btn btn--secondary btn--md" style={{ textDecoration: "none" }}>
            Clear
          </Link>
        )}
        <Suspense fallback={null}>
          <SaveViewButton />
        </Suspense>
      </form>

      <Card style={{ padding: "20px 26px 18px" }}>
        <BusinessesTable tenants={tenants} now={Date.now()} open={openTenant} />
      </Card>
    </div>
  );
}
