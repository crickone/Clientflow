import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { flowActivity } from "@/lib/leadFlows/activity";
import { nextStepLabel, statusLabel, type RunStatus } from "@/lib/leadFlows/activityModel";

const dublin = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const fmtWhen = (ms: number) => dublin.format(new Date(ms));

const FILTERS: { key: RunStatus | "all"; label: string }[] = [
  { key: "all", label: "Everyone" },
  { key: "active", label: "Active" },
  { key: "finished", label: "Finished" },
  { key: "stopped", label: "Stopped" },
];

const TONE: Record<RunStatus, "info" | "success" | "neutral"> = { active: "info", finished: "neutral", stopped: "success" };

/**
 * The automation's People tab: totals, then everyone who has entered this
 * flow, newest first, each linking to their step-by-step page.
 */
export function FlowActivity({ triggerKey, status }: { triggerKey: string; status: RunStatus | "all" }) {
  const { counts, rows, total } = flowActivity(triggerKey, { status, limit: 200 });
  const stat = (label: string, n: number) => (
    <div style={{ display: "grid", gap: 2 }}>
      <span style={{ fontSize: 12.5, color: "var(--text-tertiary)" }}>{label}</span>
      <span style={{ fontSize: 22, fontWeight: 600, color: "var(--text-primary)" }}>{n}</span>
    </div>
  );
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Card style={{ padding: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 16 }}>
        {stat("Entered", counts.entered)}
        {stat("Active now", counts.active)}
        {stat("Replied", counts.replied)}
        {stat("Finished", counts.finished)}
        {stat("Stopped", counts.stopped)}
      </Card>

      <nav aria-label="Filter people" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FILTERS.map((f) => {
          const on = f.key === status;
          return (
            <Link
              key={f.key}
              href={`/automations/${triggerKey}?tab=people${f.key === "all" ? "" : `&status=${f.key}`}`}
              aria-current={on ? "page" : undefined}
              style={{
                padding: "7px 14px",
                borderRadius: 999,
                fontSize: 13,
                border: `1px solid ${on ? "var(--text-primary)" : "var(--hairline-strong)"}`,
                color: on ? "var(--text-primary)" : "var(--text-secondary)",
                textDecoration: "none",
              }}
            >
              {f.label}
            </Link>
          );
        })}
      </nav>

      {rows.length === 0 ? (
        <Card style={{ padding: 24, color: "var(--text-tertiary)", fontSize: 14 }}>
          {counts.entered === 0 ? "Nobody has entered this follow-up yet. People appear here as soon as they do." : "Nobody matches this filter."}
        </Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 720 }}>
              <thead>
                <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 12 }}>
                  {["Person", "Entered", "Status", "Messages", "Last sent", "Next", ""].map((h) => (
                    <th key={h} style={{ padding: "12px 16px", fontWeight: 500, borderBottom: "1px solid var(--hairline)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const href = `/automations/${triggerKey}/runs/${r.runId}`;
                  return (
                    <tr key={r.runId} style={{ borderBottom: "1px solid var(--hairline)" }}>
                      <td style={{ padding: "12px 16px" }}>
                        <Link href={href} style={{ color: "var(--text-primary)", fontWeight: 500, textDecoration: "none" }}>
                          {r.name}
                        </Link>
                        {r.contact && <div style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>{r.contact}</div>}
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{fmtWhen(r.startedAt)}</td>
                      <td style={{ padding: "12px 16px" }}>
                        <Badge tone={TONE[r.status]} dot={r.status === "active"}>
                          {statusLabel(r.status, r.stopReason)}
                        </Badge>
                        {r.endedAt && <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 4 }}>{fmtWhen(r.endedAt)}</div>}
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {r.progress.sent} of {r.progress.messages} sent
                        {r.progress.failed > 0 && <div style={{ color: "var(--danger, #e5484d)", fontSize: 12 }}>{r.progress.failed} failed</div>}
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {r.progress.lastSentAt ? fmtWhen(r.progress.lastSentAt) : "None yet"}
                      </td>
                      <td style={{ padding: "12px 16px", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {r.status === "active" ? nextStepLabel(r.progress.next, fmtWhen) ?? "None" : "None"}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        <Link href={href} aria-label={`Open ${r.name}'s steps`} style={{ color: "var(--text-tertiary)" }}>
                          <ChevronRight size={16} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > rows.length && (
            <div style={{ padding: "10px 16px", fontSize: 12.5, color: "var(--text-tertiary)" }}>
              Showing the newest {rows.length} of {total}.
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
