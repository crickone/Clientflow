import Link from "next/link";
import { Suspense } from "react";

import { api } from "@/lib/api";
import { SaveViewButton } from "@/components/SaveViewButton";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { AuditTable } from "@/components/AuditTable";
import { dublinDayStartMs } from "@/lib/format";
import type { AuditEntry, AuditResponse, FleetResponse, StaffResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE = 100;

type Params = { tenantId?: string; action?: string; actorEmail?: string; ok?: string; from?: string; to?: string; q?: string; offset?: string; id?: string; actorUserId?: string };

/**
 * Every action taken from this console, newest first, across all businesses.
 * Filters are query parameters so "everything done to this business last
 * week" is a link. `?id=` opens one entry expanded.
 */
export default async function AuditPage(props: { searchParams: Promise<Params> }) {
  const sp = await props.searchParams;
  const qs = new URLSearchParams({ limit: String(PAGE) });
  for (const k of ["tenantId", "action", "actorEmail", "actorUserId", "ok", "q", "offset"] as const) if (sp[k]) qs.set(k, sp[k]!);
  const fromMs = sp.from ? dublinDayStartMs(sp.from) : NaN;
  if (Number.isFinite(fromMs)) qs.set("from", String(fromMs));
  const toStart = sp.to ? dublinDayStartMs(sp.to) : NaN;
  // Next Dublin midnight, found from noon the next day so DST changes cannot skip it.
  if (Number.isFinite(toStart)) qs.set("to", String(dublinDayStartMs(new Date(toStart + 36 * 3600000).toISOString().slice(0, 10)) - 1));

  const [{ entries, total, actions }, fleet, staff] = await Promise.all([
    api<AuditResponse>(`/audit?${qs.toString()}`),
    api<FleetResponse>("/fleet", { revalidate: 30, tags: ["fleet"] }),
    api<StaffResponse>("/staff", { revalidate: 30, tags: ["fleet"] }),
  ]);
  const openId = sp.id && Number(sp.id) > 0 ? Number(sp.id) : null;
  let linked: AuditEntry | null = null;
  let linkedMissing = false;
  if (openId && !entries.some((e) => e.id === openId)) {
    const one = await api<AuditResponse>(`/audit?id=${openId}&limit=1`);
    linked = one.entries[0] ?? null;
    linkedMissing = !linked;
  }
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
        <Suspense fallback={null}>
          <SaveViewButton />
        </Suspense>
      </form>

      {openId && (
        <Card style={{ padding: "20px 26px 16px" }}>
          <h2 style={{ margin: "0 0 10px", fontSize: 14 }}>Linked entry</h2>
          {linked ? (
            <Suspense fallback={null}><AuditTable key={`linked-${openId}`} entries={[linked]} openId={openId} /></Suspense>
          ) : linkedMissing ? (
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>That audit entry does not exist.</p>
          ) : (
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>Shown expanded in the list below.</p>
          )}
        </Card>
      )}

      <Card style={{ padding: "20px 26px 16px" }}>
        {entries.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>{filtered ? "Nothing matches that filter." : "No console actions recorded yet."}</p>
        ) : (
          <Suspense fallback={null}><AuditTable key={openId ?? "none"} entries={entries} openId={openId} /></Suspense>
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
