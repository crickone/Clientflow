"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Card, CardLabel } from "@/components/ui/Card";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { assignLeadAction, setLeadMarketingConsentAction } from "@/app/leads/callActions";
import { CALL_OUTCOMES, formatCallDay, formatCallTime } from "@/lib/leadFlows/callPlan";
import { zonedTimeToUtc } from "@/lib/leadFlows/sendingWindow";
import { formatDateTime, relativeTime } from "@/lib/utils";

export interface LeadCallView {
  id: number;
  kind: string;
  outcome: string | null;
  scheduledFor: number | null;
  scheduledDay: string | null;
  createdAt: number;
}

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", email: "Email" };

const selectStyle: CSSProperties = {
  width: "100%",
  height: 38,
  padding: "0 12px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "var(--surface-1)",
  color: "var(--text-primary)",
  fontSize: 13,
  fontFamily: "inherit",
};

function callLine(c: LeadCallView): string {
  if (c.scheduledFor != null) return `Call booked for ${formatCallDay(c.scheduledFor)} at ${formatCallTime(c.scheduledFor)}`;
  if (c.scheduledDay) return `Call back on ${formatCallDay(zonedTimeToUtc(c.scheduledDay, "12:00"))}`;
  const label = CALL_OUTCOMES.find((o) => o.key === c.outcome)?.label;
  return label ? `Call: ${label}` : "Call back later, no day";
}

/** Who the lead is assigned to, whether they agreed to marketing, the flow they are in, their calls. */
export function LeadFollowUpsCard({
  leadId,
  assignedUserId,
  consentAt,
  staff,
  flow,
  calls,
}: {
  leadId: number;
  assignedUserId: number | null;
  consentAt: number | null;
  staff: { userId: number; name: string }[];
  flow: { flow: string | null; next: { channel: string; dueAt: number }[] };
  calls: LeadCallView[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [assignee, setAssignee] = useState(assignedUserId != null ? String(assignedUserId) : "");
  const [consent, setConsent] = useState(consentAt != null);
  const [pending, start] = useTransition();

  function assign(value: string) {
    const before = assignee;
    setAssignee(value);
    start(async () => {
      const res = await assignLeadAction(leadId, value ? Number(value) : null);
      if (res.ok) {
        toast.success(res.message ?? "Saved.");
        router.refresh();
      } else {
        setAssignee(before);
        toast.error(res.error);
      }
    });
  }

  async function toggleConsent() {
    const next = !consent;
    if (next) {
      const yes = await confirm({
        title: "They agreed to marketing?",
        body: "Only tick this if they told you they want news and offers. It lets the Long-term nurture flow send to them, and adds them to your email contacts.",
        confirmLabel: "They agreed",
      });
      if (!yes) return;
    }
    start(async () => {
      const res = await setLeadMarketingConsentAction(leadId, next);
      if (res.ok) {
        setConsent(next);
        toast.success(res.message ?? "Saved.");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const next = flow.next[0];
  return (
    <Card className="ld-card">
      <CardLabel>Follow-ups</CardLabel>
      <dl className="ld-facts">
        <div>
          <dt>
            <label htmlFor={`assign-${leadId}`}>Assigned to</label>
          </dt>
          <dd>
            <select id={`assign-${leadId}`} value={assignee} onChange={(e) => assign(e.target.value)} disabled={pending} style={selectStyle}>
              <option value="">Nobody</option>
              {staff.map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.name}
                </option>
              ))}
            </select>
          </dd>
        </div>
        <div>
          <dt>Marketing</dt>
          <dd>
            <button
              type="button"
              role="switch"
              aria-checked={consent}
              onClick={() => void toggleConsent()}
              disabled={pending}
              style={{
                padding: "7px 12px",
                borderRadius: "var(--radius)",
                border: "1px solid var(--hairline)",
                background: consent ? "var(--accent)" : "var(--surface-1)",
                color: consent ? "var(--accent-contrast)" : "var(--text-secondary)",
                fontSize: 12.5,
                fontFamily: "inherit",
                cursor: "pointer",
              }}
            >
              {consent ? "Agreed to news and offers" : "Not agreed"}
            </button>
          </dd>
        </div>
        <div>
          <dt>Flow</dt>
          <dd>{flow.flow ?? "None running"}</dd>
        </div>
        {next && (
          <div>
            <dt>Next message</dt>
            <dd>
              {CHANNEL[next.channel] ?? next.channel}, {formatDateTime(next.dueAt)}
            </dd>
          </div>
        )}
      </dl>
      {calls.length > 0 && (
        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {calls.slice(0, 5).map((c) => (
            <li key={c.id} style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
              {callLine(c)} <span style={{ color: "var(--text-tertiary)" }}>· {relativeTime(c.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
