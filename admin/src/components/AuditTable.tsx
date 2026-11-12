"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { fmtDate } from "@/lib/format";
import type { AuditEntry } from "@/lib/types";

/** Rows expand to the full detail; `?id=` opens one row expanded (deep link). */
export function AuditTable({ entries, openId }: { entries: AuditEntry[]; openId: number | null }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(openId ? [openId] : []));
  const sp = useSearchParams();
  const linkFor = (id: number) => {
    const n = new URLSearchParams(sp.toString());
    n.set("id", String(id));
    return `/audit?${n.toString()}`;
  };
  useEffect(() => {
    if (openId) document.getElementById("audit-" + openId)?.scrollIntoView({ block: "center" });
  }, [openId]);
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th style={{ width: 1 }} />
          <th>When</th>
          <th>Action</th>
          <th>Business</th>
          <th>Who</th>
          <th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => {
          const isOpen = open.has(e.id);
          return [
            <tr key={e.id} id={`audit-${e.id}`} style={isOpen ? { background: "rgba(255,255,255,0.02)" } : undefined}>
              <td>
                <button type="button" className="btn btn--ghost btn--icon" style={{ width: 28, height: 28 }} onClick={() => toggle(e.id)} aria-expanded={isOpen} aria-label="Detail">
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                <Link href={linkFor(e.id)} style={{ color: "inherit" }} title="Link to this entry">{fmtDate(e.createdAt)}</Link>
              </td>
              <td style={{ color: e.ok ? undefined : "var(--red)" }}>
                {e.action}
                {!e.ok && " (refused)"}
              </td>
              <td>{e.tenantId ? <Link href={`/gyms/${e.tenantId}`}>{e.tenantName ?? `#${e.tenantId}`}</Link> : <span style={{ color: "var(--text-tertiary)" }}>platform</span>}</td>
              <td>
                {e.actorEmail}
                {e.actorRole ? <span style={{ color: "var(--text-tertiary)" }}> · {e.actorRole}</span> : null}
              </td>
              <td style={{ color: "var(--text-secondary)" }}>{e.reason ?? "—"}</td>
            </tr>,
            isOpen ? (
              <tr key={`${e.id}-d`}>
                <td />
                <td colSpan={5} style={{ paddingTop: 0 }}>
                  <pre className="audit-detail">
                    {e.error ? `error: ${e.error}\n` : ""}
                    {e.ip ? `ip: ${e.ip}\n` : ""}
                    {JSON.stringify(e.detail ?? {}, null, 2)}
                  </pre>
                </td>
              </tr>
            ) : null,
          ];
        })}
      </tbody>
    </table>
  );
}
