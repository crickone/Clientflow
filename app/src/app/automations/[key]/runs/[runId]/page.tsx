import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { requireUser } from "@/lib/auth";
import { getTrigger } from "@/lib/automations";
import { runTimeline } from "@/lib/leadFlows/activity";
import { channelLabel, statusLabel, type RunStatus } from "@/lib/leadFlows/activityModel";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { fmtWhen } from "@/components/automations/FlowActivity";

export const dynamic = "force-dynamic";

const STEP_STATUS: Record<string, { label: string; tone: "success" | "info" | "danger" | "neutral" }> = {
  sent: { label: "Sent", tone: "success" },
  queued: { label: "Due", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Not sent", tone: "neutral" },
};

const KIND: Record<string, string> = {
  move: "Move to the next column",
  callback_check: "Check the call happened",
  reply_check: "Check the reply",
  staff_alert: "Staff alert",
};

/** One person's run through a follow-up: every step, when, what was sent and how it went. */
export default async function RunPage(props: { params: Promise<{ key: string; runId: string }> }) {
  const { key, runId } = await props.params;
  await requireUser();
  const trigger = getTrigger(key);
  const data = trigger ? runTimeline(key, Number(runId)) : null;
  if (!trigger || !data) notFound();
  const { run, lead, steps } = data;
  return (
    <div className="app-page" style={{ maxWidth: 820 }}>
      <Link href={`/automations/${key}?tab=people`} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, color: "var(--text-tertiary)", textDecoration: "none", marginBottom: 14 }}>
        <ArrowLeft size={14} /> {trigger.label}
      </Link>
      <h1 style={{ margin: "0 0 6px", fontSize: 26 }}>
        {lead ? (
          <Link href={`/leads/${lead.id}`} style={{ color: "var(--text-primary)", textDecoration: "none" }}>
            {lead.name}
          </Link>
        ) : (
          "Lead removed"
        )}
      </h1>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", color: "var(--text-secondary)", fontSize: 13.5, marginBottom: 20 }}>
        {lead?.contact && <span>{lead.contact}</span>}
        <span>Entered {fmtWhen(run.startedAt)}</span>
        <Badge tone={run.status === "active" ? "info" : run.status === "stopped" ? "success" : "neutral"} dot={run.status === "active"}>
          {statusLabel(run.status as RunStatus, run.stopReason)}
        </Badge>
        {run.endedAt && <span>Ended {fmtWhen(run.endedAt)}</span>}
      </div>

      {steps.length === 0 ? (
        <Card style={{ padding: 20, color: "var(--text-tertiary)", fontSize: 14 }}>No steps were planned for this run.</Card>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 12 }}>
          {steps.map((s) => {
            const st = STEP_STATUS[s.status] ?? STEP_STATUS.queued;
            const isMessage = s.kind === "message";
            return (
              <li key={s.id}>
                <Card style={{ padding: 16, display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 14, color: "var(--text-primary)" }}>
                      {isMessage ? channelLabel(s.channel) : KIND[s.kind] ?? s.kind}
                    </strong>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    <span style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginLeft: "auto" }}>
                      {s.sentAt ? `Sent ${fmtWhen(s.sentAt)}` : `${s.status === "queued" ? "Due" : "Was due"} ${fmtWhen(s.dueAt)}`}
                    </span>
                  </div>
                  {isMessage && s.subject && <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>Subject: {s.subject}</div>}
                  {isMessage && s.body && (
                    <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--text-secondary)", whiteSpace: "pre-wrap" }}>{s.body}</div>
                  )}
                  {s.sendTo && <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>To {s.sendTo}</div>}
                  {s.error && <div style={{ fontSize: 12.5, color: "var(--danger, #e5484d)" }}>{s.error}</div>}
                </Card>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
