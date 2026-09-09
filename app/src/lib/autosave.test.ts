// Run: npm test -- src/lib/autosave.test.ts
//
// The pure half of the settings autosave. No React, no DOM, no I/O — the hook
// owns the timers, this owns "did it change?" and "what does the pill say?".
import assert from "node:assert/strict";

import {
  AUTOSAVE_DEBOUNCE_MS,
  describeAutosave,
  formatSavedAt,
  hasChanged,
  stableSnapshot,
} from "./autosave";

let passed = 0;
function check(name: string, cond: boolean) {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
}

const clean = { dirty: false, saving: false, error: null, savedAt: null };

(async () => {
  // ── stableSnapshot ───────────────────────────────────────────────────
  check(
    "stableSnapshot: key order does not matter",
    stableSnapshot({ a: 1, b: 2 }) === stableSnapshot({ b: 2, a: 1 }),
  );

  check(
    "stableSnapshot: nested key order does not matter either",
    stableSnapshot({ o: { x: 1, y: 2 } }) === stableSnapshot({ o: { y: 2, x: 1 } }),
  );

  check(
    "stableSnapshot: array ORDER is data and must not be sorted away",
    stableSnapshot([1, 2, 3]) !== stableSnapshot([3, 2, 1]),
  );

  check(
    "stableSnapshot: undefined and null compare equal (an optional gone missing)",
    stableSnapshot({ open: undefined }) === stableSnapshot({ open: null }),
  );

  check(
    "stableSnapshot: a real value change is visible",
    stableSnapshot({ buffer: 0 }) !== stableSnapshot({ buffer: 15 }),
  );

  check(
    "stableSnapshot: 15 and \"15\" are different (a select's string vs a number)",
    stableSnapshot({ n: 15 }) !== stableSnapshot({ n: "15" }),
  );

  check("stableSnapshot: bare undefined -> null, never a crash", stableSnapshot(undefined) === "null");

  // The opening-hours shape this actually guards, straight from ScheduleForm.
  const hours = [
    { dow: 0, closed: true, open: "08:00", close: "20:00" },
    { dow: 1, closed: false, open: "09:00", close: "19:00" },
  ];
  const reordered = [
    { closed: true, dow: 0, close: "20:00", open: "08:00" },
    { close: "19:00", open: "09:00", closed: false, dow: 1 },
  ];
  check(
    "stableSnapshot: re-created opening-hours rows do not read as an edit",
    stableSnapshot(hours) === stableSnapshot(reordered),
  );

  // ── hasChanged ───────────────────────────────────────────────────────
  const saved = stableSnapshot({ buffer: 0 });
  check("hasChanged: same values -> false", hasChanged(saved, { buffer: 0 }) === false);
  check("hasChanged: different values -> true", hasChanged(saved, { buffer: 10 }) === true);

  // ── describeAutosave ─────────────────────────────────────────────────
  check(
    "describeAutosave: nothing has happened yet -> idle",
    describeAutosave(clean).kind === "idle",
  );

  check(
    "describeAutosave: pending edits -> dirty",
    describeAutosave({ ...clean, dirty: true }).kind === "dirty",
  );

  check(
    "describeAutosave: in flight -> saving",
    describeAutosave({ ...clean, dirty: true, saving: true }).kind === "saving",
  );

  check(
    "describeAutosave: a blocked form explains itself instead of saying \"Unsaved changes\"",
    describeAutosave({ ...clean, dirty: true, blocked: "Needs a valid email address" }).text ===
      "Needs a valid email address",
  );
  check(
    "describeAutosave: blocked is still the dirty state, not an error",
    describeAutosave({ ...clean, dirty: true, blocked: "Needs a valid email address" }).kind === "dirty",
  );
  check(
    "describeAutosave: blocked on a clean form is ignored (nothing to save)",
    describeAutosave({ ...clean, blocked: "Needs a valid email address" }).kind === "idle",
  );

  const at = new Date(2026, 8, 9, 19, 41).getTime();
  const savedStatus = describeAutosave({ ...clean, savedAt: at });
  check("describeAutosave: settled -> saved", savedStatus.kind === "saved");
  check("describeAutosave: the saved pill carries the clock time", savedStatus.text === "Saved 19:41");

  // An error must outrank every other state — it is the only one the operator
  // has to act on, and it must not be hidden by a later successful-looking
  // "Saved 19:41" left over from before the failure.
  check(
    "describeAutosave: an error outranks a previous successful save",
    describeAutosave({ dirty: true, saving: false, error: "Save failed.", savedAt: at }).kind === "error",
  );
  check(
    "describeAutosave: the error message is what gets shown",
    describeAutosave({ ...clean, error: "Not an admin." }).text === "Not an admin.",
  );

  // ── formatSavedAt ────────────────────────────────────────────────────
  check(
    "formatSavedAt: pads single digits to HH:MM",
    formatSavedAt(new Date(2026, 8, 9, 9, 5).getTime()) === "09:05",
  );
  check(
    "formatSavedAt: midnight is 00:00, not 24:00",
    formatSavedAt(new Date(2026, 8, 9, 0, 0).getTime()) === "00:00",
  );

  check("the debounce window is a sane typing pause", AUTOSAVE_DEBOUNCE_MS >= 300 && AUTOSAVE_DEBOUNCE_MS <= 2000);

  console.log(`\n${passed} checks passed.`);
})();
