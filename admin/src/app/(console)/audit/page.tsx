import Link from "next/link";

import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import type { AuditResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Every action taken from this console, newest first, across all businesses.
 *
 * Readable by both roles: a manager seeing what has been done to an account
 * is part of doing support, and a log only some people can read is half a
 * log. Filters are plain query parameters so a link to "everything done to
 * this business" or "everything this person did" can be pasted into a chat.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: { tenantId?: string; action?: string; actorUserId?: string };
}) {
  const qs = new URLSearchParams({ limit: "200" });
  if (searchParams.tenantId) qs.set("tenantId", searchParams.tenantId);
  if (searchParams.action) qs.set("action", searchParams.action);
  if (searchParams.actorUserId) qs.set("actorUserId", searchParams.actorUserId);

  const { entries } = await api<AuditResponse>(`/audit?${qs.toString()}`);
  const filtered = Boolean(searchParams.tenantId || searchParams.action || searchParams.actorUserId);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Audit log</h1>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--text-secondary)" }}>
          Every action taken from this console, including the ones that were refused.
        </p>
      </div>

      <form method="GET" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          className="input"
          type="text"
          name="action"
          placeholder="Action, e.g. suspend"
          defaultValue={searchParams.action ?? ""}
          style={{ maxWidth: 220 }}
        />
        <input
          className="input"
          type="number"
          name="tenantId"
          placeholder="Business id"
          defaultValue={searchParams.tenantId ?? ""}
          style={{ maxWidth: 150 }}
        />
        <button className="btn btn--primary btn--md" type="submit">Filter</button>
        {filtered && (
          <Link href="/audit" className="btn btn--secondary btn--md" style={{ textDecoration: "none" }}>
            Clear
          </Link>
        )}
      </form>

      <Card style={{ padding: 20 }}>
        {entries.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>
            {filtered ? "Nothing matches that filter." : "No console actions recorded yet."}
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Business</th>
                <th>Who</th>
                <th>Reason</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{fmtDate(e.createdAt)}</td>
                  <td style={{ color: e.ok ? undefined : "var(--red)" }}>
                    {e.action}
                    {!e.ok && " (refused)"}
                  </td>
                  <td>
                    {e.tenantId ? (
                      <Link href={`/gyms/${e.tenantId}`}>{e.tenantName ?? `#${e.tenantId}`}</Link>
                    ) : (
                      <span style={{ color: "var(--text-tertiary)" }}>platform</span>
                    )}
                  </td>
                  <td>
                    {e.actorEmail}
                    {e.actorRole ? (
                      <span style={{ color: "var(--text-tertiary)" }}> · {e.actorRole}</span>
                    ) : null}
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>{e.reason ?? "—"}</td>
                  <td style={{ color: "var(--text-secondary)", fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                    {e.error ?? summarise(e.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

/** The detail JSON as one short line; the full object is rarely what you want at a glance. */
function summarise(detail: unknown): string {
  if (detail == null) return "—";
  if (typeof detail !== "object") return String(detail);
  const parts = Object.entries(detail as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`);
  if (parts.length === 0) return "—";
  const line = parts.join(" ");
  return line.length > 90 ? `${line.slice(0, 87)}…` : line;
}
