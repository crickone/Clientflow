"use client";

import { History } from "lucide-react";

import { Button } from "@/components/ui/Button";

function time(ms: number) {
  return new Date(ms).toLocaleString("en-IE", { weekday: "short", hour: "2-digit", minute: "2-digit" });
}

/** "We put your unsaved changes back", with a way to throw them away. */
export function DraftNotice({ restoredAt, onDiscard }: { restoredAt: number | null; onDiscard: () => void }) {
  if (!restoredAt) return null;
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        padding: "10px 12px 10px 14px",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        background: "var(--surface-1)",
        fontSize: 13.5,
        color: "var(--text-secondary)",
      }}
    >
      <History size={16} style={{ color: "var(--accent-ink)", flexShrink: 0 }} />
      <span style={{ flex: 1, minWidth: 200 }}>
        Your unsaved changes from {time(restoredAt)} have been put back. Save to keep them.
      </span>
      <Button variant="ghost" size="sm" onClick={onDiscard}>
        Discard them
      </Button>
    </div>
  );
}

/** Small "Draft kept" note beside the save buttons. */
export function DraftSaved({ savedAt }: { savedAt: number | null }) {
  if (!savedAt) return null;
  return <span style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginRight: "auto" }}>Draft kept on this device until you save</span>;
}
