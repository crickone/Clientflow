"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { dataAction, type DataActionResult, type DataOp } from "@/app/(console)/gyms/[id]/data/actions";
import { Card } from "@/components/ui/Card";
import { bytes } from "@/components/health/HealthPanel";
import type { PersonHit, TenantData } from "@/lib/types";

/**
 * The Data tab: what a business holds, and the two things support is asked
 * to do with it — find one person, and remove them on request.
 *
 * The order of the person controls is deliberate. Export sits to the left
 * of Delete, and the delete button explains that the export is the thing
 * to do first, because a subject access request usually wants both and only
 * one of them is reversible.
 */
export function DataPanel({
  tenantId,
  data,
  query,
  isOwner,
}: {
  tenantId: number;
  data: TenantData;
  query: string;
  isOwner: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<DataActionResult | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function run(key: string, body: DataOp) {
    setBusyKey(key);
    setResult(null);
    start(async () => {
      const r = await dataAction(tenantId, body);
      setResult(r);
      setBusyKey(null);
      if (r.ok && !r.data) router.refresh();
    });
  }

  function exportPerson(p: PersonHit) {
    setBusyKey(`export-${p.kind}-${p.id}`);
    setResult(null);
    start(async () => {
      const r = await dataAction(tenantId, { op: "export-person", kind: p.kind, personId: p.id });
      setBusyKey(null);
      if (!r.ok) {
        setResult(r);
        return;
      }
      // Hand it over as a file rather than printing it: this is what gets
      // sent to the person who asked for it.
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${p.kind}-${p.id}-${p.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setResult({ ok: true, note: `Exported ${p.name}.` });
    });
  }

  function deletePerson(p: PersonHit) {
    const reason = window.prompt(
      `Delete ${p.name} and everything attached to them? This cannot be undone.\n\nExport them first if they asked for their data.\n\nWhy is this being deleted?`,
      "",
    )?.trim();
    if (!reason) return;
    if (reason.length < 3) {
      setResult({ ok: false, error: "Give a slightly longer reason." });
      return;
    }
    if (!window.confirm(`Last check: permanently delete ${p.name} (${p.email ?? p.phone ?? "no contact"})?`)) return;
    run(`delete-${p.kind}-${p.id}`, { op: "delete-person", kind: p.kind, personId: p.id, reason });
  }

  const life = data.lifecycle;

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
          {result.ok ? (result.note ?? "Done.") : result.error}
        </div>
      )}

      {life?.archivedAt && (
        <Card style={{ padding: 16, borderColor: "var(--amber)" }}>
          <div style={{ fontSize: 13.5, color: "var(--text-primary)" }}>
            <strong>Archived.</strong> Their logins are closed and nothing is being charged, but every byte below is still
            here.{" "}
            {life.daysLeft === 0
              ? "The automatic purge is due on the next daily run."
              : `It will be permanently deleted in ${life.daysLeft} day${life.daysLeft === 1 ? "" : "s"} unless it is restored.`}
          </div>
        </Card>
      )}

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          What they hold
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 18 }}>
          {data.counts.map((c) => (
            <div key={c.key}>
              <div style={{ fontSize: 20, fontVariantNumeric: "tabular-nums", color: c.count === 0 ? "var(--text-tertiary)" : undefined }}>
                {c.count.toLocaleString()}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{c.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--grid)" }}>
          {data.storage.map((s) => (
            <div key={s.key}>
              <div className="mono-label" style={{ marginBottom: 4 }}>{s.label}</div>
              <div style={{ fontSize: 15, fontVariantNumeric: "tabular-nums" }}>{bytes(s.bytes)}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Find a person
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          Searches clients and leads by name, email or phone. For a subject access request, export first, then delete.
        </p>
        <form method="GET" style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            className="input"
            type="search"
            name="q"
            placeholder="Name, email or phone…"
            defaultValue={query}
            style={{ maxWidth: 320 }}
          />
          <button className="btn btn--primary btn--md" type="submit">Search</button>
        </form>

        {query && data.people.length === 0 && (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>Nobody matches that.</p>
        )}
        {data.people.length > 0 && (
          <table className="tbl">
            <thead>
              <tr>
                <th>Person</th>
                <th>Record</th>
                <th>Contact</th>
                <th style={{ width: 1 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={`${p.kind}-${p.id}`}>
                  <td>{p.name}</td>
                  <td>
                    <span className="chip" style={{ background: "var(--surface-2)" }}>{p.kind}</span>
                  </td>
                  <td style={{ color: "var(--text-secondary)" }}>{p.email ?? p.phone ?? "—"}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn--secondary btn--sm"
                        disabled={pending}
                        onClick={() => exportPerson(p)}
                      >
                        {busyKey === `export-${p.kind}-${p.id}` ? "…" : "Export"}
                      </button>
                      {isOwner && (
                        <button
                          type="button"
                          className="btn btn--secondary btn--sm"
                          disabled={pending}
                          style={{ color: "var(--red)" }}
                          onClick={() => deletePerson(p)}
                        >
                          {busyKey === `delete-${p.kind}-${p.id}` ? "…" : "Delete"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!isOwner && data.people.length > 0 && (
          <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--text-secondary)" }}>
            Deleting someone&rsquo;s data is an owner&rsquo;s action. You can export it.
          </p>
        )}
      </Card>

      <Card style={{ padding: 24 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
            Backups
          </h2>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={pending}
            style={{ marginLeft: "auto" }}
            onClick={() => run("backup", { op: "backup" })}
          >
            {busyKey === "backup" ? "Taking…" : "Take a backup now"}
          </button>
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          A consistent copy of their database, written to the archive folder on the volume. Taken automatically before any
          purge.
        </p>
        {data.backups.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>None taken yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>File</th>
                <th>Size</th>
                <th>Taken</th>
              </tr>
            </thead>
            <tbody>
              {data.backups.slice(0, 10).map((b) => (
                <tr key={b.name}>
                  <td style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5 }}>{b.name}</td>
                  <td style={{ fontVariantNumeric: "tabular-nums" }}>{bytes(b.bytes)}</td>
                  <td>{new Date(b.createdAt).toLocaleString("en-IE")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
