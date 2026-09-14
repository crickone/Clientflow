/**
 * The designer's keyboard, as a pure keymap.
 *
 * Operators arrive with conventions from every other editor they use --
 * Cmd/Ctrl+Z undoes, arrows step between items, Cmd/Ctrl+Enter submits a
 * dialog -- and the designer honoured none of them (Jakob's law: people spend
 * most of their time in OTHER tools). This module decides what a key means;
 * the component decides what to do about it.
 *
 * Pure and dependency-free so it runs under the plain test runner. The event
 * is described by a small shape rather than a DOM KeyboardEvent for the same
 * reason.
 */

export type DesignerAction = "undo" | "prevSlide" | "nextSlide" | "submit";

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** What the event landed on — an editable target suppresses navigation and undo. */
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

function isTyping(target: KeyLike["target"]): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  return EDITABLE_TAGS.has((target.tagName ?? "").toUpperCase());
}

/** Cmd on a Mac, Ctrl elsewhere — either counts as "the command key". */
function commandHeld(e: KeyLike): boolean {
  return e.metaKey || e.ctrlKey;
}

/**
 * The action a key press means in the designer, or null when it means nothing
 * to us and the browser should have it.
 *
 * Undo and the arrows are suppressed while typing: Cmd+Z in a field is the
 * browser's own text undo, and arrows move the caret. Cmd+Enter is the one
 * shortcut that works FROM a field, because a field is where you are when you
 * want to submit what you typed.
 */
export function resolveShortcut(e: KeyLike): DesignerAction | null {
  if (e.altKey) return null;

  if (e.key === "Enter" && commandHeld(e) && !e.shiftKey) return "submit";

  if (isTyping(e.target)) return null;

  if (e.key === "z" && commandHeld(e) && !e.shiftKey) return "undo";

  if (!commandHeld(e) && !e.shiftKey) {
    if (e.key === "ArrowRight") return "nextSlide";
    if (e.key === "ArrowLeft") return "prevSlide";
  }

  return null;
}

/**
 * Whether we are on a Mac, from a navigator-like object. `platform` is the
 * reliable signal where it is still populated; the user agent covers the
 * browsers that have emptied it.
 */
export function isMacPlatform(nav?: { platform?: string; userAgent?: string }): boolean {
  if (!nav) return false;
  if (/mac/i.test(nav.platform ?? "")) return true;
  return /Macintosh|Mac OS X/i.test(nav.userAgent ?? "");
}

/**
 * A shortcut as it should be printed in a title or hint: "⌘Z" on a Mac,
 * "Ctrl+Z" elsewhere. The glyphs are keyboard symbols, the same ones macOS
 * prints in its own menus.
 */
export function shortcutLabel(
  key: string,
  opts: { platform?: "mac" | "other"; shift?: boolean } = {},
): string {
  const mac = opts.platform === "mac";
  if (mac) return `${opts.shift ? "⇧" : ""}⌘${key}`;
  return `${"Ctrl+"}${opts.shift ? "Shift+" : ""}${key}`;
}
