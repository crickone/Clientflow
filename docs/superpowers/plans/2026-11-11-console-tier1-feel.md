# Console Tier 1: Feel. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The platform console stops making the operator wait and stops using browser alerts: every navigation shows a skeleton at once, every action confirms with a toast, destructive actions open a real dialog, two of them can be undone, and the fleet lists come back from a short cache. The main app starts recording health snapshots, job runs and platform alerts so Tier 3 has history.

**Architecture:** The console (`admin/`, Next 15 App Router, React 19) is a thin client over the main app's `/api/platform/*` routes. Tier 1 adds a toast layer (sonner), a native-`<dialog>` confirm provider, route-level `loading.tsx` / `error.tsx` / `not-found.tsx`, a `revalidate` option on the console's `api()` helper with tag-based busting from every server action, and a keyboard-shortcut listener in the shell. In the main app (`app/`) it adds three control-plane tables and two small libraries (`jobRuns.ts`, `healthHistory.ts`) plus an hourly scheduler that fills them.

**Tech Stack:** Next 15.5 App Router, React 19, TypeScript, sonner 2, better-sqlite3 (control DB in `app/`), plain `node:assert` test scripts run by `scripts/test.mjs` with `tsx`.

## Global Constraints

- No emojis in code, copy, commits or docs. Icons come from `lucide-react`.
- Copy is sentence case and plain: short factual sentences, no filler.
- Controls keep the padding rule: selects 36px right padding with the chevron 12px in; buttons at least 12px horizontal padding on small, 16px on default.
- The console reads nothing from any database. All data comes through `admin/src/lib/api.ts`.
- Every console write is audited in the main app with `recordAudit` (already true for every existing route; new routes must do the same).
- Commit after every task. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Before deploying `admin/`: `npx tsc --noEmit -p .`, `npm test`, `npx next build` all pass. Before deploying `app/`: `npx tsc --noEmit -p .`, `npm test`, `rm -rf .next && npx next build` all pass.
- Deploy `admin/` with `cd admin && railway up --detach`; deploy `app/` with `cd app && railway up --detach`.

---

## File structure

**admin/ (console)**

| File | Responsibility |
|---|---|
| `scripts/test.mjs` (create) | Runs every `src/**/*.test.ts` with `tsx`, same runner as `app/scripts/test.mjs`. |
| `scripts/screens.mjs` (create) | Playwright screenshots of every console page for visual checks. |
| `src/lib/format.test.ts` (create) | First test; proves the runner. |
| `src/lib/toast.ts` (create) | `notify.ok / notify.fail / notify.undo` over sonner. One import for every panel. |
| `src/components/ui/Toaster.tsx` (create) | The sonner `<Toaster>` with the console's theme. |
| `src/components/ui/ConfirmDialog.tsx` (create) | `ConfirmProvider` + `useConfirm()`: a native `<dialog>` with title, body, optional text prompt, optional type-to-confirm, danger styling. |
| `src/lib/shortcuts.ts` (create) | Pure chord resolver (`g b` etc.). |
| `src/lib/shortcuts.test.ts` (create) | Tests for it. |
| `src/components/Shortcuts.tsx` (create) | Keydown listener + the `?` help dialog. Mounted in `Shell`. |
| `src/lib/revalidate.ts` (create) | `bust(tenantId?)`: `revalidateTag("fleet")` and `revalidateTag("tenant-<id>")`. |
| `src/app/(console)/loading.tsx` (create) | Page skeleton for every console route. |
| `src/app/(console)/gyms/[id]/loading.tsx` (create) | Tab-content skeleton under the business header. |
| `src/app/(console)/error.tsx` (create) | Readable error with Retry. |
| `src/app/(console)/not-found.tsx` (create) | "No such page" with a link back. |
| `src/app/layout.tsx` (modify) | Mounts `<Toaster>`. |
| `src/app/(console)/layout.tsx` (modify) | Wraps `Shell` in `ConfirmProvider`. |
| `src/components/Shell.tsx` (modify) | Mounts `<Shortcuts>`. |
| `src/lib/api.ts` (modify) | `revalidate` / `tags` options. |
| `src/app/globals.css` (modify) | Toast, dialog, skeleton, shortcut-help styles. |
| `src/components/ConfirmButton.tsx` (modify) | Uses the dialog; gets `done` and `undo` props. |
| `src/components/OpenBusinessButton.tsx` (modify) | Reason comes from the dialog prompt. |
| `src/components/GrantCreditsForm.tsx` (modify) | Confirms through the dialog. |
| `src/components/fleet/KillSwitches.tsx` (modify) | Dialog + toast. |
| `src/components/people/PeopleTable.tsx` (modify) | Dialog + toast + undo on revoke. |
| `src/components/health/HealthPanel.tsx` (modify) | Toast. |
| `src/components/data/DataPanel.tsx` (modify) | Dialog + toast. |
| `src/components/integrations/IntegrationsBoard.tsx` (modify) | Dialog + toast. |
| `src/components/money/MoneyAdjustments.tsx` (modify) | Dialog prompt + toast. |
| `src/app/(console)/page.tsx`, `gyms/page.tsx`, `health/page.tsx`, `gyms/[id]/layout.tsx` (modify) | Cached reads. |
| `src/app/(console)/**/actions.ts` (modify) | Call `bust()` after every write. |
| `src/app/(console)/gyms/[id]/money/page.tsx` (modify) | `undo` on the four suspend buttons. |

**app/ (platform API)**

| File | Responsibility |
|---|---|
| `src/lib/db/control.ts` (modify) | Three new tables. |
| `src/lib/platform/jobRuns.ts` (create) | `recordJobRun`, `listJobRuns`, `latestJobRuns`. |
| `src/lib/platform/jobRuns.test.ts` (create) | |
| `src/lib/platform/health.ts` (modify) | `HealthAlert` gains a stable `key`. |
| `src/lib/platform/healthHistory.ts` (create) | `snapshotFleetHealth`, `syncPlatformAlerts`. |
| `src/lib/platform/healthHistory.test.ts` (create) | |
| `src/lib/platform/healthScheduler.ts` (create) | Hourly snapshot, boot catch-up. |
| `src/app/layout.tsx` (modify) | Side-effect import of the scheduler. |
| `src/lib/automations/scheduler.ts`, `src/lib/pipeline/lapseScheduler.ts`, `src/lib/backup/scheduler.ts` (modify) | Existing jobs wrapped in `recordJobRun`. |

---

### Task 1: A test runner for the console

**Files:**
- Create: `admin/scripts/test.mjs`
- Create: `admin/src/lib/format.test.ts`
- Modify: `admin/package.json`

**Interfaces:**
- Produces: `npm test` and `npm test -- src/path/file.test.ts` in `admin/`, exit code 1 on any failure.

- [ ] **Step 1: Write the failing test**

`admin/src/lib/format.test.ts`:

```ts
// Run: npm test -- src/lib/format.test.ts
import assert from "node:assert/strict";

import { bytes, fmtCents } from "./format";

assert.equal(bytes(0), "0 B");
assert.equal(bytes(512), "512 B");
assert.equal(bytes(1536), "1.5 KB");
assert.equal(bytes(3.4 * 1024 * 1024), "3.4 MB");
assert.equal(fmtCents(12345), "€123.45");
assert.equal(fmtCents(5), "€0.05");
console.log("format.test.ts: ok");
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd admin && npm test`
Expected: `npm error Missing script: "test"`.

- [ ] **Step 3: Add the runner and the script**

`admin/scripts/test.mjs` (same runner as `app/scripts/test.mjs`):

```js
#!/usr/bin/env node
/**
 * Minimal test runner: finds every `*.test.ts` under src/ and runs it with tsx.
 * Tests are plain assertion scripts (node:assert/strict) that exit non-zero on
 * failure. No framework.
 *
 *   npm test            # run all
 *   npm test -- <path>  # run one file
 */
import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const cwd = process.cwd();
const tsx = join(cwd, "node_modules", ".bin", "tsx");
if (!existsSync(tsx)) {
  console.error("tsx not found. Run `npm install` first.");
  process.exit(1);
}

function findTests(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...findTests(p));
    else if (entry.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

const arg = process.argv[2];
const files = arg ? [join(cwd, arg)] : findTests(join(cwd, "src")).sort();

if (files.length === 0) {
  console.log("No *.test.ts files found under src/.");
  process.exit(0);
}

let failed = 0;
for (const file of files) {
  const rel = file.replace(cwd + "/", "");
  console.log(`\n> ${rel}`);
  // `--conditions=react-server` lets modules that `import "server-only"` load
  // under plain Node. Next applies the same condition for server code.
  const res = spawnSync(tsx, [file], {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_OPTIONS: [process.env.NODE_OPTIONS, "--conditions=react-server"].filter(Boolean).join(" "),
    },
  });
  if (res.status !== 0) {
    failed++;
    console.log(`FAILED: ${rel}`);
  }
}
console.log(`\n${files.length - failed}/${files.length} test file(s) passed`);
process.exit(failed ? 1 : 0);
```

Then in `admin/package.json` add the script and the dev dependency:

```json
  "scripts": {
    "dev": "next dev --turbopack -p 3100",
    "build": "next build",
    "start": "next start",
    "test": "node scripts/test.mjs",
    "typecheck": "tsc --noEmit -p ."
  },
```

and under `devDependencies`:

```json
    "tsx": "^4.19.2"
```

Run: `cd admin && npm install`

- [ ] **Step 4: Run the test to see it pass**

Run: `cd admin && npm test`
Expected: `format.test.ts: ok` and `1/1 test file(s) passed`.

- [ ] **Step 5: Commit**

```bash
git add admin/scripts/test.mjs admin/src/lib/format.test.ts admin/package.json admin/package-lock.json
git commit -m "test(console): add the test runner and the first test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Toasts

**Files:**
- Create: `admin/src/lib/toast.ts`
- Create: `admin/src/components/ui/Toaster.tsx`
- Modify: `admin/src/app/layout.tsx`
- Modify: `admin/src/app/globals.css`
- Modify: `admin/package.json` (dependency `sonner`)

**Interfaces:**
- Produces: `notify.ok(message: string, note?: string): void`, `notify.fail(message: string): void`, `notify.undo(message: string, opts: { label?: string; onUndo: () => void; durationMs?: number }): void` from `@/lib/toast`.

- [ ] **Step 1: Install sonner**

Run: `cd admin && npm install sonner@^2.0.7`

- [ ] **Step 2: Write the toast helper**

`admin/src/lib/toast.ts`:

```ts
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
```

- [ ] **Step 3: Write the Toaster wrapper and mount it**

`admin/src/components/ui/Toaster.tsx`:

```tsx
"use client";

