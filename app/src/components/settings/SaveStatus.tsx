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
  // A form that cannot save yet is a warning, not a failure — nothing is
  // broken, there is just something to finish before it can go.
  blocked: { colour: "var(--warning)", icon: <PencilLine size={13} /> },
};

/**
 * The visible counterpart to `useAutosave` — and, in the states that matter,
 * deliberately INVISIBLE.
 *
 * Autosave that works needs no announcement. A pill reading "Saved 19:41" on
 * every settings page is a running commentary on something the operator
 * already assumes is happening, and the flash of it on each keystroke reads as
 * activity rather than reassurance. So idle, dirty, saving and saved all render
 * NOTHING.
 *
 * What is never silent is autosave that ISN'T working:
 *   - `error`   — the save failed, and the work is still only on screen;
 *   - `blocked` — the form can't be saved yet (a half-typed email the server
 *                 would reject), so nothing is being sent at all.
 * Both are cases where staying quiet would let someone navigate away from work
 * that was never kept, which is the one failure an autosaving form must not
 * have. That is the line: silent when it works, loud when it doesn't.
 *
 * (`useAutosave` still flushes pending edits on unmount and warns on tab close,
 * so the quiet states are genuinely safe rather than merely undisplayed.)
 */
export function SaveStatus({ autosave, sticky = true }: Props) {
  const { status, saveNow } = autosave;
  const tone = TONE[status.kind] ?? TONE.idle;

  if (status.kind !== "error" && status.kind !== "blocked") return null;

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
