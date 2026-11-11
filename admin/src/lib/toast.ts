"use client";

import { toast } from "sonner";

/**
 * Every console action confirms the same way: a short line in the corner.
 * Panels call these instead of keeping their own `result` state, so a
 * success never needs a box drawn for it and a failure reads the same on
 * every page.
 */
export const notify = {
  ok(message: string, note?: string): void {
    toast.success(message, note ? { description: note } : undefined);
  },
  fail(message: string): void {
    toast.error(message, { duration: 8000 });
  },
  /** A success the operator can take back for a few seconds. */
  undo(message: string, opts: { label?: string; onUndo: () => void; durationMs?: number }): void {
    toast.success(message, {
      duration: opts.durationMs ?? 10000,
      action: { label: opts.label ?? "Undo", onClick: opts.onUndo },
    });
  },
};
