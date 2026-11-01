"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/Button";
import { deleteCycleDataAction, removePeriodAction, setCycleSettingsAction } from "@/app/app/actions";
import type { Period } from "@/lib/cycleModel";
import { dayLabel } from "@/components/clientapp/ui";

/** Sharing, the no-periods mode, past periods, and the delete-everything button. */
export function CycleSettings({ shareWithCoach, mode, periods, onPeriodId, business }: { shareWithCoach: boolean; mode: "cycle" | "none"; periods: Period[]; onPeriodId: number | null; business: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [showAll, setShowAll] = useState(false);

  function patch(p: { shareWithCoach?: boolean; mode?: "cycle" | "none" }) {
    start(async () => {
      const r = await setCycleSettingsAction(p);
      if (!r.ok) toast.error(r.error);
      router.refresh();
    });
  }

  const shown = showAll ? periods : periods.slice(0, 4);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <label className="cy-switch">
        <span>
          <span className="cy-switch-title">Share with my coach</span>
          <span className="cy-switch-sub">{shareWithCoach ? `Your coach at ${business} can see your cycle and check-ins.` : `Off. Nobody at ${business} can see this.`}</span>
        </span>
        <input type="checkbox" role="switch" checked={shareWithCoach} disabled={pending} onChange={(e) => patch({ shareWithCoach: e.target.checked })} />
      </label>
      <label className="cy-switch">
        <span>
          <span className="cy-switch-title">I&apos;m not having periods at the moment</span>
          <span className="cy-switch-sub">Keeps the daily check-ins and turns off period predictions. For contraception, pregnancy, perimenopause or any other reason.</span>
        </span>
        <input type="checkbox" role="switch" checked={mode === "none"} disabled={pending} onChange={(e) => patch({ mode: e.target.checked ? "none" : "cycle" })} />
      </label>

      {periods.length > 0 && (
        <div>
          <div className="cy-switch-title" style={{ marginBottom: 6 }}>Periods logged</div>
          <ul className="cy-periods">
            {shown.map((p) => (
              <li key={p.id}>
                <span>
                  {dayLabel(p.startDay, { day: "numeric", month: "short" })}
                  {p.endDay ? ` to ${dayLabel(p.endDay, { day: "numeric", month: "short" })}` : p.id === onPeriodId ? " (still on)" : " (no end logged)"}
                </span>
                <button
                  type="button"
                  className="cy-link"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      await removePeriodAction(p.id);
                      router.refresh();
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {periods.length > 4 && !showAll && (
            <button type="button" className="cy-link" onClick={() => setShowAll(true)}>
              Show all {periods.length}
            </button>
          )}
        </div>
      )}

      {confirm ? (
        <div style={{ display: "grid", gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>This deletes every period and check-in you&apos;ve logged and turns tracking off. It can&apos;t be undone.</p>
          <div style={{ display: "flex", gap: 8 }}>
            <Button
              variant="destructive"
              loading={pending}
              onClick={() =>
                start(async () => {
                  await deleteCycleDataAction();
                  toast.success("Deleted");
                  router.replace("/app");
                })
              }
            >
              Delete everything
            </Button>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" className="cy-link" style={{ color: "var(--danger)" }} onClick={() => setConfirm(true)}>
          Delete all my cycle data
        </button>
      )}
    </div>
  );
}
