"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Keeps an unsaved builder's work as a draft in this browser, so leaving the
 * page -- a link, a reload, a closed tab -- doesn't lose a half-built workout.
 *
 * On mount, a draft that differs from what the page loaded is put back and
 * `restoredAt` says when it was from. After that every change is written,
 * debounced; a value back at the loaded state removes the draft. The builder
 * calls `clear()` once a real save succeeds.
 *
 * `normalise` (optional) brings a stored draft up to the current shape before
 * it is compared and applied, so a draft saved before a field existed (e.g.
 * a day's `week`) is not mistaken for a real change.
 *
 * Browser storage can be missing or throw (private windows, blocked site
 * data); every access is guarded and the builder simply works without it.
 */
export function useDraft<T>(key: string | null, value: T, apply: (v: T) => void, normalise?: (v: T) => T) {
  const initial = useRef(JSON.stringify(value));
  const ready = useRef(false);
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!key) return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const draft = JSON.parse(raw) as { at: number; value: T };
        const stored = draft && normalise ? normalise(draft.value) : draft?.value;
        if (draft && JSON.stringify(stored) !== initial.current) {
          apply(stored as T);
          setRestoredAt(draft.at);
        }
      }
    } catch {
      /* no storage: carry on without drafts */
    }
    ready.current = true;
    // Mount only: a draft is restored once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const serialised = JSON.stringify(value);
  useEffect(() => {
    if (!key || !ready.current) return;
    const t = window.setTimeout(() => {
      try {
        if (serialised === initial.current) {
          window.localStorage.removeItem(key);
          setSavedAt(null);
        } else {
          const at = Date.now();
          window.localStorage.setItem(key, JSON.stringify({ at, value: JSON.parse(serialised) }));
          setSavedAt(at);
        }
      } catch {
        /* storage full or blocked: the builder still works */
      }
    }, 500);
    return () => window.clearTimeout(t);
  }, [key, serialised]);

  const clear = useCallback(() => {
    if (!key) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    initial.current = serialised;
    setRestoredAt(null);
    setSavedAt(null);
  }, [key, serialised]);

  const discard = useCallback(() => {
    apply(JSON.parse(initial.current) as T);
    if (!key) return;
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    setRestoredAt(null);
    setSavedAt(null);
  }, [key, apply]);

  return { restoredAt, savedAt, clear, discard };
}
