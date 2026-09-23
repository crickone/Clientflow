/**
 * The app-wide keymap. Pure: no DOM, no imports, so it loads under the
 * plain-tsx runner and can be tested without a browser.
 *
 * Jakob's law is the whole design brief here — people spend their day in other
 * tools, so these are the bindings those tools already taught them. Nothing
 * invented: Cmd/Ctrl+K opens the command palette (Linear, Notion, Slack,
 * GitHub), Esc closes, Cmd/Ctrl+Enter submits, `?` lists the shortcuts, `/`
 * jumps to search. An operator should never have to learn this page.
 *
 * The designer has its own keymap (@/lib/content-studio/shortcuts) for
 * undo and slide navigation, which are local to that screen. This one is for
 * bindings that mean the same thing everywhere.
 */

export type AppAction = "palette" | "help" | "submit" | "close" | "search";

/** The shape this needs off a KeyboardEvent — so a test can pass a literal. */
export interface KeyLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

/**
 * True while the user is typing. A shortcut that steals a keystroke mid-word
 * is worse than no shortcut, so every binding below except the modifier ones
 * is suppressed here.
 */
export function isTyping(target: KeyLike["target"]): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = (target.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

const commandHeld = (e: KeyLike) => Boolean(e.metaKey || e.ctrlKey);

/**
 * The action this keystroke means, or null.
 *
 * `typing` is passed in rather than read off the event so a caller can force
 * it — the palette's own input is a text field, and inside it Esc must still
 * close and the arrows must still move.
 */
export function resolveAppShortcut(e: KeyLike): AppAction | null {
  const typing = isTyping(e.target);

  // Modifier bindings work while typing: the point of Cmd+Enter is to submit
  // the field you are in, and the point of Cmd+K is to escape wherever you are.
  if (commandHeld(e) && !e.altKey) {
    const k = e.key.toLowerCase();
    if (k === "k") return "palette";
    if (e.key === "Enter") return "submit";
  }

  // Esc always means close — it is the one key with no other job.
  if (e.key === "Escape") return "close";

  if (typing) return null;

  // Bare keys, only when the user is not writing something.
  if (e.key === "?") return "help";
  if (e.key === "/") return "search";
  return null;
}

/** What the `?` sheet lists. Order is the order it renders. */
export const SHORTCUTS: { keys: string; does: string }[] = [
  { keys: "⌘K", does: "Open the command palette" },
  { keys: "/", does: "Jump to search on this page" },
  { keys: "⌘↵", does: "Submit the form you are in" },
  { keys: "Esc", does: "Close a dialog, panel or the palette" },
  { keys: "?", does: "Show this list" },
];