import { Toaster as Sonner } from "sonner";

/** Bottom right, dark, styled with the console's tokens (see .toast in globals.css). */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      theme="dark"
      closeButton
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "toast",
          title: "toast-title",
          description: "toast-desc",
          actionButton: "toast-action",
          closeButton: "toast-close",
          success: "toast--ok",
          error: "toast--fail",
        },
      }}
    />
  );
}
```

`admin/src/app/layout.tsx` becomes:

```tsx
import type { ReactNode } from "react";
import "./globals.css";
import { body, heading, mono, nebula } from "./fonts";
import { Toaster } from "@/components/ui/Toaster";

export const metadata = { title: "AdonisAgent Platform" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${body.variable} ${heading.variable} ${mono.variable} ${nebula.variable}`}
    >
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Style the toast**

Append to `admin/src/app/globals.css`:

```css
/* ── Toasts (components/ui/Toaster.tsx) ─────────────────────────────────── */
.toast {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: 360px;
  max-width: calc(100vw - 32px);
  padding: 13px 14px 13px 16px;
  border-radius: 12px;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 18px 40px -18px rgba(0, 0, 0, 0.8);
  color: var(--text-primary);
  font-family: var(--font-body), system-ui, sans-serif;
  font-size: 13.5px;
  line-height: 1.4;
  position: relative;
}
.toast::before {
  content: "";
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 2px;
  background: var(--text-tertiary);
}
.toast--ok::before { background: var(--green); }
.toast--fail::before { background: var(--red); }
.toast [data-icon] { display: none; }
.toast-title { font-weight: 500; }
.toast-desc { margin-top: 3px; color: var(--text-secondary); font-size: 12.5px; }
.toast-action {
  margin-left: auto;
  flex: 0 0 auto;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--hairline-strong);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}
.toast-action:hover { background: var(--surface-3); }
.toast-close {
  position: absolute;
  top: -8px;
  left: -8px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--hairline);
  background: var(--surface-3);
  color: var(--text-secondary);
  cursor: pointer;
}
```

- [ ] **Step 5: Typecheck**

Run: `cd admin && npx tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add admin/package.json admin/package-lock.json admin/src/lib/toast.ts admin/src/components/ui/Toaster.tsx admin/src/app/layout.tsx admin/src/app/globals.css
git commit -m "feat(console): toasts for every action result

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The confirm dialog

**Files:**
- Create: `admin/src/components/ui/ConfirmDialog.tsx`
- Modify: `admin/src/app/(console)/layout.tsx`
- Modify: `admin/src/app/globals.css`

**Interfaces:**
- Produces: `ConfirmProvider` (wrap the console tree) and `useConfirm(): (opts: ConfirmOptions) => Promise<ConfirmResult>` where

```ts
export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;   // default "Confirm"
  cancelLabel?: string;    // default "Cancel"
  danger?: boolean;        // red confirm button
  /** Ask for a line of text (a reason). The result carries it. */
  prompt?: { label: string; placeholder?: string; minLength?: number };
  /** The operator must type this exact string before Confirm enables. */
  typeToConfirm?: string;
}
export type ConfirmResult = { ok: true; value: string } | { ok: false };
```

- [ ] **Step 1: Write the component**

`admin/src/components/ui/ConfirmDialog.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Ask for a line of text (a reason). The result carries it. */
  prompt?: { label: string; placeholder?: string; minLength?: number };
  /** The operator must type this exact string before Confirm enables. */
  typeToConfirm?: string;
}
export type ConfirmResult = { ok: true; value: string } | { ok: false };

type Ask = (opts: ConfirmOptions) => Promise<ConfirmResult>;
const Ctx = createContext<Ask | null>(null);

interface Pending { opts: ConfirmOptions; resolve: (r: ConfirmResult) => void }

/**
 * One native <dialog> for the whole console. A browser confirm() cannot be
 * styled, cannot ask for a reason, and cannot make somebody type a name
 * before deleting a business. This can. Native <dialog> gives focus trapping,
 * Escape and the backdrop for free.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const ask = useCallback<Ask>((opts) => new Promise((resolve) => setPending({ opts, resolve })), []);
  const settle = (r: ConfirmResult) => {
    pending?.resolve(r);
    setPending(null);
  };
  return (
    <Ctx.Provider value={ask}>
      {children}
      {pending && <Dialog opts={pending.opts} onSettle={settle} />}
    </Ctx.Provider>
  );
}

export function useConfirm(): Ask {
  const ask = useContext(Ctx);
  if (!ask) throw new Error("useConfirm needs a ConfirmProvider above it");
  return ask;
}

function Dialog({ opts, onSettle }: { opts: ConfirmOptions; onSettle: (r: ConfirmResult) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [value, setValue] = useState("");
  const inputId = useId();
  const minLength = opts.prompt?.minLength ?? 3;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onSettle({ ok: false });
    };
    d.addEventListener("cancel", onCancel);
    return () => d.removeEventListener("cancel", onCancel);
  }, [onSettle]);

  const typeOk = opts.typeToConfirm === undefined || typed === opts.typeToConfirm;
  const promptOk = opts.prompt === undefined || value.trim().length >= minLength;
  const canConfirm = typeOk && promptOk;

  return (
    <dialog
      ref={ref}
      className="dlg"
      aria-labelledby={`${inputId}-title`}
      onClick={(e) => {
        if (e.target === ref.current) onSettle({ ok: false });
      }}
    >
      <form
        method="dialog"
        className="dlg-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (canConfirm) onSettle({ ok: true, value: value.trim() });
        }}
      >
        <h2 id={`${inputId}-title`} className="dlg-title">{opts.title}</h2>
        {opts.body && <p className="dlg-text">{opts.body}</p>}

        {opts.prompt && (
          <label className="dlg-field">
            <span>{opts.prompt.label}</span>
            <input
              className="input"
              autoFocus
              value={value}
              placeholder={opts.prompt.placeholder}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="off"
            />
          </label>
        )}

        {opts.typeToConfirm !== undefined && (
          <label className="dlg-field">
            <span>
              Type <strong>{opts.typeToConfirm}</strong> to confirm
            </span>
            <input
              className="input"
              autoFocus={!opts.prompt}
              value={typed}
              placeholder={opts.typeToConfirm}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}

        <div className="dlg-actions">
          <button type="button" className="btn btn--secondary btn--md" onClick={() => onSettle({ ok: false })}>
            {opts.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="submit"
            className={`btn btn--md ${opts.danger ? "btn--destructive" : "btn--primary"}`}
            disabled={!canConfirm}
            autoFocus={!opts.prompt && opts.typeToConfirm === undefined}
          >
            {opts.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
```

- [ ] **Step 2: Style it**

Append to `admin/src/app/globals.css`:

```css
/* ── Confirm dialog (components/ui/ConfirmDialog.tsx) ───────────────────── */
.dlg {
  border: 1px solid var(--hairline);
  border-radius: 16px;
  padding: 0;
  width: min(440px, calc(100vw - 32px));
  background: var(--surface-1);
  color: var(--text-primary);
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 30px 80px -30px rgba(0, 0, 0, 0.9);
  animation: dlg-in 0.18s var(--ease) both;
}
.dlg::backdrop { background: rgba(5, 6, 8, 0.6); backdrop-filter: blur(2px); }
@keyframes dlg-in { from { opacity: 0; transform: translateY(6px) scale(0.985); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .dlg { animation: none; } }
.dlg-body { display: flex; flex-direction: column; gap: 14px; padding: 24px 24px 20px; }
.dlg-title { margin: 0; font-family: var(--font-heading), system-ui, sans-serif; font-size: 18px; font-weight: 500; letter-spacing: -0.015em; }
.dlg-text { margin: 0; color: var(--text-secondary); font-size: 14px; line-height: 1.5; }
.dlg-field { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--text-secondary); }
.dlg-field strong { color: var(--text-primary); font-family: var(--font-mono), ui-monospace, monospace; font-weight: 500; }
.dlg-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
```

- [ ] **Step 3: Mount the provider**

`admin/src/app/(console)/layout.tsx` becomes:

```tsx
import type { ReactNode } from "react";

import { requireAdminSession } from "@/lib/session";
import { Shell } from "@/components/Shell";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const user = await requireAdminSession();
  return (
    <ConfirmProvider>
      <Shell user={user}>{children}</Shell>
    </ConfirmProvider>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd admin && npx tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/ui/ConfirmDialog.tsx "admin/src/app/(console)/layout.tsx" admin/src/app/globals.css
git commit -m "feat(console): a real confirm dialog with reason prompts and type-to-confirm

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: ConfirmButton uses the dialog, toasts its result, and can undo

**Files:**
- Modify: `admin/src/components/ConfirmButton.tsx` (whole file)
- Modify: `admin/src/app/(console)/gyms/[id]/money/page.tsx` (four buttons)

**Interfaces:**
- Consumes: `useConfirm`, `notify`.
- Produces: `ConfirmButton` props add `done?: string` (toast text on success; default `"<label>: done"`), `undo?: { label: string; action: () => Promise<ActionResult> }` (shows an undo toast; the inverse action runs when pressed). `slug` keeps its meaning (type-to-confirm) and `confirm` becomes the dialog body.

- [ ] **Step 1: Rewrite ConfirmButton**

`admin/src/components/ConfirmButton.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/cn";
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type ActionResult = { ok: boolean; error?: string };

/**
 * A button that runs a server action after the operator confirms in the
 * console's dialog. Success is a toast; a failure is a toast and stays
 * under the button as selectable text. `undo` turns the success toast into
 * one with an Undo that runs the inverse action.
 */
