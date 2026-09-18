"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  integrationAction,
  type IntegrationActionResult,
  type IntegrationOp,
} from "@/app/(console)/gyms/[id]/integrations/actions";
import { Card } from "@/components/ui/Card";
import type { ConnectionRow, TenantIntegrations } from "@/lib/types";

/**
 * The Integrations board: what a business is connected to, and the small
 * set of things the console may do about it.
 *
 * The console can take a connection away and re-check a domain's DNS. It
 * cannot create one — that needs the client's own consent — so there is no
 * "connect" button here, and the empty rows say who has to do it instead.
 */
const STATE_STYLE: Record<ConnectionRow["state"], { bg: string; fg: string; label: string }> = {
  connected: { bg: "rgba(63,185,80,.15)", fg: "var(--green)", label: "connected" },
  needs_attention: { bg: "rgba(242,193,78,.15)", fg: "var(--amber)", label: "needs attention" },
  not_connected: { bg: "var(--surface-2)", fg: "var(--muted)", label: "not connected" },
};

function day(ms: number | null): string {
  return ms ? new Date(ms).toLocaleDateString("en-IE") : "—";
}

export function IntegrationsBoard({ tenantId, data }: { tenantId: number; data: TenantIntegrations }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<IntegrationActionResult | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function run(key: string, body: IntegrationOp, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyKey(key);
    setResult(null);
    start(async () => {
      const r = await integrationAction(tenantId, body);
      setResult(r);
      setBusyKey(null);
      if (r.ok) router.refresh();
    });
  }

  const liveKeys = data.apiKeys.filter((k) => !k.revokedAt);
  const revokedKeys = data.apiKeys.filter((k) => k.revokedAt);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {result && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            borderRadius: "var(--radius)",
            fontSize: 13.5,
            background: result.ok ? "rgba(63,185,80,.12)" : "rgba(240,128,154,.12)",
            border: `1px solid ${result.ok ? "rgba(63,185,80,.4)" : "rgba(240,128,154,.4)"}`,
          }}
        >
          {result.ok ? result.note : result.error}
        </div>
      )}

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Connections
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          No credential is ever shown here. Connecting has to be done by the client, from their own settings.
        </p>
        <table className="tbl">
          <thead>
            <tr>
              <th>Service</th>
              <th>State</th>
              <th>Account</th>
              <th>Connected</th>
              <th>Last activity</th>
              <th style={{ width: 1 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.connections.map((c) => {
              const style = STATE_STYLE[c.state];
              return (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td>
                    <span className="chip" style={{ background: style.bg, color: style.fg }}>{style.label}</span>
                  </td>
                  <td>
                    <div>{c.identity ?? <span style={{ color: "var(--text-tertiary)" }}>—</span>}</div>
                    {c.detail && <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>{c.detail}</div>}
                  </td>
                  <td>{day(c.connectedAt)}</td>
                  <td>{day(c.lastUsedAt)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      {c.actions.includes("reverify") && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={pending}
                          onClick={() => run(`reverify-${c.key}`, { op: "reverify-domain" })}
                        >
                          {busyKey === `reverify-${c.key}` ? "Checking…" : "Re-check DNS"}
                        </button>
                      )}
                      {c.actions.includes("disconnect") && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={pending}
                          style={{ color: "var(--red)" }}
                          onClick={() =>
                            run(
                              `disconnect-${c.key}`,
                              { op: "disconnect", key: c.key },
                              `Disconnect ${c.label}${c.identity ? ` (${c.identity})` : ""}? They will have to reconnect it themselves.`,
                            )
                          }
                        >
                          Disconnect
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          API keys
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          Used by their lead-intake integrations. Revoking one stops whatever is using it, immediately.
        </p>
        {liveKeys.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>No live keys.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Key</th>
                <th>Label</th>
                <th>Scopes</th>
                <th>Last used</th>
                <th style={{ width: 1 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {liveKeys.map((k) => (
                <tr key={k.id}>
                  <td style={{ fontFamily: "ui-monospace, monospace" }}>{k.prefix}…</td>
                  <td>{k.label ?? <span style={{ color: "var(--text-tertiary)" }}>—</span>}</td>
                  <td style={{ color: "var(--text-secondary)" }}>{k.scopes}</td>
                  <td>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString("en-IE") : "Never"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn--secondary btn--sm"
                      disabled={pending}
                      style={{ color: "var(--red)" }}
                      onClick={() =>
                        run(
                          `key-${k.id}`,
                          { op: "revoke-api-key", keyId: k.id },
                          `Revoke ${k.prefix}…? Anything using it stops working now.`,
                        )
                      }
                    >
                      {busyKey === `key-${k.id}` ? "…" : "Revoke"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {revokedKeys.length > 0 && (
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--text-secondary)" }}>
            {revokedKeys.length} revoked key{revokedKeys.length === 1 ? "" : "s"} not shown.
          </p>
        )}
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Website domains
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          Hostnames pointing at their CMS sites.
        </p>
        {data.siteDomains.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>None connected.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Host</th>
                <th>Site</th>
                <th>Primary</th>
                <th>Verified</th>
              </tr>
            </thead>
            <tbody>
              {data.siteDomains.map((d) => (
                <tr key={d.id}>
                  <td style={{ fontFamily: "ui-monospace, monospace" }}>{d.host}</td>
                  <td style={{ color: "var(--text-secondary)" }}>#{d.siteId}</td>
                  <td>{d.isPrimary ? "Yes" : "—"}</td>
                  <td style={{ color: d.verifiedAt ? undefined : "var(--amber)" }}>
                    {d.verifiedAt ? day(d.verifiedAt) : "Not verified"}
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
