"use client";

import Link from "next/link";

import { DataTable, type Column } from "@/components/ui/DataTable";
import { bytes } from "@/lib/format";
import type { FleetHealth } from "@/lib/types";

type FleetHealthRow = FleetHealth["tenants"][number];

export function FleetHealthTable({ tenants }: { tenants: FleetHealthRow[] }) {
  const columns: Column<FleetHealthRow>[] = [
    {
      key: "name", label: "Business", sortable: true, hideable: false,
      render: (t) => (
        <>
          <Link href={`/gyms/${t.tenantId}/health`}>{t.name}</Link>
          <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>{t.slug}</div>
        </>
      ),
    },
    { key: "dbBytes", label: "Database", sortable: true, align: "right", render: (t) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{bytes(t.dbBytes)}</span> },
    {
      key: "state", label: "State", sortable: true,
      value: (t) => (t.alerts.some((a) => a.level === "bad") ? 2 : t.alerts.length > 0 ? 1 : 0),
      render: (t) =>
        t.alerts.length === 0 ? (
          <span className="chip active">healthy</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13 }}>
            {t.alerts.map((a, i) => (
              <li key={i} style={{ color: a.level === "bad" ? "var(--red)" : "var(--amber)" }}>{a.message}</li>
            ))}
          </ul>
        ),
    },
  ];
  return <DataTable rows={tenants} columns={columns} rowKey={(t) => t.tenantId} defaultSort={{ key: "state", dir: "desc" }} csvName="fleet-health" empty="No businesses." />;
}
