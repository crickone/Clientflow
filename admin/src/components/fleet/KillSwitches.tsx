"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setKillSwitchAction, type FleetActionResult } from "@/app/(console)/gyms/actions";
import { Card } from "@/components/ui/Card";
import type { KillSwitchState } from "@/lib/types";

/**
 * The switches that stop one capability for every business at once.
 *
 * Shown to both roles, because knowing the platform is paused explains half
 * the support calls that follow. Only an owner can move one, and stopping
 * requires a reason — it is the most far-reaching action here.
 */
export function KillSwitches({ switches, isOwner }: { switches: KillSwitchState[]; isOwner: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FleetActionResult | null>(null);

  function toggle(s: KillSwitchState) {
    let reason = "";
    if (!s.stopped) {
      reason = window.prompt(`Stop ${s.label} for EVERY business. Why?`, "")?.trim() ?? "";
      if (!reason) return;
      if (reason.length < 3) {
        setResult({ ok: false, error: "Give a slightly longer reason." });
        return;
      }
    } else if (!window.confirm(`Start ${s.label} again for every business?`)) {
      return;
    }
    setResult(null);
    start(async () => {
      const r = await setKillSwitchAction(s.key, !s.stopped, reason);
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  const anyStopped = switches.some((s) => s.stopped);

  return (
    <Card style={{ padding: 20, borderColor: anyStopped ? "var(--red)" : undefined }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Platform switches
        </h2>
        {anyStopped && (
          <span className="chip" style={{ background: "rgba(240,128,154,.15)", color: "var(--red)" }}>
            something is paused
          </span>
        )}
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-secondary)" }}>
        These stop a capability for every business at once. Nothing is lost while one is off — work waits and resumes.
      </p>

      {result && (
        <div
          role="status"
          style={{
            padding: "10px 14px",
            marginBottom: 14,
            borderRadius: "var(--radius)",
            fontSize: 13.5,
            background: result.ok ? "rgba(63,185,80,.12)" : "rgba(240,128,154,.12)",
            border: `1px solid ${result.ok ? "rgba(63,185,80,.4)" : "rgba(240,128,154,.4)"}`,
          }}
        >
          {result.ok ? result.note : result.error}
        </div>
      )}

      <div style={{ display: "grid", gap: 10 }}>
        {switches.map((s) => (
          <div
            key={s.key}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 12,
              padding: "12px 14px",
              border: "1px solid var(--grid)",
              borderRadius: "var(--radius)",
              background: s.stopped ? "rgba(240,128,154,.06)" : undefined,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500 }}>
                {s.label}{" "}
                {s.stopped ? (
                  <span className="chip" style={{ background: "rgba(240,128,154,.15)", color: "var(--red)" }}>stopped</span>
                ) : (
                  <span className="chip" style={{ background: "rgba(63,185,80,.15)", color: "var(--green)" }}>running</span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 2 }}>{s.blurb}</div>
              {s.stopped && s.reason && (
                <div style={{ fontSize: 12.5, color: "var(--red)", marginTop: 4 }}>
                  {s.reason}
                  {s.since ? ` — since ${new Date(s.since).toLocaleString("en-IE")}` : ""}
                </div>
              )}
            </div>
            {isOwner && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                disabled={pending}
                style={s.stopped ? undefined : { color: "var(--red)" }}
                onClick={() => toggle(s)}
              >
                {s.stopped ? "Start again" : "Stop"}
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
