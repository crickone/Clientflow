"use client";

import { AlertTriangle, Check, Loader2, PencilLine } from "lucide-react";

import type { Autosave } from "./useAutosave";
import { Button } from "@/components/ui/Button";

interface Props {
  autosave: Autosave;
  /**
   * Sticks the bar to the bottom of the viewport. On by default: a save state
   * you have to scroll to find is the problem this replaced, and a long
   * settings page would otherwise hide it below the fold.
   */
  sticky?: boolean;
}

const TONE: Record<string, { colour: string; icon: React.ReactNode }> = {
  idle: { colour: "var(--text-tertiary)", icon: null },
  dirty: { colour: "var(--text-tertiary)", icon: <PencilLine size={13} /> },
  saving: { colour: "var(--text-tertiary)", icon: <Loader2 size={13} className="spin" /> },
  saved: { colour: "var(--success)", icon: <Check size={13} /> },
  error: { colour: "var(--danger)", icon: <AlertTriangle size={13} /> },
};

/**
 * The visible counterpart to `useAutosave` — this is what replaces the Save
 * button on an autosaving settings form.
 *
 * It is deliberately never silent. An autosaving form with no indicator leaves
 * the operator unsure whether anything was kept, which is exactly the anxiety a
 * Save button removes; so the bar holds its ground and reports the last save
 * time even when nothing is happening.
 */
export function SaveStatus({ autosave, sticky = true }: Props) {
  const { status, saveNow } = autosave;
  const tone = TONE[status.kind] ?? TONE.idle;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 10,
        minHeight: 34,
        ...(sticky
          ? {
              position: "sticky",
              bottom: 0,
              zIndex: 2,
              padding: "12px 0",
              // Fades the page out behind the bar rather than cutting it with a
              // hard edge, so content scrolling under it stays legible.
              background:
                "linear-gradient(to top, var(--bg) 55%, color-mix(in srgb, var(--bg) 70%, transparent))",
            }
          : {}),
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12.5,
          color: tone.colour,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {tone.icon}
        {status.text}
      </span>
      {status.kind === "error" && (
        <Button type="button" variant="secondary" size="sm" onClick={saveNow}>
          Retry
        </Button>
      )}
    </div>
  );
}
