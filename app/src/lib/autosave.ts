/**
 * Pure helpers behind the settings autosave (see
 * `components/settings/useAutosave.ts` for the React side, and
 * `components/settings/SaveStatus.tsx` for what the operator actually sees).
 *
 * Everything here is deliberately free of React and of I/O so it can be tested
 * with plain literals under the node runner — same shape as
 * `lib/research/debounce.ts`. The hook holds the timers and the in-flight
 * guard; this module answers only two questions: "have the values actually
 * changed?" and "what should the status pill say right now?".
 */

/**
 * How long to wait after the last keystroke before saving. Long enough that
 * typing a four-digit time or a sentence of brief copy is one save rather than
 * a dozen, short enough that it still feels immediate when you tab away.
 */
export const AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * Recursively sorts object keys so two structurally-equal values always
 * stringify identically. Without this, a state update that rebuilds an object
 * in a different key order would read as a change and trigger a pointless
 * save — and, worse, a save loop, because the new snapshot would never match
 * the stored one.
 *
 * Arrays keep their order (in opening hours and pipeline stages, order IS the
 * data). `undefined` normalises to null so an optional field that goes missing
 * compares equal to one explicitly cleared.
 */
function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = normalise(src[key]);
    return out;
  }
  return value === undefined ? null : value;
}

/** A stable, comparable string for any JSON-shaped form state. */
export function stableSnapshot(value: unknown): string {
  return JSON.stringify(normalise(value));
}

/** True when `next` differs from the last snapshot known to be persisted. */
export function hasChanged(saved: string, next: unknown): boolean {
  return saved !== stableSnapshot(next);
}

export interface AutosaveState {
  /** Edits exist that are not yet persisted. */
  dirty: boolean;
  /** A save is in flight right now. */
  saving: boolean;
  /** The last save failed; the message to show. Cleared by the next attempt. */
  error: string | null;
  /** Epoch ms of the last successful save, or null if none this session. */
  savedAt: number | null;
  /**
   * Set when the form is deliberately not saving yet — a half-typed email
   * address the server would reject, say. The text replaces the plain
   * "Unsaved changes", so the operator is told WHY nothing is being kept
   * rather than watching a validation error flash on every keystroke.
   */
  blocked?: string | null;
}

/**
 * "blocked" is split out from "dirty" because the UI treats them completely
 * differently: ordinary unsaved changes are silent (the save is coming), while
 * a form that CANNOT save has to say so or the operator walks away from work
 * that was never kept. See SaveStatus, which renders nothing for the quiet
 * states.
 */
export type AutosaveStatusKind = "idle" | "dirty" | "saving" | "saved" | "error" | "blocked";

export interface AutosaveStatus {
  kind: AutosaveStatusKind;
  text: string;
}

/** Local-time "HH:MM", so the pill reads like the clock in the sidebar. */
export function formatSavedAt(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * The single source of truth for what the status pill says, so the wording
 * cannot drift between the eight-odd settings forms that show it.
 *
 * Order matters: an error outranks everything (it is the one state the
 * operator must act on), then an in-flight save, then pending edits. Only once
 * all three are clear does the pill report the last successful save.
 */
export function describeAutosave(state: AutosaveState): AutosaveStatus {
  if (state.error) return { kind: "error", text: state.error };
  if (state.saving) return { kind: "saving", text: "Saving…" };
  if (state.dirty && state.blocked) return { kind: "blocked", text: state.blocked };
  if (state.dirty) return { kind: "dirty", text: "Unsaved changes" };
  if (state.savedAt !== null) {
    return { kind: "saved", text: `Saved ${formatSavedAt(state.savedAt)}` };
  }
  return { kind: "idle", text: "Up to date" };
}
