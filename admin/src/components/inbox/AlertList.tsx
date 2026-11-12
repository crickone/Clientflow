"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Clock, OctagonAlert, UserRound } from "lucide-react";

import { notify } from "@/lib/toast";
import { alertAction } from "@/app/(console)/inbox/actions";
import type { PlatformAlert, PlatformStaffRow } from "@/lib/types";

function ago(ms: number): string {
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "1 day";
  return `${d} days`;
}

/** Ranked list: bad, then warn; unacknowledged before acknowledged; oldest first. The server already orders it. */
export function AlertList({ alerts, staff, meId }: { alerts: PlatformAlert[]; staff: PlatformStaffRow[]; meId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (body: Parameters<typeof alertAction>[0], done: string) =>
    start(async () => {
      const r = await alertAction(body);
      if (r.ok) { notify.ok(done); router.refresh(); } else notify.fail(r.error);
    });
  if (alerts.length === 0) return <p className="inbox-empty">Nothing needs you. The next sweep runs on the hour.</p>;
  return (
    <ul className="inbox">
      {alerts.map((a) => {
        const Icon = a.level === "bad" ? OctagonAlert : AlertTriangle;
        const assignee = staff.find((s) => s.userId === a.assignedTo);
        return (
          <li key={a.id} className={`inbox-row is-${a.level}${a.acknowledgedAt ? " is-acked" : ""}`}>
            <Icon size={16} strokeWidth={1.75} className="inbox-icon" aria-label={a.level === "bad" ? "Needs action" : "Watch"} />
            <div className="inbox-main">
              <Link href={a.href ?? "/"} className="inbox-title">{a.title}</Link>
              <div className="inbox-meta">
                {a.tenantName && <Link href={`/gyms/${a.tenantId}`}>{a.tenantName}</Link>}
                <span>open {ago(a.openedAt)}</span>
                {a.acknowledgedAt && <span>acknowledged</span>}
                {assignee && <span><UserRound size={11} aria-hidden /> {assignee.name ?? assignee.email}</span>}
              </div>
            </div>
            <div className="inbox-actions">
              {a.acknowledgedAt ? (
                <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => run({ id: a.id, op: "unack" }, "Reopened")}>Reopen</button>
              ) : (
                <button type="button" className="btn btn--secondary btn--sm" disabled={pending} onClick={() => run({ id: a.id, op: "ack" }, "Acknowledged")}><Check size={13} aria-hidden /> Acknowledge</button>
              )}
              <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => run({ id: a.id, op: "snooze", until: Date.now() + 86400000 }, "Snoozed for a day")}><Clock size={13} aria-hidden /> 1d</button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={() => run({ id: a.id, op: "snooze", until: Date.now() + 7 * 86400000 }, "Snoozed for a week")}>7d</button>
              <select
                className="input"
                aria-label="Assign to"
                value={a.assignedTo ?? ""}
                disabled={pending}
                onChange={(e) => run({ id: a.id, op: "assign", userId: e.target.value ? Number(e.target.value) : null }, e.target.value ? "Assigned" : "Unassigned")}
                style={{ minHeight: 32, padding: "0 36px 0 10px", fontSize: 12.5, width: "auto" }}
              >
                <option value="">Unassigned</option>
                {staff.map((s) => <option key={s.userId} value={s.userId}>{s.userId === meId ? "Me" : s.name ?? s.email}</option>)}
              </select>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
