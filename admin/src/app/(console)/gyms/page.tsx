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
import { PageHeader } from "@/components/ui/PageHeader";

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

export default async function GymsPage(
  props: {
    searchParams: Promise<{ q?: string; status?: string; venueType?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const me = await requireAdminSession();
  const qs = new URLSearchParams();
  if (searchParams.q) qs.set("q", searchParams.q);
  if (searchParams.status) qs.set("status", searchParams.status);
  if (searchParams.venueType) qs.set("venueType", searchParams.venueType);

  const { tenants, killSwitches } = await api<FleetResponse>(`/fleet${qs.toString() ? `?${qs}` : ""}`);
  const filtered = Boolean(searchParams.q || searchParams.status || searchParams.venueType);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader
        eyebrow="Fleet"
        title="Businesses"
        sub={`${filtered ? `${tenants.length} match${tenants.length === 1 ? "es" : ""}` : `${tenants.length} in total`}.`}
        actions={
          <Link href="/provision" className="btn btn--primary btn--md">
            Provision business
          </Link>
        }
      />

      <KillSwitches switches={killSwitches} isOwner={me.role === "owner"} />

      <form method="GET" className="toolbar">
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
      </form>

      <Card style={{ padding: "22px 26px 14px" }}>
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
                    <div style={{ marginTop: 3, fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono), ui-monospace, monospace" }}>
                      {t.slug}
                    </div>
                  </td>
                  <td style={{ textTransform: "capitalize", color: "var(--text-secondary)" }}>{t.venueType ?? <span style={{ color: "var(--text-tertiary)", textTransform: "none" }}>Not set</span>}</td>
                  <td>
                    {t.archivedAt ? (
                      <span className="chip" style={{ backgroundColor: "rgba(242,193,78,.15)", color: "var(--amber)" }}>archived</span>
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
