"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AUTOSAVE_DEBOUNCE_MS,
  type AutosaveState,
  type AutosaveStatus,
  describeAutosave,
  stableSnapshot,
} from "@/lib/autosave";

interface Options<T> {
  /** The current form state. Must be JSON-shaped — it is snapshotted, not deep-compared by identity. */
  values: T;
  /** Persists `values`. Throw to signal failure; the message is shown in the pill. */
  save: (values: T) => Promise<void>;
  /**
   * Off for a form that is not yet valid to save — a half-typed email address
   * the server would reject, say. While false, edits still mark the form dirty
   * but nothing is sent. Defaults to true.
   */
  enabled?: boolean;
  /** Shown in place of "Unsaved changes" while `enabled` is false. */
  blockedReason?: string;
  debounceMs?: number;
}

export interface Autosave {
  status: AutosaveStatus;
  /** True while anything is unsaved — for disabling a "Done" button, etc. */
  dirty: boolean;
  /** Save immediately, skipping the debounce (a Retry button, or on blur). */
  saveNow: () => void;
}

/**
 * Debounced autosave for the settings forms.
 *
 * The rules that matter, each of which is a bug if it goes:
 *
 * - **Never saves on mount.** The initial snapshot is seeded as already-saved,
 *   so simply opening a settings page writes nothing.
 * - **One save at a time.** Server actions here are not idempotent-by-key; two
 *   in flight can land out of order and persist the older values. A second
 *   save waits, and re-fires afterwards only if the values moved on.
 * - **The snapshot is taken when the save STARTS, and committed only on
 *   success.** Edits made mid-flight therefore stay dirty and get their own
 *   save, rather than being silently marked saved by the earlier one.
 * - **A failure does not retry itself.** It parks in the error state with the
 *   message; a further edit or an explicit Retry starts a fresh attempt. An
 *   auto-retry loop against a failing server action would hammer it.
 * - **Pending edits are flushed on unmount** (moving between settings pages)
 *   and warned about on tab close.
 */
export function useAutosave<T>({
  values,
  save,
  enabled = true,
  blockedReason,
  debounceMs = AUTOSAVE_DEBOUNCE_MS,
}: Options<T>): Autosave {
  const snapshot = stableSnapshot(values);

  // Refs, not state: the flush closure runs from a timer and from unmount
  // cleanup, long after the render that scheduled it. Reading `values` from a
  // captured prop there would save whatever was on screen a second ago.
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const saveRef = useRef(save);
  saveRef.current = save;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  // Seeded with the mount snapshot, which is by definition what the server
  // already has. This is what makes "no save on mount" true.
  const savedRef = useRef(snapshot);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  const [state, setState] = useState<Omit<AutosaveState, "dirty">>({
    saving: false,
    error: null,
    savedAt: null,
  });

  const dirty = snapshot !== savedRef.current;

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!enabledRef.current || inFlightRef.current) return;

    const pending = stableSnapshot(valuesRef.current);
    if (pending === savedRef.current) return;

    inFlightRef.current = true;
    setState((s) => ({ ...s, saving: true, error: null }));
    try {
      await saveRef.current(valuesRef.current);
      // Commit the snapshot taken at the START of the save. Anything typed
      // while it was in flight stays dirty and earns its own save below.
      savedRef.current = pending;
      setState({ saving: false, error: null, savedAt: Date.now() });
      inFlightRef.current = false;
      if (stableSnapshot(valuesRef.current) !== savedRef.current) void flush();
    } catch (err) {
      inFlightRef.current = false;
      setState((s) => ({
        ...s,
        saving: false,
        error: err instanceof Error ? err.message : "Save failed.",
      }));
    }
  }, []);

  // Schedule a save whenever the snapshot moves away from what is persisted.
  useEffect(() => {
    if (!enabled || snapshot === savedRef.current) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void flush(), debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [snapshot, enabled, debounceMs, flush]);

  // Leaving the page with edits still inside the debounce window would lose
  // them silently, which is the one way autosave is worse than a Save button.
  useEffect(() => {
    return () => {
      if (stableSnapshot(valuesRef.current) !== savedRef.current) void flush();
    };
  }, [flush]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const saveNow = useCallback(() => void flush(), [flush]);

  return {
    status: describeAutosave({
      ...state,
      dirty,
      blocked: enabled ? null : blockedReason,
    }),
    dirty,
    saveNow,
  };
}
