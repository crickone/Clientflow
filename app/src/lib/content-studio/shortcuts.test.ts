// Run: npm test -- src/lib/content-studio/shortcuts.test.ts
//
// The designer had no keyboard shortcuts at all. These pin the conventions
// operators bring from every other editor (Jakob's law): Cmd/Ctrl+Z undoes,
// arrows move between slides, Cmd/Ctrl+Enter submits a dialog — and none of
// the navigation ones fire while you are typing in a field.
import assert from "node:assert/strict";

import { isMacPlatform, resolveShortcut, shortcutLabel, type KeyLike } from "./shortcuts";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const base: KeyLike = { key: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, target: null };
const input = { tagName: "INPUT", isContentEditable: false };
const textarea = { tagName: "TEXTAREA", isContentEditable: false };
const editable = { tagName: "DIV", isContentEditable: true };

check("Cmd+Z is undo", resolveShortcut({ ...base, key: "z", metaKey: true }) === "undo");
check("Ctrl+Z is undo too (Windows/Linux)", resolveShortcut({ ...base, key: "z", ctrlKey: true }) === "undo");
check("uppercase Z with shift is NOT undo (that is redo, which we do not offer)", resolveShortcut({ ...base, key: "Z", metaKey: true, shiftKey: true }) === null);
check("plain z is nothing", resolveShortcut({ ...base, key: "z" }) === null);

check("right arrow is next slide", resolveShortcut({ ...base, key: "ArrowRight" }) === "nextSlide");
check("left arrow is previous slide", resolveShortcut({ ...base, key: "ArrowLeft" }) === "prevSlide");
check("arrows with a modifier are left to the browser", resolveShortcut({ ...base, key: "ArrowRight", metaKey: true }) === null);

check("Cmd+Enter is submit", resolveShortcut({ ...base, key: "Enter", metaKey: true }) === "submit");
check("Ctrl+Enter is submit", resolveShortcut({ ...base, key: "Enter", ctrlKey: true }) === "submit");
check("plain Enter is not a designer shortcut", resolveShortcut({ ...base, key: "Enter" }) === null);

// Typing must never be hijacked.
check("undo inside an input is the browser's text undo, not ours", resolveShortcut({ ...base, key: "z", metaKey: true, target: input }) === null);
check("arrows inside a textarea move the caret, not the slide", resolveShortcut({ ...base, key: "ArrowRight", target: textarea }) === null);
check("arrows inside contenteditable are left alone", resolveShortcut({ ...base, key: "ArrowLeft", target: editable }) === null);
check("but Cmd+Enter DOES submit from inside a field — that is where you are when you want it", resolveShortcut({ ...base, key: "Enter", metaKey: true, target: textarea }) === "submit");

check("mac label uses the command glyph", shortcutLabel("Z", { platform: "mac" }) === "⌘Z");
check("other platforms spell it out", shortcutLabel("Z", { platform: "other" }) === "Ctrl+Z");
check("shift is shown", shortcutLabel("Z", { platform: "mac", shift: true }) === "⇧⌘Z");
check("Enter is named, not a glyph", shortcutLabel("Enter", { platform: "other" }) === "Ctrl+Enter");

check("mac detected from platform", isMacPlatform({ platform: "MacIntel" }) === true);
check("mac detected from user agent when platform is empty", isMacPlatform({ platform: "", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" }) === true);
check("windows is not mac", isMacPlatform({ platform: "Win32" }) === false);
check("no navigator at all is not mac", isMacPlatform(undefined) === false);

console.log(`\nshortcuts: ${passed} checks passed`);
