import Link from "next/link";

import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { AuditTable } from "@/components/AuditTable";
import type { AuditResponse, FleetResponse, StaffResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE = 100;

type Params = { tenantId?: string; action?: string; actorEmail?: string; ok?: string; from?: string; to?: string; q?: string; offset?: string; id?: string };

/**
 * Every action taken from this console, newest first, across all businesses.
 * Filters are query parameters so "everything done to this business last
 * week" is a link. `?id=` opens one entry expanded.
 */
export default async function AuditPage(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;
  const qs = new URLSearchParams({ limit: String(PAGE) });
  for (const k of ["tenantId", "action", "actorEmail", "ok", "q", "offset"] as const) if (sp[k]) qs.set(k, sp[k]!);
  if (sp.from) qs.set("from", String(Date.parse(sp.from)));
  if (sp.to) qs.set("to", String(Date.parse(sp.to) + 86400000 - 1));

  const [{ entries, total, actions }, fleet, staff] = await Promise.all([
    api<AuditResponse>(`/audit?${qs.toString()}`),
    api<FleetResponse>("/fleet", { revalidate: 30, tags: ["fleet"] }),
    api<StaffResponse>("/staff", { revalidate: 30, tags: ["fleet"] }),
  ]);
  const offset = Number(sp.offset) || 0;
  const filtered = Boolean(sp.tenantId || sp.action || sp.actorEmail || sp.ok || sp.from || sp.to || sp.q);
  const olderQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "id" && k !== "offset") as [string, string][]);
  olderQs.set("offset", String(offset + PAGE));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader eyebrow="Operate" title="Audit log" sub={`${total} ${total === 1 ? "action" : "actions"}${filtered ? " match" : ""}. Every action taken from this console, including the ones that were refused.`} />

      <form method="GET" className="toolbar">
        <input className="input toolbar-search" type="search" name="q" placeholder="Search reason, detail, error…" defaultValue={sp.q ?? ""} />
        <select className="input" name="tenantId" defaultValue={sp.tenantId ?? ""}>
          <option value="">Any business</option>
          {fleet.tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="input" name="actorEmail" defaultValue={sp.actorEmail ?? ""}>
          <option value="">Anyone</option>
          {staff.staff.map((s) => <option key={s.userId} value={s.email}>{s.name ?? s.email}</option>)}
        </select>
        <select className="input" name="action" defaultValue={sp.action ?? ""}>
          <option value="">Any action</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input" name="ok" defaultValue={sp.ok ?? ""}>
          <option value="">Any outcome</option>
          <option value="1">Done</option>
          <option value="0">Refused</option>
        </select>
        <input className="input" type="date" name="from" defaultValue={sp.from ?? ""} aria-label="From" />
        <input className="input" type="date" name="to" defaultValue={sp.to ?? ""} aria-label="To" />
        <button className="btn btn--secondary btn--md" type="submit">Filter</button>
        {filtered && <Link href="/audit" className="btn btn--ghost btn--md">Clear</Link>}
      </form>

      <Card style={{ padding: "20px 26px 16px" }}>
        {entries.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>{filtered ? "Nothing matches that filter." : "No console actions recorded yet."}</p>
        ) : (
          <AuditTable entries={entries} openId={sp.id ? Number(sp.id) : null} />
        )}
        {offset + entries.length < total && (
          <div style={{ marginTop: 14 }}>
            <Link href={`/audit?${olderQs.toString()}`} className="btn btn--secondary btn--sm">Load older</Link>
          </div>
        )}
      </Card>
    </div>
  );
}
