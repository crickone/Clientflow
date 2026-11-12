"use client";

import Link from "next/link";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { StatusChip } from "@/components/StatusChip";
import { OpenBusinessButton } from "@/components/OpenBusinessButton";
import { fmtDate, fmtDay } from "@/lib/format";
import type { FleetTenantRow } from "@/lib/types";

export function BusinessesTable({
  tenants,
  open,
}: {
  tenants: FleetTenantRow[];
  /** `openTenant` server action; bound per row here. */
  open: (id: number, reason: string) => Promise<{ ok: true; url: string } | { ok: false; error: string }>;
}) {
  const columns: Column<FleetTenantRow>[] = [
    {
      key: "name", label: "Name", sortable: true, hideable: false,
      render: (t) => (
        <>
          <Link href={`/gyms/${t.id}`}>{t.name}</Link>
          <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>{t.slug}</div>
        </>
      ),
    },
    { key: "venueType", label: "Venue", sortable: true, value: (t) => t.venueType ?? "", render: (t) => <span style={{ textTransform: "capitalize", color: "var(--text-secondary)" }}>{t.venueType ?? <span style={{ color: "var(--text-tertiary)", textTransform: "none" }}>Not set</span>}</span> },
    {
      key: "status", label: "Status", sortable: true,
      value: (t) => (t.archivedAt ? "archived" : t.billingExempt ? "agency" : t.billingStatus ?? "none"),
      render: (t) => (t.archivedAt ? <span className="chip past_due">archived</span> : <StatusChip status={t.billingStatus} exempt={t.billingExempt} />),
    },
    { key: "users", label: "People", sortable: true, align: "right" },
    { key: "nextRenewalAt", label: "Next renewal", sortable: true, value: (t) => t.nextRenewalAt ?? "", render: (t) => (t.nextRenewalAt ? fmtDay(t.nextRenewalAt) : "—") },
    { key: "createdAt", label: "Joined", sortable: true, render: (t) => fmtDate(t.createdAt) },
    { key: "actions", label: "", hideable: false, width: 1, align: "right", value: () => "", render: (t) => (!t.archivedAt ? <OpenBusinessButton action={(reason) => open(t.id, reason)} /> : null) },
  ];
  return (
    <DataTable
      rows={tenants}
      columns={columns}
      rowKey={(t) => t.id}
      defaultSort={{ key: "name", dir: "asc" }}
      csvName="businesses"
      empty="No businesses match."
      rowStyle={(t) => (t.archivedAt ? { opacity: 0.6 } : undefined)}
    />
  );
}
