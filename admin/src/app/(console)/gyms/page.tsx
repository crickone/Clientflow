import Link from "next/link";

import { api } from "@/lib/api";
import { fmtDate, fmtDay } from "@/lib/format";
import { StatusChip } from "@/components/StatusChip";
import { Card } from "@/components/ui/Card";
import type { TenantsResponse } from "@/lib/types";

export default async function GymsPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q ?? "";
  const data = await api<TenantsResponse>(`/tenants${q ? `?q=${encodeURIComponent(q)}` : ""}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Businesses</h1>

      <form method="GET" style={{ display: "flex", gap: 10 }}>
        <input
          className="input"
          type="search"
          name="q"
          placeholder="Search by name or slug…"
          defaultValue={q}
          style={{ maxWidth: 320 }}
        />
        <button className="btn btn--primary btn--md" type="submit">Search</button>
      </form>

      <Card style={{ padding: 20 }}>
        {data.tenants.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>No businesses match.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Venue type</th>
                <th>Status</th>
                <th>Next renewal</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {data.tenants.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={`/gyms/${t.id}`}>{t.name}</Link>
                  </td>
                  <td>{t.slug}</td>
                  <td>
                    {t.venueType ?? <span style={{ color: "var(--text-tertiary)" }}>Not set</span>}
                  </td>
                  <td>
                    <StatusChip status={t.billing?.status ?? null} exempt={t.billing?.billingExempt} />
                  </td>
                  <td>{fmtDay(t.billing?.nextRenewalAt ?? null)}</td>
                  <td>{fmtDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
