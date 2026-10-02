"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

import { setFinancialVisibilityAction, setWidgetVisibilityAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Sensitivity } from "@/lib/dashboard/types";

export type VisibilityRow = {
  key: string;
  title: string;
  description: string;
  domainLabel: string;
  sensitivity: Sensitivity;
  visible: boolean;
  overridden: boolean;
};

function Toggle({ on, onToggle, pending, label }: { on: boolean; onToggle: () => void; pending: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      disabled={pending}
      style={{
        width: 38,
        height: 22,
        borderRadius: 999,
        background: on ? "var(--accent)" : "var(--surface-3)",
        border: "1px solid var(--hairline)",
        position: "relative",
        cursor: pending ? "default" : "pointer",
        flexShrink: 0,
        padding: 0,
        transition: "background 0.15s var(--ease)",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 2,
          left: on ? 17 : 2,
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: on ? "var(--accent-contrast)" : "var(--text-secondary)",
          transition: "left 0.15s var(--ease)",
        }}
      />
    </button>
  );
}

export function VisibilityTable({ rows }: { rows: VisibilityRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => ReturnType<typeof setWidgetVisibilityAction>) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
      router.refresh();
    });

  const groups = new Map<string, VisibilityRow[]>();
  for (const r of rows) groups.set(r.domainLabel, [...(groups.get(r.domainLabel) ?? []), r]);

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setFinancialVisibilityAction(true))}>
          Show all financial to staff
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setFinancialVisibilityAction(false))}>
          Hide all financial from staff
        </Button>
      </div>
      {error && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {[...groups.entries()].map(([label, list]) => (
        <Card key={label} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 10 }}>{label}</div>
          {list.map((r) => (
            <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderTop: "1px solid var(--hairline)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>
                  {r.title}
                  {r.sensitivity !== "general" && <Lock size={12} color="var(--text-tertiary)" aria-label="Financial" />}
                </div>
                <div style={{ color: "var(--text-tertiary)", fontSize: 12.5, marginTop: 2 }}>{r.description}</div>
              </div>
              {r.overridden && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => setWidgetVisibilityAction(r.key, null))}
                >
                  Use default
                </Button>
              )}
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                Staff can see
                <Toggle
                  on={r.visible}
                  pending={pending}
                  label={`Staff can see ${r.title}`}
                  onToggle={() => run(() => setWidgetVisibilityAction(r.key, !r.visible))}
                />
              </span>
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}
