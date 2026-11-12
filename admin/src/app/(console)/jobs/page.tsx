import { api } from "@/lib/api";
import { fmtDuration } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { RunStrip } from "@/components/jobs/RunStrip";
import type { JobRun, JobsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

function when(ms: number): string {
  return new Date(ms).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const MONO = "var(--font-mono), ui-monospace, monospace";

/** Every background job: last run, outcome, duration, and its recent history. */
export default async function JobsPage(props: { searchParams: Promise<{ key?: string }> }) {
  const sp = await props.searchParams;
  const { latest } = await api<JobsResponse>("/jobs");
  const histories = await Promise.all(
    latest.map((j) =>
      api<JobsResponse>(`/jobs?key=${encodeURIComponent(j.key)}&limit=30`)
        .then((r) => [j.key, r.history] as const)
        .catch(() => [j.key, [] as JobRun[]] as const),
    ),
  );
  const byKey = new Map(histories);
  const open = sp.key ? byKey.get(sp.key) ?? [] : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader eyebrow="Operate" title="Jobs" sub="The platform's background work. A failed run opens an alert in the inbox." />
      <Card style={{ padding: "20px 26px 16px" }}>
        {latest.length === 0 ? (
          <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13.5 }}>No job has run yet.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Job</th><th>Last run</th><th>Outcome</th><th style={{ textAlign: "right" }}>Took</th><th>Recent</th></tr></thead>
            <tbody>
              {latest.map((j) => (
                <tr key={j.key}>
                  <td><a href={`/jobs?key=${encodeURIComponent(j.key)}`}>{j.label}</a><div style={{ fontSize: 12, color: "var(--text-tertiary)", fontFamily: MONO }}>{j.key}</div></td>
                  <td style={{ whiteSpace: "nowrap" }}>{when(j.startedAt)}</td>
                  <td>{j.ok === true ? <span className="chip active">ok</span> : j.ok === false ? <span className="chip suspended" title={j.error ?? ""}>failed</span> : <span className="chip" title="No finish was recorded">running or interrupted</span>}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtDuration(j.durationMs)}</td>
                  <td><RunStrip runs={byKey.get(j.key) ?? []} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {sp.key && (
        <Card style={{ padding: "20px 26px 16px" }}>
          <h2 className="card-title" style={{ margin: "0 0 12px" }}>{latest.find((j) => j.key === sp.key)?.label ?? sp.key}: last {open.length} runs</h2>
          <table className="tbl">
            <thead><tr><th>Started</th><th>Outcome</th><th style={{ textAlign: "right" }}>Took</th><th>Detail</th></tr></thead>
            <tbody>
              {open.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: "nowrap" }}>{when(r.startedAt)}</td>
                  <td style={{ color: r.ok === false ? "var(--red)" : undefined }}>{r.ok === true ? "ok" : r.ok === false ? r.error ?? "failed" : "running or interrupted"}</td>
                  <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtDuration(r.durationMs)}</td>
                  <td><code title={r.detail ? JSON.stringify(r.detail) : undefined} style={{ fontFamily: MONO, fontSize: 12, color: "var(--text-secondary)" }}>{r.detail ? (JSON.stringify(r.detail).length > 120 ? `${JSON.stringify(r.detail).slice(0, 120)}…` : JSON.stringify(r.detail)) : ""}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
