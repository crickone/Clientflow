import Link from "next/link";

import { api } from "@/lib/api";
import { fmtDate, fmtDay } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";
import { StatusChip } from "@/components/StatusChip";
import { Card } from "@/components/ui/Card";
import { OpenBusinessButton } from "@/components/OpenBusinessButton";
import { KillSwitches } from "@/components/fleet/KillSwitches";
import type { FleetResponse } from "@/lib/types";
import { openTenant } from "./[id]/actions";

export const dynamic = "force-dynamic";

/**
 * The console's front door: every business, filtered, with the platform
 * switches above them.
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

export default async function GymsPage({
  searchParams,
}: {
  searchParams: { q?: string; status?: string; venueType?: string };
}) {
  const me = await requireAdminSession();
  const qs = new URLSearchParams();
  if (searchParams.q) qs.set("q", searchParams.q);
  if (searchParams.status) qs.set("status", searchParams.status);
  if (searchParams.venueType) qs.set("venueType", searchParams.venueType);

  const { tenants, killSwitches } = await api<FleetResponse>(`/fleet${qs.toString() ? `?${qs}` : ""}`);
  const filtered = Boolean(searchParams.q || searchParams.status || searchParams.venueType);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Businesses</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--text-secondary)" }}>
          {filtered ? `${tenants.length} match` : `${tenants.length} in total`}
          {filtered && tenants.length === 1 ? "es" : ""}.
        </p>
      </div>

      <KillSwitches switches={killSwitches} isOwner={me.role === "owner"} />

      <form method="GET" style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="input"
          type="search"
          name="q"
          placeholder="Name, slug or a staff email…"
          defaultValue={searchParams.q ?? ""}
          style={{ maxWidth: 300 }}
        />
        <select className="input" name="status" defaultValue={searchParams.status ?? ""} style={{ height: 38, padding: "0 10px" }}>
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <select className="input" name="venueType" defaultValue={searchParams.venueType ?? ""} style={{ height: 38, padding: "0 10px" }}>
          <option value="">Any venue</option>
          <option value="gym">Gym</option>
          <option value="clinic">Clinic</option>
        </select>
        <button className="btn btn--primary btn--md" type="submit">Filter</button>
        {filtered && (
          <Link href="/gyms" className="btn btn--secondary btn--md" style={{ textDecoration: "none" }}>
            Clear
          </Link>
        )}
      </form>

      <Card style={{ padding: 20 }}>
        {tenants.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>No businesses match.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Venue</th>
                <th>Status</th>
                <th>People</th>
                <th>Next renewal</th>
                <th>Joined</th>
                <th style={{ width: 1 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} style={t.archivedAt ? { opacity: 0.6 } : undefined}>
                  <td>
                    <Link href={`/gyms/${t.id}`}>{t.name}</Link>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", fontFamily: "ui-monospace, monospace" }}>
                      {t.slug}
                    </div>
                  </td>
                  <td>{t.venueType ?? <span style={{ color: "var(--text-tertiary)" }}>Not set</span>}</td>
                  <td>
                    {t.archivedAt ? (
                      <span className="chip" style={{ background: "rgba(242,193,78,.15)", color: "var(--amber)" }}>archived</span>
                    ) : (
                      <StatusChip status={t.billingStatus} exempt={t.billingExempt} />
                    )}
                  </td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{t.users}</td>
                  <td>{t.nextRenewalAt ? fmtDay(t.nextRenewalAt) : "—"}</td>
                  <td>{fmtDate(t.createdAt)}</td>
                  <td>{!t.archivedAt && <OpenBusinessButton action={openTenant.bind(null, t.id)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
