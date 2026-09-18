import { notFound } from "next/navigation";

import { api, ApiError } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import type { AuditResponse, TenantDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The Timeline tab: one list of everything that has happened to this
 * business, from both logs that record it.
 *
 * `billing_events` is the tenant's own billing history, written by the
 * billing engine. `platform_audit` is the console's log of what staff did,
 * including actions that were refused. They answer different questions and
 * neither is a superset of the other, so they are merged here by time rather
 * than one being dropped.
 */
type Entry = {
  key: string;
  at: number;
  source: "console" | "billing";
  label: string;
  who: string;
  reason: string | null;
  ok: boolean;
  error: string | null;
};

export default async function TenantTimelinePage({ params }: { params: { id: string } }) {
  const id = Number(params.id);

  let data: TenantDetail;
  try {
    data = await api<TenantDetail>(`/tenants/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  let audit: AuditResponse["entries"] = [];
  try {
    audit = (await api<AuditResponse>(`/audit?tenantId=${id}&limit=200`)).entries;
  } catch {
    audit = [];
  }

  const entries: Entry[] = [
    ...audit.map((a) => ({
      key: `a${a.id}`,
      at: a.createdAt,
      source: "console" as const,
      label: a.action,
      who: a.actorEmail || "platform staff",
      reason: a.reason,
      ok: a.ok,
      error: a.error,
    })),
    ...data.events.map((e) => ({
      key: `e${e.id}`,
      at: e.createdAt,
      source: "billing" as const,
      label: e.type,
      who: e.actor,
      reason: e.detail,
      ok: true,
      error: null,
    })),
  ].sort((a, b) => b.at - a.at);

  return (
    <Card style={{ padding: 24 }}>
      <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
        Timeline
      </h2>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
        Console actions and billing events, newest first.
      </p>
      {entries.length === 0 ? (
        <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>Nothing recorded yet.</p>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>When</th>
              <th>Source</th>
              <th>What</th>
              <th>Who</th>
              <th>Reason or detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.key}>
                <td style={{ whiteSpace: "nowrap" }}>{fmtDate(e.at)}</td>
                <td>
                  <span
                    className="chip"
                    style={
                      e.source === "console"
                        ? { background: "rgba(232,93,36,.15)", color: "var(--accent)" }
                        : { background: "var(--surface-2)", color: "var(--text-secondary)" }
                    }
                  >
                    {e.source}
                  </span>
                </td>
                <td style={{ color: e.ok ? undefined : "var(--red)" }}>
                  {e.label}
                  {!e.ok && " (refused)"}
                </td>
                <td>{e.who}</td>
                <td style={{ color: "var(--text-secondary)" }}>{e.error ?? e.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
