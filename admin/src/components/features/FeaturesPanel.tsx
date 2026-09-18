"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setModuleAction, type FeatureActionResult } from "@/app/(console)/gyms/[id]/features/actions";
import { Card } from "@/components/ui/Card";
import type { TenantFeatures } from "@/lib/types";

/**
 * The Features tab: one switch per module.
 *
 * Switching a module off hides it from the client's sidebar AND refuses its
 * routes, so this is a real capability change rather than a cosmetic one.
 * Their data is untouched: switching it back on returns everything exactly
 * as it was, which is why there is no confirmation on the way off.
 */
export function FeaturesPanel({ tenantId, data }: { tenantId: number; data: TenantFeatures }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<FeatureActionResult | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  function toggle(key: string, on: boolean) {
    setBusyKey(key);
    setResult(null);
    start(async () => {
      const r = await setModuleAction(tenantId, key, on);
      setResult(r);
      setBusyKey(null);
      if (r.ok) router.refresh();
    });
  }

  const off = data.modules.filter((m) => !m.on);

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
          Modules
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--text-secondary)" }}>
          {off.length === 0
            ? "Everything is on. Switching a module off hides it from their sidebar and refuses its pages; their data stays exactly where it is."
            : `${off.length} module${off.length === 1 ? "" : "s"} switched off. Their data is untouched — switching one back on returns it as it was.`}
        </p>
        <div style={{ display: "grid", gap: 2 }}>
          {data.modules.map((m) => (
            <label
              key={m.key}
              htmlFor={`mod-${m.key}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "12px 10px",
                borderRadius: "var(--radius)",
                cursor: pending ? "wait" : "pointer",
                opacity: m.on ? 1 : 0.6,
              }}
            >
              <input
                id={`mod-${m.key}`}
                type="checkbox"
                checked={m.on}
                disabled={pending}
                onChange={(e) => toggle(m.key, e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
                  {m.label}
                  {busyKey === m.key && <span style={{ color: "var(--text-secondary)", fontWeight: 400 }}> saving…</span>}
                </span>
                <span style={{ display: "block", fontSize: 12.5, color: "var(--text-secondary)" }}>{m.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card style={{ padding: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.02em" }}>
          Venue
        </h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 20 }}>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>Venue type</div>
            <div style={{ fontSize: 15 }}>{data.venueType}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
              Drives their vocabulary: members and classes, or clients and therapies. Change it on the Money tab.
            </div>
          </div>
          <div>
            <div className="mono-label" style={{ marginBottom: 6 }}>Scheduling</div>
            <div style={{ fontSize: 15 }}>{data.schedulingMode}</div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
              One-to-one appointments, or a group timetable. They set this in their own settings.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