export function ConfirmButton({
  label,
  action,
  confirm,
  slug,
  danger,
  className,
  redirectTo,
  done,
  undo,
}: {
  label: string;
  /** A server action (typically `tenantAction.bind(null, …)`). */
  action: () => Promise<ActionResult>;
  /** Body text of the dialog. Without it the action runs on click. */
  confirm?: string;
  /** Offboard variant: the user must type this exact slug in the dialog. */
  slug?: string;
  danger?: boolean;
  className?: string;
  /** On a successful `{ok:true}`, navigate here (used by Offboard → /gyms). */
  redirectTo?: string;
  /** Toast text on success. */
  done?: string;
  /** The inverse action, offered on the success toast for ten seconds. */
  undo?: { label: string; action: () => Promise<ActionResult> };
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const ask = useConfirm();

  function runAction() {
    setError(null);
    startTransition(async () => {
      const r = await action();
      if (!r.ok) {
        setError(r.error ?? "Action failed");
        notify.fail(r.error ?? "Action failed");
        return;
      }
      const message = done ?? `${label}: done`;
      if (undo) {
        notify.undo(message, {
          label: undo.label,
          onUndo: () => {
            startTransition(async () => {
              const u = await undo.action();
              if (!u.ok) notify.fail(u.error ?? "Could not undo that");
              else notify.ok(`${undo.label}: done`);
              router.refresh();
            });
          },
        });
      } else {
        notify.ok(message);
      }
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  async function onClick() {
    if (confirm === undefined && slug === undefined) {
      runAction();
      return;
    }
    const r = await ask({
      title: label,
      body: confirm,
      confirmLabel: label,
      danger,
      typeToConfirm: slug,
    });
    if (r.ok) runAction();
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className={className ?? cn("btn", danger ? "btn--destructive" : "btn--secondary", "btn--sm")}
        onClick={onClick}
        disabled={pending}
        style={pending ? { opacity: 0.6, cursor: "wait" } : undefined}
      >
        {pending ? "Working…" : label}
      </button>
      {error && (
        <span role="alert" style={{ color: "var(--red)", fontSize: 11.5, maxWidth: 220 }}>
          {error}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Give the four suspend buttons an undo**

In `admin/src/app/(console)/gyms/[id]/money/page.tsx`, the business Suspend button becomes:

```tsx
                <ConfirmButton
                  label="Suspend"
                  danger
                  confirm="Suspend this business? Members lose access until it is reactivated."
                  action={tenantAction.bind(null, tenant.id, "suspend", {})}
                  done="Business suspended"
                  undo={{ label: "Reactivate", action: tenantAction.bind(null, tenant.id, "reactivate", {}) }}
                />
```

The Suspend marketing button becomes:

```tsx
            <ConfirmButton
              label="Suspend marketing"
              danger
              confirm="Suspend email marketing for this business? No campaigns can be sent until resumed."
              action={tenantAction.bind(null, tenant.id, "suspend-marketing", {})}
              done="Email marketing suspended"
              undo={{ label: "Resume marketing", action: tenantAction.bind(null, tenant.id, "resume-marketing", {}) }}
            />
```

Find the `Suspend AI` and `Suspend voice` `ConfirmButton`s (search the file for `"suspend-ai"` and `"suspend-voice"`) and add in the same way:

```tsx
              done="AI suspended"
              undo={{ label: "Resume AI", action: tenantAction.bind(null, tenant.id, "resume-ai", {}) }}
```

```tsx
              done="Voice suspended"
              undo={{ label: "Resume voice", action: tenantAction.bind(null, tenant.id, "resume-voice", {}) }}
```

- [ ] **Step 3: Typecheck**

Run: `cd admin && npx tsc --noEmit -p .`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add admin/src/components/ConfirmButton.tsx "admin/src/app/(console)/gyms/[id]/money/page.tsx"
git commit -m "feat(console): confirm buttons use the dialog, toast, and offer undo on suspend

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Every other browser prompt goes through the dialog and the toast

**Files:**
- Modify: `admin/src/components/OpenBusinessButton.tsx`
- Modify: `admin/src/components/GrantCreditsForm.tsx`
- Modify: `admin/src/components/fleet/KillSwitches.tsx`
- Modify: `admin/src/components/people/PeopleTable.tsx`
- Modify: `admin/src/components/health/HealthPanel.tsx`
- Modify: `admin/src/components/data/DataPanel.tsx`
- Modify: `admin/src/components/integrations/IntegrationsBoard.tsx`
- Modify: `admin/src/components/money/MoneyAdjustments.tsx`

**Interfaces:**
- Consumes: `useConfirm`, `notify`.

- [ ] **Step 1: OpenBusinessButton asks for the reason in the dialog**

Replace the `onClick` function and add the hook. The full new component body:

```tsx
"use client";

import { useState, useTransition } from "react";

import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";

type OpenResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Opening a client's account is the most sensitive thing this console does:
 * it is a real login to a real business's live data. The reason is asked for
 * HERE, before the action runs, because it is written to the audit log AND
 * shown in a banner inside the tenant app for the life of the session, so
 * the client can see why someone was in their account.
 */
export function OpenBusinessButton({
  action,
  label = "Open",
  className,
}: {
  /** A server action bound to a tenant id (`openTenant.bind(null, id)`), taking the reason. */
  action: (reason: string) => Promise<OpenResult>;
  label?: string;
  className?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ask = useConfirm();

  async function onClick() {
    setError(null);
    const r = await ask({
      title: "Open this business",
      body: "This is recorded, and shown to them in a banner while you are in there.",
      confirmLabel: "Open in a new tab",
      prompt: { label: "Why are you opening it?", placeholder: "Support call about…", minLength: 3 },
    });
    if (!r.ok) return;
    startTransition(async () => {
      const res = await action(r.value);
      if (!res.ok) {
        setError(res.error);
        notify.fail(res.error);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    });
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className={className ?? "btn btn--secondary btn--sm"}
        onClick={onClick}
        disabled={pending}
        style={pending ? { opacity: 0.6, cursor: "wait" } : undefined}
      >
        {pending ? "Opening…" : label}
      </button>
      {error && (
        <span role="alert" style={{ color: "var(--red)", fontSize: 11.5, maxWidth: 220 }}>
          {error}
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: GrantCreditsForm confirms through the dialog**

Replace the component body (keep the file's header comment and imports, add the two new imports):

```tsx
import { useRef, useState } from "react";

import { fmtCents } from "@/lib/format";
import { useConfirm } from "@/components/ui/ConfirmDialog";

export function GrantCreditsForm({
  action,
  noun = "credits",
}: {
  /** `grantCreditsAction` bound to the tenant id (see ./actions.ts). */
  action: (formData: FormData) => void | Promise<void>;
  /** What's being granted, for the label + confirm copy, e.g. "AI credits". Defaults to "credits". */
  noun?: string;
}) {
  const [euros, setEuros] = useState("");
  const ask = useConfirm();
  // Set once the dialog has said yes, so the resubmit below goes straight through.
  const confirmed = useRef(false);

  return (
    <form
      action={action}
      onSubmit={async (e) => {
        if (confirmed.current) {
          confirmed.current = false;
          return;
        }
        e.preventDefault();
        const form = e.currentTarget;
        const amount = parseFloat(euros);
        const label = Number.isFinite(amount) && amount > 0 ? fmtCents(Math.round(amount * 100)) : "this amount";
        const r = await ask({
          title: `Grant ${label} in ${noun}`,
          body: "This cannot be undone from here.",
          confirmLabel: "Grant",
        });
        if (!r.ok) return;
        confirmed.current = true;
        form.requestSubmit();
      }}
      style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>Grant {noun} (EUR)</span>
        <input
          className="input"
          type="number"
          step="0.01"
          min="0.01"
          max="10000"
          name="euros"
          placeholder="50.00"
          required
          value={euros}
          onChange={(e) => setEuros(e.target.value)}
          style={{ width: 140 }}
        />
      </label>
      <button className="btn btn--primary btn--sm" type="submit">
        Grant
      </button>
    </form>
  );
}
```

- [ ] **Step 3: KillSwitches**

Add the imports:

```tsx
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
```

Add `const ask = useConfirm();` next to the other hooks, and replace the `toggle` function:

```tsx
  async function toggle(s: KillSwitchState) {
    let reason = "";
    if (!s.stopped) {
      const r = await ask({
        title: `Stop ${s.label} for every business`,
        body: "Work waits while it is off and resumes when you start it again.",
        confirmLabel: "Stop",
        danger: true,
        prompt: { label: "Why?", placeholder: "Provider outage…", minLength: 3 },
      });
      if (!r.ok) return;
      reason = r.value;
    } else {
      const r = await ask({ title: `Start ${s.label} again for every business?`, confirmLabel: "Start" });
      if (!r.ok) return;
    }
    setResult(null);
    start(async () => {
      const r = await setKillSwitchAction(s.key, !s.stopped, reason);
      if (r.ok) {
        notify.ok(r.note);
        router.refresh();
      } else {
        setResult(r);
        notify.fail(r.error);
      }
    });
  }
```

- [ ] **Step 4: PeopleTable**

Add the imports:

```tsx
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
```

Add `const ask = useConfirm();` beside the other hooks. Replace `run` and `submitInvite`:

```tsx
  async function run(key: string, body: PeopleOp, confirmText?: string, undo?: { label: string; op: PeopleOp }) {
    if (confirmText) {
      const r = await ask({ title: confirmText, confirmLabel: "Yes", danger: body.op === "set-access" && !body.active });
      if (!r.ok) return;
    }
    setBusyKey(key);
    setResult(null);
    start(async () => {
      const r = await peopleAction(tenantId, body);
      setBusyKey(null);
      if (!r.ok) {
        setResult(r);
        notify.fail(r.error);
        return;
      }
      // A reset link must stay on the page as selectable text; everything else is a toast.
      if (r.link) setResult(r);
      else if (undo) {
        notify.undo(r.note ?? "Done", {
          label: undo.label,
          onUndo: () => void run(`${key}-undo`, undo.op),
        });
      } else notify.ok(r.note ?? "Done");
      router.refresh();
    });
  }

  function submitInvite(formData: FormData) {
    setBusyKey("invite");
    setResult(null);
    start(async () => {
      const r = await inviteAction(tenantId, formData);
      setBusyKey(null);
      if (!r.ok) {
        setResult(r);
        notify.fail(r.error);
        return;
      }
      if (r.link) setResult(r);
      else notify.ok(r.note ?? "Invite sent");
      router.refresh();
    });
  }
```

The Revoke access button's `onClick` becomes:

```tsx
                          onClick={() =>
                            run(
                              `access-${p.userId}`,
                              { op: "set-access", userId: p.userId, active: revoked },
                              revoked ? undefined : `Revoke ${p.email}'s access to this business?`,
                              revoked ? undefined : { label: "Restore access", op: { op: "set-access", userId: p.userId, active: true } },
                            )
                          }
```

- [ ] **Step 5: HealthPanel, IntegrationsBoard, DataPanel, MoneyAdjustments**

In each of the four, add the imports:

```tsx
import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
```

and `const ask = useConfirm();` beside `useRouter()` (DataPanel and IntegrationsBoard and MoneyAdjustments; HealthPanel needs only `notify`).

HealthPanel `run` (the `start(async …)` block) becomes:

```tsx
    start(async () => {
      const r = await healthAction(tenantId, body);
      setBusyKey(null);
      if (r.ok) {
        notify.ok(r.note);
        router.refresh();
      } else {
        setResult(r);
        notify.fail(r.error);
      }
    });
```

IntegrationsBoard `run` becomes:

```tsx
  async function run(key: string, body: IntegrationOp, confirmText?: string) {
    if (confirmText) {
      const r = await ask({ title: confirmText, confirmLabel: "Yes", danger: true });
      if (!r.ok) return;
    }
    setBusyKey(key);
    setResult(null);
    start(async () => {
      const r = await integrationAction(tenantId, body);
      setBusyKey(null);
      if (r.ok) {
        notify.ok(r.note ?? "Done");
        router.refresh();
      } else {
        setResult(r);
        notify.fail(r.error);
      }
    });
  }
```

(If `IntegrationActionResult`'s success shape has no `note`, use `notify.ok("Done")`.)

DataPanel `run` becomes:

```tsx
  function run(key: string, body: DataOp) {
    setBusyKey(key);
    setResult(null);
    start(async () => {
      const r = await dataAction(tenantId, body);
      setBusyKey(null);
      if (!r.ok) {
        setResult(r);
        notify.fail(r.error);
        return;
      }
      if (!r.data) {
        notify.ok(r.note ?? "Done");
        router.refresh();
      } else setResult(r);
    });
  }
```

and the delete-person function (the one that calls `window.prompt` then `window.confirm`) becomes:

```tsx
  async function deletePerson(p: PersonHit) {
    const r = await ask({
      title: `Permanently delete ${p.name}`,
      body: `${p.email ?? p.phone ?? "No contact details"}. Every record of them in this business goes. This is the one action here that cannot be restored.`,
      confirmLabel: "Delete",
      danger: true,
      prompt: { label: "Why? (kept on the audit trail)", minLength: 3 },
      typeToConfirm: "delete",
    });
    if (!r.ok) return;
    run(`delete-${p.kind}-${p.id}`, { op: "delete-person", kind: p.kind, personId: p.id, reason: r.value });
  }
```

(Keep the existing function's name if it differs; the body above is what matters.)

MoneyAdjustments `run` becomes:

```tsx
  function run(body: MoneyOp) {
    setResult(null);
    start(async () => {
      const r = await moneyAction(tenantId, body);
      if (r.ok) {
        notify.ok(r.note ?? "Saved");
        router.refresh();
      } else {
        setResult(r);
        notify.fail(r.error);
      }
    });
  }
```

and `addCredit` asks through the dialog:

```tsx
  async function addCredit() {
    const euros = Number(amount.trim());
    if (!Number.isFinite(euros) || euros <= 0) {
      setResult({ ok: false, error: "Give an amount in euro." });
      return;
    }
    if (!description.trim()) {
      setResult({ ok: false, error: "Say what the credit is for. It appears on their invoice." });
      return;
    }
    const r = await ask({
      title: `Add a credit of ${fmtCents(Math.round(euros * 100))}`,
      body: description.trim(),
      confirmLabel: "Add credit",
      prompt: { label: "Why is this credit being given? (kept on the audit trail)", minLength: 3 },
    });
    if (!r.ok) return;
    run({ op: "add-credit", cents: Math.round(euros * 100), description: description.trim(), reason: r.value });
    setAmount("");
    setDescription("");
  }
```

(Import `fmtCents` from `@/lib/format` if the file does not already.)

- [ ] **Step 6: Confirm nothing native is left**

Run: `cd admin && grep -rn "window.confirm\|window.prompt" src`
Expected: no output.

- [ ] **Step 7: Typecheck and build**

Run: `cd admin && npx tsc --noEmit -p . && npx next build 2>&1 | tail -3`
Expected: typecheck prints nothing; the build ends with the route table.

- [ ] **Step 8: Commit**

```bash
git add admin/src/components
git commit -m "feat(console): every prompt and confirm goes through the dialog, every result through a toast

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Skeletons, error page, not-found page, and the screenshot script

**Files:**
- Create: `admin/src/app/(console)/loading.tsx`
- Create: `admin/src/app/(console)/gyms/[id]/loading.tsx`
- Create: `admin/src/app/(console)/error.tsx`
- Create: `admin/src/app/(console)/not-found.tsx`
- Create: `admin/scripts/screens.mjs`
- Modify: `admin/src/app/globals.css`

**Interfaces:**
- Produces: `.skel` and `.skel-*` classes; `node scripts/screens.mjs <outDir> [page…]`.

- [ ] **Step 1: Skeleton styles**

Append to `admin/src/app/globals.css`:

```css
/* ── Skeletons (loading.tsx) ─────────────────────────────────────────────── */
.skel {
  position: relative;
  overflow: hidden;
  background: var(--surface-2);
  border-radius: 8px;
}
.skel::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent);
  transform: translateX(-100%);
  animation: skel-sweep 1.4s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) { .skel::after { animation: none; } }
@keyframes skel-sweep { to { transform: translateX(100%); } }
.skel-line { height: 12px; }
.skel-title { height: 30px; width: 220px; border-radius: 8px; }
.skel-card { border: 1px solid var(--hairline); border-radius: var(--radius-lg); padding: 24px 26px; display: flex; flex-direction: column; gap: 12px; }
.skel-rows { display: flex; flex-direction: column; gap: 14px; }

/* ── Error and not-found ─────────────────────────────────────────────────── */
.fault { max-width: 520px; margin: 80px auto; text-align: center; display: flex; flex-direction: column; gap: 12px; align-items: center; }
.fault h1 { margin: 0; font-family: var(--font-heading), system-ui, sans-serif; font-size: 24px; font-weight: 500; letter-spacing: -0.02em; }
.fault p { margin: 0; color: var(--text-secondary); font-size: 14px; line-height: 1.5; }
.fault code { font-family: var(--font-mono), ui-monospace, monospace; font-size: 12px; color: var(--text-tertiary); }
.fault-actions { display: flex; gap: 8px; margin-top: 8px; }
```

- [ ] **Step 2: The page skeleton**

`admin/src/app/(console)/loading.tsx`:

```tsx
/**
 * Shown the instant a console page is requested, before its data has come
 * back from the main app. The shell (sidebar) is above this boundary, so it
 * stays put; only the page area swaps. Hovering a sidebar link prefetches
 * this, which is what makes navigation feel immediate.
 */
export default function ConsoleLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingBottom: 26, borderBottom: "1px solid var(--grid)" }}>
        <div className="skel skel-line" style={{ width: 60 }} />
        <div className="skel skel-title" />
        <div className="skel skel-line" style={{ width: 320 }} />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="skel-card">
          <div className="skel skel-line" style={{ width: 160, height: 16 }} />
          <div className="skel-rows">
            <div className="skel skel-line" style={{ width: "90%" }} />
            <div className="skel skel-line" style={{ width: "70%" }} />
            <div className="skel skel-line" style={{ width: "80%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
```

`admin/src/app/(console)/gyms/[id]/loading.tsx`:

```tsx
/** Under the business header: the tab content while it loads. */
export default function TenantTabLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {[0, 1].map((i) => (
        <div key={i} className="skel-card">
          <div className="skel skel-line" style={{ width: 140, height: 16 }} />
          <div className="skel-rows">
            <div className="skel skel-line" style={{ width: "85%" }} />
            <div className="skel skel-line" style={{ width: "60%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Error and not-found**

`admin/src/app/(console)/error.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * A page that failed to render. Next catches the throw and shows this in
 * place of the page, with the shell still around it. The message is the
 * server's own (an ApiError carries the main app's reason), so "Request
 * failed (502)" reads as what it is.
 */
export default function ConsoleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[console]", error);
  }, [error]);
  return (
    <div className="fault" role="alert">
      <h1>This page could not load</h1>
      <p>{error.message || "Something went wrong talking to the platform."}</p>
      {error.digest && <code>ref {error.digest}</code>}
      <div className="fault-actions">
        <button type="button" className="btn btn--primary btn--md" onClick={reset}>
          Try again
        </button>
        <Link href="/" className="btn btn--secondary btn--md">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
```

`admin/src/app/(console)/not-found.tsx`:

```tsx
import Link from "next/link";

export default function ConsoleNotFound() {
  return (
    <div className="fault">
      <h1>No such page</h1>
      <p>The business or page you followed a link to is not here. It may have been purged, or the link is old.</p>
      <div className="fault-actions">
        <Link href="/gyms" className="btn btn--primary btn--md">
          All businesses
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: The screenshot script**

`admin/scripts/screens.mjs`:

```js
#!/usr/bin/env node
/**
 * Screenshots of every console page, for looking at a change before it ships.
 *
 *   ADMIN_SESSION=<raw token> node scripts/screens.mjs <outDir> [page…]
 *
 * Needs the main app on :3000 and the console on :3100. To mint a local
 * session for user 1 in the DEV control database (never production):
 *
 *   RAW=$(openssl rand -hex 24); KEY="h1:$(printf %s "$RAW" | shasum -a 256 | cut -d' ' -f1)"
 *   sqlite3 ../app/data/control.db "insert into platform_sessions(token,user_id,expires_at) values('$KEY',1,$(( ($(date +%s)+86400)*1000 )))"
 *   ADMIN_SESSION=$RAW node scripts/screens.mjs /tmp/screens
 *
 * Delete the row afterwards: sqlite3 ../app/data/control.db "delete from platform_sessions where token='$KEY'"
 */
import fs from "node:fs";
import { chromium } from "../../app/node_modules/playwright-core/index.mjs";

const [out, ...only] = process.argv.slice(2);
if (!out || !process.env.ADMIN_SESSION) {
  console.error("usage: ADMIN_SESSION=<raw token> node scripts/screens.mjs <outDir> [page…]");
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });

const cacheDir = `${process.env.HOME}/Library/Caches/ms-playwright`;
const shell = fs.readdirSync(cacheDir).find((d) => d.startsWith("chromium_headless_shell"));
const exe = shell ? `${cacheDir}/${shell}/chrome-headless-shell-mac-arm64/chrome-headless-shell` : undefined;

const TENANT = process.env.TENANT_ID ?? "1028";
const pages = {
  dash: "/", gyms: "/gyms", gym: `/gyms/${TENANT}`, people: `/gyms/${TENANT}/people`,
  integ: `/gyms/${TENANT}/integrations`, money: `/gyms/${TENANT}/money`, features: `/gyms/${TENANT}/features`,
  data: `/gyms/${TENANT}/data`, thealth: `/gyms/${TENANT}/health`, timeline: `/gyms/${TENANT}/timeline`,
  provision: "/provision", staff: "/staff", audit: "/audit", health: "/health", settings: "/settings",
};

const browser = await chromium.launch({ executablePath: fs.existsSync(exe ?? "") ? exe : undefined });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "cf_admin_session", value: process.env.ADMIN_SESSION, domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
for (const [name, url] of Object.entries(pages)) {
  if (only.length && !only.includes(name)) continue;
  await page.goto(`http://localhost:3100${url}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  console.log(name, page.url());
}
await browser.close();
```

- [ ] **Step 5: See the skeleton and the error page**

Start both apps (`cd app && npm run dev` and `cd admin && npm run dev`), mint a session as the script's comment says, then:

Run: `cd admin && ADMIN_SESSION=$RAW node scripts/screens.mjs /tmp/screens dash gym`
Expected: two PNGs. Open them; the pages render as before.

Then stop the main app and reload `http://localhost:3100/gyms` in a browser: the shell stays and the page area shows "This page could not load" with the fetch error and a Try again button. Restart the app.

- [ ] **Step 6: Typecheck and commit**

Run: `cd admin && npx tsc --noEmit -p .`
Expected: no output.

```bash
git add "admin/src/app/(console)/loading.tsx" "admin/src/app/(console)/gyms/[id]/loading.tsx" "admin/src/app/(console)/error.tsx" "admin/src/app/(console)/not-found.tsx" admin/scripts/screens.mjs admin/src/app/globals.css
git commit -m "feat(console): skeletons while a page loads, a readable error page, a not-found page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: A 30-second cache on the fleet reads, busted by every write

**Files:**
- Modify: `admin/src/lib/api.ts`
- Create: `admin/src/lib/revalidate.ts`
- Modify: `admin/src/app/(console)/page.tsx`, `admin/src/app/(console)/gyms/page.tsx`, `admin/src/app/(console)/health/page.tsx`, `admin/src/app/(console)/gyms/[id]/layout.tsx`
- Modify: every `actions.ts` under `admin/src/app/(console)/` (eleven files, listed in Step 3)

**Interfaces:**
- Produces: `api<T>(path, { revalidate?: number; tags?: string[] })`; `bust(tenantId?: number): void` from `@/lib/revalidate`.

- [ ] **Step 1: The option on api()**

In `admin/src/lib/api.ts`, change the signature and the fetch options:

```ts
/** Server-side call to the main app's platform API (key + session attached). */
export async function api<T>(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    session?: string | null;
    /**
     * Seconds a GET may be served from Next's data cache. Only for reads a
     * write busts by tag (see lib/revalidate.ts). Omitted: never cached.
     */
    revalidate?: number;
    tags?: string[];
  } = {},
): Promise<T> {
  const session = opts.session === undefined ? (await cookies()).get(ADMIN_COOKIE)?.value ?? null : opts.session;
  const res = await fetch(`${BASE}/api/platform${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "x-platform-key": KEY,
      ...(session ? { "x-admin-session": session } : {}),
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    ...(opts.revalidate !== undefined
      ? { next: { revalidate: opts.revalidate, tags: opts.tags ?? [] } }
      : { cache: "no-store" as const }),
  });
```

(The rest of the function is unchanged.)

- [ ] **Step 2: The bust helper**

`admin/src/lib/revalidate.ts`:

```ts
import "server-only";
import { revalidateTag } from "next/cache";

/**
 * Every console write calls this. The fleet lists (dashboard, businesses,
 * health) are cached for 30 seconds under "fleet"; a business's own detail
 * under "tenant-<id>" for 15. A write to either must not be invisible for
 * half a minute, so the tag goes first and the next read is fresh.
 */
export function bust(tenantId?: number): void {
  revalidateTag("fleet");
  if (tenantId !== undefined) revalidateTag(`tenant-${tenantId}`);
}
```

- [ ] **Step 3: Cache the reads and bust from the writes**

Reads:

- `admin/src/app/(console)/page.tsx`: `const data = await api<PlatformAnalytics>("/analytics", { revalidate: 30, tags: ["fleet"] });`
- `admin/src/app/(console)/gyms/page.tsx`: `const { tenants, killSwitches } = await api<FleetResponse>(\`/fleet${qs.toString() ? \`?${qs}\` : ""}\`, { revalidate: 30, tags: ["fleet"] });`
- `admin/src/app/(console)/health/page.tsx`: find the `api<FleetHealth>("/health")` call and add `, { revalidate: 30, tags: ["fleet"] }`.
- `admin/src/app/(console)/gyms/[id]/layout.tsx`: `data = await api<TenantDetail>(\`/tenants/${id}\`, { revalidate: 15, tags: [\`tenant-${id}\`] });`

Writes. In each file add `import { bust } from "@/lib/revalidate";` and call it right after the `api(...)` write succeeds, before the existing `revalidatePath` calls:

| File | Call |
|---|---|
| `gyms/[id]/actions.ts` (`tenantAction`, `openTenant`) | `bust(id);` |
| `gyms/[id]/people/actions.ts` (`peopleAction`) | `bust(tenantId);` |
| `gyms/[id]/features/actions.ts` | `bust(tenantId);` |
| `gyms/[id]/data/actions.ts` | `bust(tenantId);` |
| `gyms/[id]/health/actions.ts` | `bust(tenantId);` |
| `gyms/[id]/integrations/actions.ts` | `bust(tenantId);` |
| `gyms/[id]/money/adjustments-actions.ts` | `bust(tenantId);` |
| `gyms/actions.ts` (`setKillSwitchAction`) | `bust();` |
| `provision/actions.ts` (after the create succeeds) | `bust();` |
| `settings/actions.ts` (after the save succeeds) | `bust();` |
| `staff/actions.ts` (after the PATCH succeeds) | `bust();` |

The parameter is named `id` in `gyms/[id]/actions.ts` and `tenantId` elsewhere; use whichever the function already has.

- [ ] **Step 4: Prove the cache and the bust**

Run both apps. In the console open Businesses, then suspend AI for one business on its Money tab, go back to Businesses: the list reflects it at once (bust). Then edit a tenant's name directly in the dev `control.db` (`sqlite3 ../app/data/control.db "update tenants set name='Test Rename' where id=1028"`) and reload Businesses: the old name shows for up to 30 seconds, then the new one. Put the name back.

- [ ] **Step 5: Typecheck and commit**

Run: `cd admin && npx tsc --noEmit -p .`
Expected: no output.

```bash
git add admin/src/lib/api.ts admin/src/lib/revalidate.ts "admin/src/app/(console)"
git commit -m "perf(console): fleet reads served from a 30-second cache that every write busts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Keyboard shortcuts

**Files:**
- Create: `admin/src/lib/shortcuts.ts`
- Create: `admin/src/lib/shortcuts.test.ts`
- Create: `admin/src/components/Shortcuts.tsx`
- Modify: `admin/src/components/Shell.tsx`
- Modify: `admin/src/app/globals.css`

**Interfaces:**
- Produces: `SHORTCUTS: readonly { keys: string; label: string; href?: string }[]`, `resolveShortcut(prev: string | null, key: string): Resolution` where `Resolution = { kind: "go"; href: string } | { kind: "help" } | { kind: "pending"; key: string } | { kind: "none" }`.

- [ ] **Step 1: Write the failing test**

`admin/src/lib/shortcuts.test.ts`:

```ts
// Run: npm test -- src/lib/shortcuts.test.ts
import assert from "node:assert/strict";

import { resolveShortcut } from "./shortcuts";

assert.deepEqual(resolveShortcut(null, "g"), { kind: "pending", key: "g" });
assert.deepEqual(resolveShortcut("g", "b"), { kind: "go", href: "/gyms" });
assert.deepEqual(resolveShortcut("g", "d"), { kind: "go", href: "/" });
assert.deepEqual(resolveShortcut("g", "h"), { kind: "go", href: "/health" });
assert.deepEqual(resolveShortcut("g", "p"), { kind: "go", href: "/provision" });
assert.deepEqual(resolveShortcut("g", "a"), { kind: "go", href: "/audit" });
assert.deepEqual(resolveShortcut("g", "s"), { kind: "go", href: "/settings" });
assert.deepEqual(resolveShortcut("g", "x"), { kind: "none" });
assert.deepEqual(resolveShortcut(null, "?"), { kind: "help" });
assert.deepEqual(resolveShortcut(null, "b"), { kind: "none" });
console.log("shortcuts.test.ts: ok");
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd admin && npm test -- src/lib/shortcuts.test.ts`
Expected: fails with `Cannot find module './shortcuts'`.

- [ ] **Step 3: Write the resolver**

`admin/src/lib/shortcuts.ts`:

```ts
/**
 * Two-key chords, the way Linear and GitHub do it: press g, then a letter.
 * Pure, so the list and the help dialog are one source of truth.
 */
export const SHORTCUTS = [
  { keys: "g d", label: "Dashboard", href: "/" },
  { keys: "g b", label: "Businesses", href: "/gyms" },
  { keys: "g h", label: "Health", href: "/health" },
  { keys: "g p", label: "Provision a business", href: "/provision" },
  { keys: "g a", label: "Audit log", href: "/audit" },
  { keys: "g s", label: "Settings", href: "/settings" },
  { keys: "?", label: "Show these shortcuts" },
] as const;

export type Resolution =
  | { kind: "go"; href: string }
  | { kind: "help" }
  | { kind: "pending"; key: string }
  | { kind: "none" };

export function resolveShortcut(prev: string | null, key: string): Resolution {
  if (prev === null) {
    if (key === "?") return { kind: "help" };
    if (key === "g") return { kind: "pending", key };
    return { kind: "none" };
  }
  const hit = SHORTCUTS.find((s) => s.keys === `${prev} ${key}`);
  return hit && "href" in hit ? { kind: "go", href: hit.href } : { kind: "none" };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd admin && npm test -- src/lib/shortcuts.test.ts`
Expected: `shortcuts.test.ts: ok`.

- [ ] **Step 5: The listener and help dialog**

`admin/src/components/Shortcuts.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { SHORTCUTS, resolveShortcut } from "@/lib/shortcuts";

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

/** Mounted once in the Shell. Chords time out after a second. */
export function Shortcuts() {
  const router = useRouter();
  const [help, setHelp] = useState(false);
  const prev = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      if (document.querySelector("dialog[open]:not(.shortcuts)")) return;
      const r = resolveShortcut(prev.current, e.key);
      if (timer.current) clearTimeout(timer.current);
      prev.current = null;
      if (r.kind === "pending") {
        prev.current = r.key;
        timer.current = setTimeout(() => (prev.current = null), 1000);
      } else if (r.kind === "go") {
        e.preventDefault();
        router.push(r.href);
      } else if (r.kind === "help") {
        e.preventDefault();
        setHelp((h) => !h);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (help && !d.open) d.showModal();
    if (!help && d.open) d.close();
  }, [help]);

  return (
    <dialog
      ref={dialog}
      className="dlg shortcuts"
      onClose={() => setHelp(false)}
      onClick={(e) => {
        if (e.target === dialog.current) setHelp(false);
      }}
    >
      <div className="dlg-body">
        <h2 className="dlg-title">Keyboard shortcuts</h2>
        <ul className="keys">
          {SHORTCUTS.map((s) => (
            <li key={s.keys}>
              <span>{s.label}</span>
              <kbd>{s.keys}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </dialog>
  );
}
```

Append to `admin/src/app/globals.css`:

```css
/* ── Shortcut help (components/Shortcuts.tsx) ───────────────────────────── */
.keys { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.keys li { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--grid); font-size: 13.5px; }
.keys li:last-child { border-bottom: 0; }
.keys kbd {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--hairline);
  color: var(--text-secondary);
}
```

In `admin/src/components/Shell.tsx`, import it and mount it inside `<main className="app-main">` before `<div className="app-topbar">`:

```tsx
import { Shortcuts } from "@/components/Shortcuts";
```

```tsx
      <main className="app-main">
        <Shortcuts />
```

- [ ] **Step 6: Try it**

Run the console, press `g` then `b`: Businesses opens. Press `?`: the help dialog opens; Escape closes it. Click into the search box and type `g b`: nothing navigates.

- [ ] **Step 7: Commit**

```bash
git add admin/src/lib/shortcuts.ts admin/src/lib/shortcuts.test.ts admin/src/components/Shortcuts.tsx admin/src/components/Shell.tsx admin/src/app/globals.css
git commit -m "feat(console): keyboard shortcuts (g then a letter) and a help dialog on ?

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Deploy the console

- [ ] **Step 1: The three checks**

Run: `cd admin && npx tsc --noEmit -p . && npm test && npx next build 2>&1 | tail -3`
Expected: no type errors, all test files pass, the build ends with the route table.

- [ ] **Step 2: Push and deploy**

```bash
git push origin main
cd admin && railway up --detach
```

- [ ] **Step 3: Verify**

Wait for `railway deployment list --json` to show the new deployment as `SUCCESS`, then sign in at https://admin.adonisagent.ie, open Businesses, hover another sidebar link and click it: the skeleton shows and the page fills. Press `?`. Open a business's Money tab and press Suspend marketing: the dialog opens; confirm; a toast with Resume marketing appears; press it; a second toast says it resumed.

---

### Task 10: Three control tables and the job-run recorder (main app)

**Files:**
- Modify: `app/src/lib/db/control.ts`
- Create: `app/src/lib/platform/jobRuns.ts`
- Create: `app/src/lib/platform/jobRuns.test.ts`

**Interfaces:**
- Produces:

```ts
export interface JobRunRow { id: number; key: string; label: string; startedAt: number; finishedAt: number | null; ok: boolean | null; error: string | null; durationMs: number | null; detail: unknown }
export function recordJobRun<T>(key: string, label: string, fn: () => Promise<T> | T): Promise<T>  // rethrows after recording
export function listJobRuns(opts?: { key?: string; limit?: number }): JobRunRow[]
export function latestJobRuns(): JobRunRow[]  // one row per key, the most recent
```

Tables (control DB):

```sql
health_snapshots(id, tenant_id, at, db_bytes, wal_bytes, queue_due, queue_failed, stuck, alerts_bad, alerts_warn)
job_runs(id, key, label, started_at, finished_at, ok, error, duration_ms, detail)
platform_alerts(id, tenant_id NULL, key, level, title, detail, href, opened_at, last_seen_at, resolved_at, acknowledged_at, acknowledged_by, snoozed_until, assigned_to, notified_at, UNIQUE(tenant_id, key, resolved_at))
```

- [ ] **Step 1: Write the failing test**

`app/src/lib/platform/jobRuns.test.ts`:

```ts
// Run: npm test -- src/lib/platform/jobRuns.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { recordJobRun, listJobRuns, latestJobRuns } = requireLocal("./jobRuns") as typeof import("./jobRuns");

  const key = `test_job_${Date.now()}`;
  const cleanup = () => controlSqlite.prepare("DELETE FROM job_runs WHERE key LIKE 'test_job_%'").run();

  try {
    // 1. a run that succeeds records ok, a duration and the returned detail.
    const out = await recordJobRun(key, "Test job", async () => ({ sent: 3 }));
    assert.deepEqual(out, { sent: 3 });
    let rows = listJobRuns({ key });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].ok, true);
    assert.equal(rows[0].error, null);
    assert.ok(rows[0].durationMs !== null && rows[0].durationMs >= 0);
    assert.deepEqual(rows[0].detail, { sent: 3 });

    // 2. a run that throws records the error and rethrows.
    await assert.rejects(
      () => recordJobRun(key, "Test job", async () => { throw new Error("boom"); }),
      /boom/,
    );
    rows = listJobRuns({ key });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].ok, false);
    assert.equal(rows[0].error, "boom");

    // 3. latest gives one row per key, the newest.
    const latest = latestJobRuns().filter((r) => r.key === key);
    assert.equal(latest.length, 1);
    assert.equal(latest[0].ok, false);

    console.log("jobRuns.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npm test -- src/lib/platform/jobRuns.test.ts`
Expected: fails with `Cannot find module './jobRuns'`.

- [ ] **Step 3: Add the tables**

In `app/src/lib/db/control.ts`, inside `ensureControlTables`, find:

```
      PRIMARY KEY (tenant_id, ad_account_id, kind)
    );
```

and insert directly after it (still inside the same `exec` string):

```sql
    -- Console history (Tier 1 of the console upgrade). One health snapshot
    -- per active business per hour, one row per background job run, and the
    -- platform's own alert list, so the console can say "worse than last
    -- week" and "what needs me today" from stored facts.
    CREATE TABLE IF NOT EXISTS health_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      at INTEGER NOT NULL,
      db_bytes INTEGER NOT NULL DEFAULT 0,
      wal_bytes INTEGER NOT NULL DEFAULT 0,
      queue_due INTEGER NOT NULL DEFAULT 0,
      queue_failed INTEGER NOT NULL DEFAULT 0,
      stuck INTEGER NOT NULL DEFAULT 0,
      alerts_bad INTEGER NOT NULL DEFAULT 0,
      alerts_warn INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_health_snapshots_tenant_at ON health_snapshots(tenant_id, at);

    CREATE TABLE IF NOT EXISTS job_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL,
      label TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      ok INTEGER,
      error TEXT,
      duration_ms INTEGER,
      detail TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_job_runs_key_started ON job_runs(key, started_at);

    CREATE TABLE IF NOT EXISTS platform_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('warn','bad')),
      title TEXT NOT NULL,
      detail TEXT,
      href TEXT,
      opened_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      resolved_at INTEGER,
      acknowledged_at INTEGER,
      acknowledged_by INTEGER REFERENCES users(id),
      snoozed_until INTEGER,
      assigned_to INTEGER REFERENCES users(id),
      notified_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_platform_alerts_open ON platform_alerts(resolved_at, level, opened_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_alerts_open_key ON platform_alerts(COALESCE(tenant_id, 0), key) WHERE resolved_at IS NULL;
```

- [ ] **Step 4: Write the recorder**

`app/src/lib/platform/jobRuns.ts`:

```ts
import "server-only";

import { controlSqlite } from "@/lib/db/control";

/**
 * One row per background job run. Wrap a job in `recordJobRun` and the
 * console's Jobs page (Tier 3) can show when it last ran, how long it took
 * and why it failed. A failure is recorded and rethrown, so the job's own
 * retry logic is unchanged.
 */
export interface JobRunRow {
  id: number;
  key: string;
  label: string;
  startedAt: number;
  finishedAt: number | null;
  ok: boolean | null;
  error: string | null;
  durationMs: number | null;
  detail: unknown;
}

export async function recordJobRun<T>(key: string, label: string, fn: () => Promise<T> | T): Promise<T> {
  const startedAt = Date.now();
  const id = Number(
    controlSqlite
      .prepare("INSERT INTO job_runs (key, label, started_at) VALUES (?, ?, ?)")
      .run(key, label, startedAt).lastInsertRowid,
  );
  try {
    const out = await fn();
    const finishedAt = Date.now();
    controlSqlite
      .prepare("UPDATE job_runs SET finished_at = ?, ok = 1, duration_ms = ?, detail = ? WHERE id = ?")
      .run(finishedAt, finishedAt - startedAt, out === undefined ? null : safeJson(out), id);
    return out;
  } catch (err) {
    const finishedAt = Date.now();
    controlSqlite
      .prepare("UPDATE job_runs SET finished_at = ?, ok = 0, duration_ms = ?, error = ? WHERE id = ?")
      .run(finishedAt, finishedAt - startedAt, err instanceof Error ? err.message : String(err), id);
    throw err;
  }
}

function safeJson(v: unknown): string | null {
  try {
    return JSON.stringify(v);
  } catch {
    return null;
  }
}

type Raw = {
  id: number; key: string; label: string; started_at: number; finished_at: number | null;
  ok: number | null; error: string | null; duration_ms: number | null; detail: string | null;
};

function toRow(r: Raw): JobRunRow {
  let detail: unknown = null;
  if (r.detail) {
    try { detail = JSON.parse(r.detail); } catch { detail = r.detail; }
  }
  return {
    id: r.id, key: r.key, label: r.label, startedAt: r.started_at, finishedAt: r.finished_at,
    ok: r.ok === null ? null : r.ok === 1, error: r.error, durationMs: r.duration_ms, detail,
  };
}

/** Newest first. */
export function listJobRuns(opts: { key?: string; limit?: number } = {}): JobRunRow[] {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 50));
  const rows = opts.key
    ? controlSqlite.prepare("SELECT * FROM job_runs WHERE key = ? ORDER BY started_at DESC, id DESC LIMIT ?").all(opts.key, limit)
    : controlSqlite.prepare("SELECT * FROM job_runs ORDER BY started_at DESC, id DESC LIMIT ?").all(limit);
  return (rows as Raw[]).map(toRow);
}

/** The most recent run of every job that has ever run. */
export function latestJobRuns(): JobRunRow[] {
  const rows = controlSqlite
    .prepare(
      `SELECT j.* FROM job_runs j
       JOIN (SELECT key, MAX(id) AS id FROM job_runs GROUP BY key) m ON m.id = j.id
       ORDER BY j.key`,
    )
    .all() as Raw[];
  return rows.map(toRow);
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `cd app && npm test -- src/lib/platform/jobRuns.test.ts`
Expected: `jobRuns.test.ts: ok`.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/db/control.ts app/src/lib/platform/jobRuns.ts app/src/lib/platform/jobRuns.test.ts
git commit -m "feat(platform): health_snapshots, job_runs and platform_alerts tables; job-run recorder

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Health snapshots and alert sync, run hourly

**Files:**
- Modify: `app/src/lib/platform/health.ts` (`HealthAlert` gains `key`)
- Create: `app/src/lib/platform/healthHistory.ts`
- Create: `app/src/lib/platform/healthHistory.test.ts`
- Create: `app/src/lib/platform/healthScheduler.ts`
- Modify: `app/src/app/layout.tsx`

**Interfaces:**
- Consumes: `getFleetHealth()`, `getTenantHealth()` from `./health`; `recordJobRun` from `./jobRuns`.
- Produces:

```ts
export interface AlertCandidate { tenantId: number | null; key: string; level: "warn" | "bad"; title: string; detail?: string | null; href?: string | null }
export function syncPlatformAlerts(candidates: AlertCandidate[], now?: number): { opened: number; resolved: number; seen: number }
export function snapshotFleetHealth(now?: number): { tenants: number; opened: number; resolved: number }
export function listHealthHistory(tenantId: number, sinceMs: number): HealthSnapshotRow[]
```

`HealthAlert` becomes `{ key: string; level: "warn" | "bad"; message: string }`.

- [ ] **Step 1: Give every health alert a stable key**

In `app/src/lib/platform/health.ts` change the interface:

```ts
export interface HealthAlert {
  /** Stable across runs, so the same problem is one alert, not one per hour. */
  key: string;
  level: Exclude<AlertLevel, "ok">;
  message: string;
}
```

and the alert pushes in `getTenantHealth`:

```ts
  const alerts: HealthAlert[] = [];
  if (!dbExists) alerts.push({ key: "db_missing", level: "bad", message: "The database file is missing." });
  if (integrity === "failed") alerts.push({ key: "integrity", level: "bad", message: `Integrity check failed: ${integrityDetail ?? "unknown"}` });
  if (migrations.missing.length > 0) {
    alerts.push({ key: "migrations", level: "warn", message: `${migrations.missing.length} migration(s) have not run: ${migrations.missing.join(", ")}` });
  }
  if (walBytes > 8 * 1024 * 1024 && walBytes > dbBytes) {
    alerts.push({ key: "wal", level: "warn", message: "The write-ahead log is larger than the database; checkpoints may not be landing." });
  }
  for (const q of queues) {
    if (q.failed > 0) alerts.push({ key: `queue_failed:${q.key}`, level: "warn", message: `${q.failed} failed in ${q.label.toLowerCase()}.` });
  }
  if (stuckGenerations > 0) {
    alerts.push({ key: "stuck_generations", level: "warn", message: `${stuckGenerations} design(s) stuck mid-generation.` });
  }
```

and in `getFleetHealth`'s catch: `alerts: [{ key: "unreadable", level: "bad", message: err instanceof Error ? err.message : "Health could not be read." }]`.

Run: `cd app && npx tsc --noEmit -p . 2>&1 | head`
Expected: errors only where an object literal builds a `HealthAlert` without `key` (the health test, if any). Add `key` there too. The console's `HealthAlert` type (`admin/src/lib/types.ts`) is structurally compatible (extra field); leave it until Tier 3.

- [ ] **Step 2: Write the failing test**

`app/src/lib/platform/healthHistory.test.ts`:

```ts
// Run: npm test -- src/lib/platform/healthHistory.test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { syncPlatformAlerts } = requireLocal("./healthHistory") as typeof import("./healthHistory");

  const slug = "health-history-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Health History Test", `tenants/${slug}/void.db`) as { id: number };
  const tid = t.id;
  const open = () =>
    controlSqlite.prepare("SELECT key, level, resolved_at, opened_at, last_seen_at FROM platform_alerts WHERE tenant_id = ? ORDER BY key").all(tid) as Array<{ key: string; level: string; resolved_at: number | null; opened_at: number; last_seen_at: number }>;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM platform_alerts WHERE tenant_id = ?").run(tid);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
  };

  try {
    // 1. a new problem opens one alert.
    let r = syncPlatformAlerts([{ tenantId: tid, key: "wal", level: "warn", title: "WAL too big" }], 1000);
    assert.deepEqual(r, { opened: 1, resolved: 0, seen: 0 });
    assert.equal(open().length, 1);
    assert.equal(open()[0].opened_at, 1000);

    // 2. the same problem an hour later is the same alert, seen again.
    r = syncPlatformAlerts([{ tenantId: tid, key: "wal", level: "warn", title: "WAL too big" }], 2000);
    assert.deepEqual(r, { opened: 0, resolved: 0, seen: 1 });
    assert.equal(open().length, 1);
    assert.equal(open()[0].last_seen_at, 2000);

    // 3. when it stops being reported it is resolved, and a new one can open later.
    r = syncPlatformAlerts([], 3000);
    assert.deepEqual(r, { opened: 0, resolved: 1, seen: 0 });
    assert.equal(open()[0].resolved_at, 3000);
    r = syncPlatformAlerts([{ tenantId: tid, key: "wal", level: "bad", title: "WAL too big" }], 4000);
    assert.deepEqual(r, { opened: 1, resolved: 0, seen: 0 });
    assert.equal(open().length, 2);

    // 4. a sync scoped to one tenant leaves the others alone.
    r = syncPlatformAlerts([], 5000, { tenantIds: [tid + 100000] });
    assert.deepEqual(r, { opened: 0, resolved: 0, seen: 0 });
    assert.equal(open().filter((a) => a.resolved_at === null).length, 1);

    console.log("healthHistory.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd app && npm test -- src/lib/platform/healthHistory.test.ts`
Expected: fails with `Cannot find module './healthHistory'`.

- [ ] **Step 4: Write the module**

`app/src/lib/platform/healthHistory.ts`:

```ts
import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { getFleetHealth, getTenantHealth } from "./health";

/**
 * Health over time. `snapshotFleetHealth` runs hourly: one row per active
 * business in health_snapshots, and the platform_alerts list reconciled
 * against what the health sweep reports right now. An alert is one row from
 * the hour it appears to the hour it stops appearing; the console reads
 * open rows as the inbox and resolved rows as history.
 */
export interface AlertCandidate {
  tenantId: number | null;
  key: string;
  level: "warn" | "bad";
  title: string;
  detail?: string | null;
  href?: string | null;
}

export interface HealthSnapshotRow {
  at: number;
  dbBytes: number;
  walBytes: number;
  queueDue: number;
  queueFailed: number;
  stuck: number;
  alertsBad: number;
  alertsWarn: number;
}

/**
 * Reconcile: open what is new, touch what is still there, resolve what has
 * gone. `scope.tenantIds` limits the resolve step to those tenants (plus
 * platform-wide alerts when `scope.platform` is true), so a sync that only
 * looked at some tenants cannot resolve the others' alerts. With no scope,
 * every open alert is in play.
 */
export function syncPlatformAlerts(
  candidates: AlertCandidate[],
  now: number = Date.now(),
  scope?: { tenantIds?: number[]; platform?: boolean },
): { opened: number; resolved: number; seen: number } {
  const openRows = controlSqlite
    .prepare("SELECT id, tenant_id, key, level FROM platform_alerts WHERE resolved_at IS NULL")
    .all() as Array<{ id: number; tenant_id: number | null; key: string; level: string }>;
  const idOf = (tenantId: number | null, key: string) => `${tenantId ?? 0}|${key}`;
  const open = new Map(openRows.map((r) => [idOf(r.tenant_id, r.key), r]));
  const inScope = (tenantId: number | null) =>
    !scope ||
    (tenantId === null ? scope.platform === true : (scope.tenantIds ?? []).includes(tenantId));

  let opened = 0;
  let seen = 0;
  const kept = new Set<string>();
  const tx = controlSqlite.transaction(() => {
    for (const c of candidates) {
      const k = idOf(c.tenantId, c.key);
      kept.add(k);
      const existing = open.get(k);
      if (existing) {
        controlSqlite
          .prepare("UPDATE platform_alerts SET last_seen_at = ?, level = ?, title = ?, detail = ?, href = ? WHERE id = ?")
          .run(now, c.level, c.title, c.detail ?? null, c.href ?? null, existing.id);
        seen++;
      } else {
        controlSqlite
          .prepare(
            `INSERT INTO platform_alerts (tenant_id, key, level, title, detail, href, opened_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(c.tenantId, c.key, c.level, c.title, c.detail ?? null, c.href ?? null, now, now);
        opened++;
      }
    }
    let resolved = 0;
    for (const r of openRows) {
      const k = idOf(r.tenant_id, r.key);
      if (kept.has(k) || !inScope(r.tenant_id)) continue;
      controlSqlite.prepare("UPDATE platform_alerts SET resolved_at = ? WHERE id = ?").run(now, r.id);
      resolved++;
    }
    return resolved;
  });
  const resolved = tx();
  return { opened, resolved, seen };
}

/** One snapshot per active business, then the alert list reconciled. */
export function snapshotFleetHealth(now: number = Date.now()): { tenants: number; opened: number; resolved: number } {
  const fleet = getFleetHealth();
  const candidates: AlertCandidate[] = [];
  const tenantIds: number[] = [];
  const insert = controlSqlite.prepare(
    `INSERT INTO health_snapshots (tenant_id, at, db_bytes, wal_bytes, queue_due, queue_failed, stuck, alerts_bad, alerts_warn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const row of fleet.tenants) {
    tenantIds.push(row.tenantId);
    let h;
    try {
      h = getTenantHealth(row.tenantId);
    } catch {
      continue;
    }
    insert.run(
      row.tenantId,
      now,
      h.dbBytes,
      h.walBytes,
      h.queues.reduce((n, q) => n + q.due, 0),
      h.queues.reduce((n, q) => n + q.failed, 0),
      h.stuckGenerations,
      h.alerts.filter((a) => a.level === "bad").length,
      h.alerts.filter((a) => a.level === "warn").length,
    );
    for (const a of h.alerts) {
      candidates.push({
        tenantId: row.tenantId,
        key: `health:${a.key}`,
        level: a.level,
        title: a.message,
        href: `/gyms/${row.tenantId}/health`,
      });
    }
  }
  for (const d of fleet.duplicateSiteSlugs) {
    candidates.push({
      tenantId: null,
      key: `site_slug:${d.slug}`,
      level: "bad",
      title: `Site slug "${d.slug}" is used by ${d.owners.length} businesses; only ${d.servedBy} is reachable.`,
      href: "/health",
    });
  }
  const r = syncPlatformAlerts(candidates, now, { tenantIds, platform: true });
  return { tenants: fleet.tenants.length, opened: r.opened, resolved: r.resolved };
}

export function listHealthHistory(tenantId: number, sinceMs: number): HealthSnapshotRow[] {
  const rows = controlSqlite
    .prepare(
      `SELECT at, db_bytes, wal_bytes, queue_due, queue_failed, stuck, alerts_bad, alerts_warn
       FROM health_snapshots WHERE tenant_id = ? AND at >= ? ORDER BY at`,
    )
    .all(tenantId, sinceMs) as Array<{
    at: number; db_bytes: number; wal_bytes: number; queue_due: number; queue_failed: number; stuck: number; alerts_bad: number; alerts_warn: number;
  }>;
  return rows.map((r) => ({
    at: r.at, dbBytes: r.db_bytes, walBytes: r.wal_bytes, queueDue: r.queue_due, queueFailed: r.queue_failed,
    stuck: r.stuck, alertsBad: r.alerts_bad, alertsWarn: r.alerts_warn,
  }));
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `cd app && npm test -- src/lib/platform/healthHistory.test.ts`
Expected: `healthHistory.test.ts: ok`.

- [ ] **Step 6: The hourly scheduler**

`app/src/lib/platform/healthScheduler.ts`:

```ts
import "server-only";

import { recordJobRun } from "./jobRuns";
import { snapshotFleetHealth } from "./healthHistory";

let armed = false;
let running = false;

/**
 * Every hour, on the hour, plus once a minute after boot so a fresh deploy
 * has a row straight away. The same self-starting shape as the dispatch
 * ticker: a side-effect import from app/layout.tsx arms it once per process.
 */
async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  try {
    await recordJobRun("health_snapshot", "Health snapshot", () => snapshotFleetHealth());
  } catch (err) {
    console.error("[health] snapshot failed:", err);
  } finally {
    running = false;
  }
}

export function startHealthScheduler(): void {
  if (armed || process.env.NEXT_PHASE === "phase-production-build") return;
  armed = true;
  const boot = setTimeout(() => void runOnce(), 60 * 1000);
  boot.unref();
  const armNext = () => {
    const now = Date.now();
    const next = Math.ceil(now / 3600000) * 3600000;
    const t = setTimeout(() => {
      void runOnce().finally(armNext);
    }, next - now);
    t.unref();
  };
  armNext();
  console.log("[health] hourly snapshot scheduler armed");
}

startHealthScheduler();
```

In `app/src/app/layout.tsx`, next to the other side-effect imports (`import "@/lib/dispatch/ticker";`), add:

```ts
// Hourly health snapshots + platform alert sync for the console (Tier 1).
import "@/lib/platform/healthScheduler";
```

- [ ] **Step 7: Typecheck and commit**

Run: `cd app && npx tsc --noEmit -p .`
Expected: no output.

```bash
git add app/src/lib/platform/health.ts app/src/lib/platform/healthHistory.ts app/src/lib/platform/healthHistory.test.ts app/src/lib/platform/healthScheduler.ts app/src/app/layout.tsx
git commit -m "feat(platform): hourly health snapshots and a reconciled platform alert list

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Existing jobs record their runs

**Files:**
- Modify: `app/src/lib/automations/scheduler.ts`
- Modify: `app/src/lib/pipeline/lapseScheduler.ts`
- Modify: `app/src/lib/backup/scheduler.ts`

**Interfaces:**
- Consumes: `recordJobRun` from `@/lib/platform/jobRuns`.
- Produces job keys: `daily_automations`, `billing_run`, `lapse_sweep`, `nightly_backup`, `health_snapshot` (Task 11).

- [ ] **Step 1: Daily automations and the billing run**

In `app/src/lib/automations/scheduler.ts` add the import:

```ts
import { recordJobRun } from "@/lib/platform/jobRuns";
```

In `startScheduler`'s tick, change `await runDailyAutomations();` to:

```ts
      await recordJobRun("daily_automations", "Daily automations", runDailyAutomations);
```

and change `const summary = await runBillingForDate(today);` (line 297) to:

```ts
      const summary = await recordJobRun("billing_run", "Billing run", () => runBillingForDate(today));
```

- [ ] **Step 2: The lapse sweep**

In `app/src/lib/pipeline/lapseScheduler.ts` add the import, and inside `runDailyLapseIfNeeded` wrap the call that does the sweep (the `recomputeLapsedAllTenants()` call, after the claim succeeds):

```ts
import { recordJobRun } from "@/lib/platform/jobRuns";
```

```ts
      void recordJobRun("lapse_sweep", "Lapsed-member sweep", () => recomputeLapsedAllTenants()).catch((err) =>
        console.error("[pipeline] lapse sweep failed:", err),
      );
```

(Keep the surrounding claim/reset logic exactly as it is; only the call is wrapped. If the sweep's result was used after the call, keep using it: `const r = await recordJobRun(...)` inside an async context.)

- [ ] **Step 3: The nightly backup**

In `app/src/lib/backup/scheduler.ts` add the import and change `const r = await runBackup();` to:

```ts
import { recordJobRun } from "@/lib/platform/jobRuns";
```

```ts
    const r = await recordJobRun("nightly_backup", "Nightly backup", async () => {
      const res = await runBackup();
      // The backup reports failure as a value; the run should read as failed too.
      if (!res.ok) throw new Error(res.error ?? "Backup failed");
      return res;
    }).catch((err) => ({ ok: false as const, error: err instanceof Error ? err.message : String(err) }));
```

Check that `runBackup`'s result type has `ok` and `error` fields (`grep -n "ok:" src/lib/backup/runBackup.ts | head`); if the error field has a different name, use it.

- [ ] **Step 4: Typecheck, test, build**

Run: `cd app && npx tsc --noEmit -p . && npm test 2>&1 | tail -2 && rm -rf .next && npx next build 2>&1 | tail -2`
Expected: no type errors; all test files pass; the build completes.

- [ ] **Step 5: Commit, push, deploy the app**

```bash
git add app/src/lib/automations/scheduler.ts app/src/lib/pipeline/lapseScheduler.ts app/src/lib/backup/scheduler.ts
git commit -m "feat(platform): daily automations, billing, lapse sweep and backup record their runs

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push origin main
cd app && railway up --detach
```

- [ ] **Step 6: Verify in production**

After the deployment shows `SUCCESS`: `curl -s https://app.adonisagent.ie/api/health` returns `{"ok":true,…}`. Then `cd app && railway logs --since 5m -n 200 | grep -E "\[health\]|\[scheduler\]"` shows `hourly snapshot scheduler armed`. Two minutes after boot the `health_snapshot` job has run once; from then on, hourly. The console shows none of this yet; Tier 3 reads it.

---

## Self-review

**Spec coverage.** Streaming pages with skeletons: Task 6 (`loading.tsx` at both levels; hover prefetch follows from it). Error and not-found pages: Task 6. Toasts: Tasks 2, 4, 5. Proper confirm dialogs with type-to-confirm: Tasks 3, 4, 5. Undo on revoke, suspend: Tasks 4 (four suspends), 5 (revoke access). Prefetch + 30-second cache: Task 7. Keyboard shortcuts: Task 8. Storage tables + writers so history accumulates: Tasks 10, 11, 12. Deploys: Tasks 9 and 12.

**Placeholders.** None. Task 5 Step 5 says "keep the existing function's name if it differs" for DataPanel's delete function; the body is given in full. Task 12 Step 3 asks the implementer to check one field name on `runBackup`'s result; the code for both outcomes is given.

**Type consistency.** `notify.ok/fail/undo` (Task 2) are used with those names in Tasks 4 and 5. `useConfirm` returns `{ ok: true; value } | { ok: false }` (Task 3) and every caller branches on `r.ok` and reads `r.value` (Tasks 4, 5). `bust(tenantId?)` (Task 7). `HealthAlert.key` (Task 11) is consumed by `snapshotFleetHealth` as `health:${a.key}`. `recordJobRun(key, label, fn)` (Task 10) is called with that argument order in Tasks 11 and 12.
