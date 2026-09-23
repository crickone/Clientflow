// Run: npm test -- src/components/dohertyFeedback.test.ts
//
// Doherty, made checkable: the control that STARTED a wait has to say it is
// working, not merely stop responding.
//
// The Doherty threshold is 400ms — past that, a person needs to be told
// something is happening or they assume the click missed. A button that only
// goes `disabled` does tell you the click landed, but it cannot say why it is
// dead: busy, or invalid, or broken. `<Button loading>` disables AND shows a
// spinner, so it answers the question the disable raises.
//
// THE RULE, and its deliberate limit: this only applies to the button that
// started the work — one that submits, or that carries primary weight. A
// Cancel or Back button disabled while a save runs is correct as a plain
// disable; putting a spinner on it would claim it is doing something. 18
// buttons in the app are exactly that case and are intentionally untouched.
//
// Scope: components that actually await something (`await fetch(` or
// `startTransition(`). A button that opens a dialog has nothing to report.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { buttonTags, isPrimaryWeight } from "@/lib/ui/emphasis";

/** Variables that name a wait. A bare `disabled={busy}` on an action button is the smell. */
const PENDING =
  /^(busy|pending|saving|loading|submitting|isPending|isSaving|isLoading|working|sending|generating|deleting|creating|running)$/i;

/** Components a human has judged. Reason required — see emphasisBudget.app.test.ts. */
const EXEMPT: Record<string, string> = {
  // Read 2026-09-23. Its generate button reports progress by other means: the
  // LABEL switches to "Generating…" and an elapsed-seconds line renders beside
  // it (progressLabel.ts). This is the component the Doherty work was done on
  // in the first place — a spinner on top would be a third thing saying the
  // same thing.
  "components/content-studio/ImageDesigner.tsx":
    "reports progress via a changing label + elapsed-seconds line, not a spinner",
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
let checked = 0;
let actionButtons = 0;
const silent: string[] = [];

for (const file of tsxFiles(root)) {
  const rel = file.slice(root.length + 1).split("\\").join("/");
  if (EXEMPT[rel]) continue;
  const src = readFileSync(file, "utf8");
  if (!/await fetch\(|startTransition\(/.test(src)) continue;
  if (!src.includes("<Button")) continue;
  checked++;

  for (const attrs of buttonTags(src)) {
    const isSubmit = /type\s*=\s*"submit"/.test(attrs);
    if (!isSubmit && !isPrimaryWeight(attrs)) continue; // a secondary may just go dead
    actionButtons++;

    if (/loading=\{/.test(attrs)) continue; // says it is working — correct
    const disabled = attrs.match(/disabled=\{([^}]*)\}/);
    if (!disabled) continue; // no pending disable at all; nothing to judge here
    // `disabled={busy || rendering}` is just as quiet as `disabled={busy}` —
    // every operand names a wait, so the whole expression does. A mixed
    // expression like `busy || !name` is NOT caught: splitting it into
    // loading={busy} disabled={!name} is a judgement about which half means
    // what, and a test should not guess at that.
    const operands = disabled[1]!.split("||").map((o) => o.trim());
    if (operands.length > 0 && operands.every((o) => PENDING.test(o))) {
      silent.push(`${rel}: <Button … disabled={${disabled[1]!.trim()}}> — use loading={${disabled[1]!.trim()}} instead`);
    }
  }
}

assert.equal(
  silent.length,
  0,
  `An action button goes quiet instead of saying it is working. <Button loading={…}> disables AND ` +
    `shows a spinner, so it answers "is this stuck or busy?":\n  ${silent.join("\n  ")}`,
);

// The guard must not be able to check nothing: if <Button> is renamed or the
// await patterns change, this fails rather than passing vacuously.
assert.ok(checked > 25, `Expected 25+ awaiting components, saw ${checked} — did the await patterns change?`);
assert.ok(actionButtons > 30, `Expected 30+ action buttons, saw ${actionButtons} — did <Button> get wrapped?`);

console.log(`dohertyFeedback: ${actionButtons} action buttons across ${checked} awaiting components all report progress.`);
