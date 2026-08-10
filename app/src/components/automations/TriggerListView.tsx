"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";

import { toggleTriggerAction } from "@/app/automations/actions";
import type { TriggerStatus } from "@/lib/automationModel";

interface TriggerRow {
  key: string;
  label: string;
  description: string;
  status: TriggerStatus;
  enabled: boolean;
  messageCount: number;
}

export function TriggerListView({ triggers }: { triggers: TriggerRow[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Tabs active="triggers" />
      <div style={{ border: "1px solid var(--hairline)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        <div style={{ ...row, ...headRow }}>
          <div>Name</div>
          <div style={{ textAlign: "center" }}>Status</div>
          <div style={{ textAlign: "right" }}>Actions</div>
        </div>
        {triggers.map((t) => (
          <TriggerRowItem key={t.key} trigger={t} />
        ))}
      </div>
    </div>
  );
}

function TriggerRowItem({ trigger }: { trigger: TriggerRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [on, setOn] = useState(trigger.enabled);
  const comingSoon = trigger.status === "coming_soon";

  const toggle = () => {
    if (comingSoon) return; // nothing to switch on yet — see ComingSoonBadge
    const next = !on;
    setOn(next);
    start(async () => {
      await toggleTriggerAction(trigger.key, next);
      router.refresh();
    });
  };
  const open = () => router.push(`/automations/${trigger.key}`);

  return (
    <div style={{ ...row, opacity: pending ? 0.7 : 1 }}>
      <button onClick={open} style={{ textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{trigger.label}</div>
          {comingSoon && <ComingSoonBadge />}
        </div>
        <div style={{ fontSize: 12, color: "var(--text-tertiary)" }}>
          {comingSoon
            ? "Not wired up to send yet."
            : trigger.messageCount > 0
              ? `${trigger.messageCount} message${trigger.messageCount === 1 ? "" : "s"}`
              : trigger.description}
        </div>
      </button>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <Switch on={on} onClick={toggle} disabled={comingSoon} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={open}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 13 }}
        >
          {comingSoon ? "View" : "Edit"} <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

export function Switch({ on, onClick, disabled = false }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      style={{
        width: 44,
        height: 25,
        borderRadius: 999,
        background: on ? "var(--accent)" : "var(--surface-3)",
        border: "1px solid var(--hairline)",
        position: "relative",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        flexShrink: 0,
        transition: "background 0.15s var(--ease)",
      }}
    >
      <span style={{ position: "absolute", top: 2, left: on ? 21 : 2, width: 19, height: 19, borderRadius: "50%", background: "#fff", transition: "left 0.15s var(--ease)" }} />
    </button>
  );
}

/** Small "Coming soon" pill — single visual marker for a coming_soon TriggerStatus, used on both the list row and the trigger editor (Theme D1). */
export function ComingSoonBadge() {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--text-tertiary)",
        background: "var(--surface-2)",
        border: "1px solid var(--hairline)",
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      Coming soon
    </span>
  );
}

export function Tabs({ active }: { active: "triggers" | "sent" }) {
  const router = useRouter();
  const tab = (label: string, key: "triggers" | "sent", href: string) => {
    const isActive = active === key;
    return (
      <button
        onClick={() => router.push(href)}
        style={{
          padding: "8px 16px",
          borderRadius: "var(--radius)",
          border: "1px solid var(--hairline)",
          background: isActive ? "var(--accent)" : "transparent",
          color: isActive ? "#fff" : "var(--text-secondary)",
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      {tab("Trigger List", "triggers", "/automations")}
      {tab("Sent Messages", "sent", "/automations/sent")}
    </div>
  );
}

const row: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 120px 120px",
  gap: 12,
  padding: "14px 18px",
  borderBottom: "1px solid var(--hairline)",
  alignItems: "center",
  fontSize: 13,
};
const headRow: React.CSSProperties = {
  background: "var(--surface-1)",
  fontSize: 10.5,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--text-tertiary)",
  fontFamily: "var(--font-mono), monospace",
};
