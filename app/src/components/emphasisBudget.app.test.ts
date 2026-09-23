// Run: npm test -- src/components/emphasisBudget.app.test.ts
//
// The emphasis budget, for EVERY component in the app rather than the three
// screens of the Content Studio designer it started on.
//
// The rule: a component may spend at most 3 primary-weight buttons and 1
// destructive one. Primary-weight includes a <Button> with no variant prop,
// because Button defaults to primary — emphasis is mostly what you get by not
// deciding, which is exactly what a static check is good at catching.
//
// WHAT THIS CANNOT SEE. A file's count is not what is on screen at once. Five
// primaries across five mutually exclusive branches — a wizard's steps, a
// dialog that replaces a panel — is correct, and only a human reading the
// component can say so. That is what EXEMPT is: a human's judgement, with the
// reason written next to it. An entry with "not yet reviewed" is an admission,
// not an approval.
//
// The value is not today's tally, which is already close to clean. It is that
// a NEW page growing a second and third shouting button now fails a test
// instead of quietly landing.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { countEmphasis } from "@/lib/ui/emphasis";

const BUDGET = { primary: 3, destructive: 1 };

/**
 * Components a human has read and judged, or has not yet. Keyed by path from
 * `src/`, valued by the reason — which is the point of the list.
 */
const EXEMPT: Record<string, string> = {
  // Reviewed 2026-09-14, the designer's own budget lives in
  // content-studio/emphasisBudget.test.ts and is tighter than this one.
  "components/content-studio/ImageDesigner.tsx":
    "has its own stricter budget test next to it",

  // Flagged 2026-09-23 by the first app-wide run. Each is a long component
  // whose primaries sit hundreds of lines apart, which STRONGLY suggests
  // separate sections and dialogs rather than one loud screen — but none has
  // been read end to end, so none is approved. Read one, and either delete its
  // line here or demote a button.
  "components/setup/SetupChecklist.tsx": "not yet reviewed — 5 primary, lines 95–363",
  "components/leads/LeadDetail.tsx": "not yet reviewed — 4 primary, lines 348–493",
  "components/settings/UsersManager.tsx": "not yet reviewed — 4 primary + 1 destructive, lines 172–712",
  "components/timetable/TimetableView.tsx": "not yet reviewed — 4 primary, lines 247–1109",
};

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith(".tsx") && !p.includes(".test.")) out.push(p);
  }
  return out;
}

const root = join(process.cwd(), "src");
const files = tsxFiles(root);

let checked = 0;
const over: string[] = [];

for (const file of files) {
  const rel = file.slice(root.length + 1).split("\\").join("/");
  const src = readFileSync(file, "utf8");
  if (!src.includes("<Button")) continue;

  const { primary, destructive } = countEmphasis(src);
  if (EXEMPT[rel]) continue;
  checked++;

  if (primary > BUDGET.primary) {
    over.push(`${rel}: ${primary} primary-weight buttons (budget ${BUDGET.primary})`);
  }
  if (destructive > BUDGET.destructive) {
    over.push(`${rel}: ${destructive} destructive buttons (budget ${BUDGET.destructive})`);
  }
}

assert.equal(
  over.length,
  0,
  `Emphasis budget exceeded. Demote a button to variant="secondary" / "outline" / "ghost", or — if these ` +
    `cannot appear together — add the file to EXEMPT in this test with the reason:\n  ${over.join("\n  ")}`,
);

// A guard that silently checks nothing is worse than no guard: if a refactor
// moves every Button behind a wrapper, this catches it.
assert.ok(checked > 80, `Expected to check 80+ components, checked ${checked} — has <Button> been renamed or wrapped?`);

// Every exemption must carry a reason. An empty string is how a list like this
// rots into a blanket opt-out.
for (const [path, reason] of Object.entries(EXEMPT)) {
  assert.ok(reason.trim().length > 10, `EXEMPT["${path}"] needs a real reason, not "${reason}"`);
}

console.log(`emphasisBudget.app: ${checked} components within budget, ${Object.keys(EXEMPT).length} exempt (with reasons).`);
