# Console Tier 4: Know the Customer. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One screen tells a business's whole story: its lifecycle stage, who on the platform side owns it, tags, notes, tasks with due dates, how far through setup it is, which modules it actually uses, and a churn-risk score with reasons. Feature flags gain staged rollout (percentage, allowlist) so a new module can go to three businesses first.

**Architecture:** Four small control-plane tables (`tenant_meta`, `tenant_notes`, `platform_tasks`, `module_usage`) plus one for rollouts (`platform_flags`). Module usage is counted from the app's own root layout (which already knows the tenant and the path) through an in-memory buffer flushed every minute. Churn risk is a pure scoring function over facts the control plane already holds (last login, usage, billing, integrations, alerts, setup). Rollout flags are applied inside the existing `getFeatureFlags*` readers so the app's module gate and sidebar need no change.

**Tech Stack:** As Tiers 1 to 3. No new dependencies.

## Global Constraints

- Everything in the earlier tiers' Global Constraints.
- Notes and tasks are platform-side records about a business; nothing here is shown to the business.
- A tenant's own explicit `false` flag always wins over any platform rollout.
- Usage counting never adds a database write to a request: it buffers in memory and flushes on a timer.

---

## File structure

**app/**

| File | Responsibility |
|---|---|
| `src/lib/db/control.ts` (modify) | Tables `tenant_meta`, `tenant_notes`, `platform_tasks`, `module_usage`, `platform_flags`. |
| `src/lib/platform/tenantMeta.ts` + `.test.ts` (create) | Stage, owner, tags; `defaultStage(facts)`. |
| `src/lib/platform/notes.ts` (create) | Notes CRUD. |
| `src/lib/platform/tasks.ts` + `.test.ts` (create) | Tasks CRUD, `dueBuckets`. |
| `src/lib/setup/steps.ts` (modify) | `getSetupSummaryForTenant(tenantId)`. |
| `src/lib/setup/forTenant.test.ts` (create) | |
| `src/lib/analytics/moduleUsage.ts` + `.test.ts` (create) | `noteModuleVisit`, `flushModuleUsage`, `usageByModule`. |
| `src/app/layout.tsx` (modify) | Calls `noteModuleVisit` at the module gate. |
| `src/lib/platform/churnRisk.ts` + `.test.ts` (create) | Pure score + reasons; `riskFacts(tenantId)`. |
| `src/lib/platform/alertSources.ts` (modify) | `churn:high` alert; tasks due today. |
| `src/lib/features.ts` (modify) | `PlatformFlag`, `applyRollout(flags, platform, tenantId)`. |
| `src/lib/features.test.ts` (modify or create) | |
| `src/lib/platform/flags.ts` (create) | Read/write `platform_flags`. |
| `src/lib/settings.ts` (modify) | `getFeatureFlags*` apply rollouts. |
| `src/app/api/platform/tenants/[id]/meta/route.ts`, `notes/route.ts`, `tasks/route.ts`, `usage/route.ts` (create) | |
| `src/app/api/platform/tasks/route.ts` (create) | Cross-tenant task list. |
| `src/app/api/platform/flags/route.ts` (create) | |
| `src/app/api/platform/tenants/[id]/route.ts`, `fleet/route.ts` (modify) | Include `meta`, `setup`, `risk`. |

**admin/**

| File | Responsibility |
|---|---|
| `src/lib/types.ts` (modify) | New types. |
| `src/components/business/Properties.tsx` (create) | Stage, owner, tags strip under the business header. |
| `src/components/business/Notes.tsx`, `Tasks.tsx`, `SetupProgress.tsx`, `UsagePanel.tsx`, `RiskCard.tsx` (create) | Overview cards. |
| `src/app/(console)/gyms/[id]/business-actions.ts` (create) | Server actions for meta, notes, tasks. |
| `src/app/(console)/gyms/[id]/layout.tsx`, `page.tsx` (modify) | Properties strip; Overview rebuilt. |
| `src/components/BusinessesTable.tsx` (modify) | Setup, Risk, Stage columns. |
| `src/app/(console)/inbox/page.tsx` (modify) | Tasks due section. |
| `src/components/features/FeaturesPanel.tsx` (modify) | Last-used beside each module. |
| `src/app/(console)/flags/page.tsx`, `actions.ts`, `src/components/flags/FlagEditor.tsx` (create) | Rollout page. |
| `src/components/Shell.tsx`, `src/lib/shortcuts.ts`, `src/lib/palette.ts` (modify) | Flags in nav; `g f`. |
| `src/app/globals.css` (modify) | |

---

### Task 1: Tables, tenant meta, notes, tasks (main app)

**Files:**
- Modify: `app/src/lib/db/control.ts`
- Create: `app/src/lib/platform/tenantMeta.ts`, `app/src/lib/platform/tenantMeta.test.ts`, `app/src/lib/platform/notes.ts`, `app/src/lib/platform/tasks.ts`, `app/src/lib/platform/tasks.test.ts`

**Interfaces:**

```ts
// tenantMeta.ts
export type Stage = "trial" | "onboarding" | "active" | "at_risk" | "churned";
export interface TenantMeta { tenantId: number; stage: Stage | null; stageAuto: Stage; ownerUserId: number | null; tags: string[]; updatedAt: number | null }
export interface StageFacts { archived: boolean; billingStatus: string | null; exempt: boolean; setupRequiredDone: number; setupRequiredTotal: number; riskScore: number }
export function defaultStage(f: StageFacts): Stage
export function getTenantMeta(tenantId: number, facts: StageFacts): TenantMeta
export function setTenantMeta(tenantId: number, patch: { stage?: Stage | null; ownerUserId?: number | null; tags?: string[] }): void

// notes.ts
export interface Note { id: number; tenantId: number; authorUserId: number; authorEmail: string; body: string; pinned: boolean; createdAt: number }
export function listNotes(tenantId: number): Note[]   // pinned first, then newest
export function addNote(tenantId: number, authorUserId: number, body: string): Note
export function setNotePinned(id: number, pinned: boolean): void
export function deleteNote(id: number, byUserId: number, isOwner: boolean): { ok: true } | { ok: false; error: string }

// tasks.ts
export interface Task { id: number; tenantId: number | null; tenantName: string | null; title: string; dueAt: number | null; assignedTo: number | null; doneAt: number | null; createdBy: number; createdAt: number }
export function listTasks(opts: { tenantId?: number; assignedTo?: number; open?: boolean }): Task[]
export function addTask(input: { tenantId: number | null; title: string; dueAt: number | null; assignedTo: number | null; createdBy: number }): Task
export function setTaskDone(id: number, done: boolean): void
export function deleteTask(id: number): void
export function dueBuckets(tasks: Task[], now: number): { overdue: Task[]; today: Task[]; later: Task[]; undated: Task[] }
```

- [ ] **Step 1: Write the failing tests**

`app/src/lib/platform/tenantMeta.test.ts`:

```ts
// Run: npm test -- src/lib/platform/tenantMeta.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { defaultStage, getTenantMeta, setTenantMeta } = requireLocal("./tenantMeta") as typeof import("./tenantMeta");

  const base = { archived: false, billingStatus: "active", exempt: false, setupRequiredDone: 4, setupRequiredTotal: 4, riskScore: 10 };
  assert.equal(defaultStage(base), "active");
  assert.equal(defaultStage({ ...base, archived: true }), "churned");
  assert.equal(defaultStage({ ...base, billingStatus: "cancelled" }), "churned");
  assert.equal(defaultStage({ ...base, billingStatus: "pending_payment" }), "trial");
  assert.equal(defaultStage({ ...base, setupRequiredDone: 2 }), "onboarding");
  assert.equal(defaultStage({ ...base, riskScore: 65 }), "at_risk");
  assert.equal(defaultStage({ ...base, exempt: true, billingStatus: null }), "active", "an agency account with setup done is active");

  const slug = "meta-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, 'Meta Test', ?, 1) RETURNING id").get(slug, `tenants/${slug}/void.db`) as { id: number };
  try {
    let m = getTenantMeta(t.id, base);
    assert.equal(m.stage, null);
    assert.equal(m.stageAuto, "active");
    assert.deepEqual(m.tags, []);
    setTenantMeta(t.id, { stage: "at_risk", tags: ["vip", " VIP ", "", "slow-payer"] });
    m = getTenantMeta(t.id, base);
    assert.equal(m.stage, "at_risk");
    assert.deepEqual(m.tags, ["vip", "slow-payer"], "tags are trimmed, lowercased, deduplicated");
    setTenantMeta(t.id, { ownerUserId: 1 });
    m = getTenantMeta(t.id, base);
    assert.equal(m.ownerUserId, 1);
    assert.equal(m.stage, "at_risk", "a partial patch leaves other fields alone");
    setTenantMeta(t.id, { stage: null });
    assert.equal(getTenantMeta(t.id, base).stage, null);
    console.log("tenantMeta.test.ts: ok");
  } finally {
    controlSqlite.prepare("DELETE FROM tenant_meta WHERE tenant_id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
  }
})().catch((e) => { console.error(e); process.exit(1); });
```

`app/src/lib/platform/tasks.test.ts`:

```ts
// Run: npm test -- src/lib/platform/tasks.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { addTask, listTasks, setTaskDone, deleteTask, dueBuckets } = requireLocal("./tasks") as typeof import("./tasks");

  const day = 86400000;
  const now = Date.UTC(2026, 10, 11, 12);
  const mk = (title: string, dueAt: number | null) => ({ id: 0, tenantId: null, tenantName: null, title, dueAt, assignedTo: null, doneAt: null, createdBy: 1, createdAt: 0 });
  const b = dueBuckets([mk("late", now - day), mk("today", now + 3600000), mk("soon", now + 3 * day), mk("none", null)], now);
  assert.deepEqual(b.overdue.map((t) => t.title), ["late"]);
  assert.deepEqual(b.today.map((t) => t.title), ["today"]);
  assert.deepEqual(b.later.map((t) => t.title), ["soon"]);
  assert.deepEqual(b.undated.map((t) => t.title), ["none"]);

  const cleanup = () => controlSqlite.prepare("DELETE FROM platform_tasks WHERE title LIKE 'tasktest %'").run();
  cleanup();
  try {
    const t1 = addTask({ tenantId: null, title: "tasktest a", dueAt: now + day, assignedTo: 1, createdBy: 1 });
    const t2 = addTask({ tenantId: null, title: "tasktest b", dueAt: null, assignedTo: null, createdBy: 1 });
    assert.equal(listTasks({ open: true }).filter((t) => t.title.startsWith("tasktest")).length, 2);
    assert.equal(listTasks({ assignedTo: 1, open: true }).filter((t) => t.title.startsWith("tasktest")).length, 1);
    setTaskDone(t1.id, true);
    assert.equal(listTasks({ open: true }).filter((t) => t.title.startsWith("tasktest")).length, 1);
    assert.ok(listTasks({}).find((t) => t.id === t1.id)?.doneAt);
    deleteTask(t2.id);
    assert.equal(listTasks({}).filter((t) => t.title.startsWith("tasktest")).length, 1);
    console.log("tasks.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd app && npm test -- src/lib/platform/tenantMeta.test.ts; npm test -- src/lib/platform/tasks.test.ts`
Expected: both `Cannot find module`.

- [ ] **Step 3: Tables**

In `app/src/lib/db/control.ts`, directly after the `platform_alerts` block added in Tier 1 (still inside the same `exec` string), add:

```sql
    -- Console Tier 4: what the platform knows about a business beyond its
    -- data. Stage/owner/tags, staff notes, tasks, which modules get used,
    -- and staged rollouts of modules.
    CREATE TABLE IF NOT EXISTS tenant_meta (
      tenant_id INTEGER PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      stage TEXT CHECK (stage IN ('trial','onboarding','active','at_risk','churned')),
      owner_user_id INTEGER REFERENCES users(id),
      tags TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS tenant_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      author_user_id INTEGER NOT NULL REFERENCES users(id),
      body TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_notes_tenant ON tenant_notes(tenant_id, pinned, created_at);
    CREATE TABLE IF NOT EXISTS platform_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due_at INTEGER,
      assigned_to INTEGER REFERENCES users(id),
      done_at INTEGER,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_platform_tasks_open ON platform_tasks(done_at, due_at);
    CREATE TABLE IF NOT EXISTS module_usage (
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      module_key TEXT NOT NULL,
      day TEXT NOT NULL,
      hits INTEGER NOT NULL DEFAULT 0,
      last_at INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, module_key, day)
    );
    CREATE TABLE IF NOT EXISTS platform_flags (
      key TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'all' CHECK (mode IN ('all','none','percent','allow')),
      percent INTEGER NOT NULL DEFAULT 100,
      allow TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );
```

- [ ] **Step 4: The three modules**

`app/src/lib/platform/tenantMeta.ts`:

```ts
import "server-only";

import { controlSqlite } from "@/lib/db/control";

/**
 * The platform's own view of a business: where it is in its life, who on
 * the platform side looks after it, and free tags. The stage is computed
 * from facts unless somebody has set it by hand; the console shows both.
 */
export type Stage = "trial" | "onboarding" | "active" | "at_risk" | "churned";
export const STAGES: Stage[] = ["trial", "onboarding", "active", "at_risk", "churned"];

export interface TenantMeta {
  tenantId: number;
  stage: Stage | null;
  stageAuto: Stage;
  ownerUserId: number | null;
  tags: string[];
  updatedAt: number | null;
}

export interface StageFacts {
  archived: boolean;
  billingStatus: string | null;
  exempt: boolean;
  setupRequiredDone: number;
  setupRequiredTotal: number;
  riskScore: number;
}

export function defaultStage(f: StageFacts): Stage {
  if (f.archived || f.billingStatus === "cancelled") return "churned";
  if (!f.exempt && f.billingStatus === "pending_payment") return "trial";
  if (f.setupRequiredDone < f.setupRequiredTotal) return "onboarding";
  if (f.riskScore >= 60 || f.billingStatus === "suspended" || f.billingStatus === "past_due") return "at_risk";
  return "active";
}

export function cleanTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim().toLowerCase().slice(0, 30);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 20);
}

export function getTenantMeta(tenantId: number, facts: StageFacts): TenantMeta {
  const row = controlSqlite.prepare("SELECT stage, owner_user_id, tags, updated_at FROM tenant_meta WHERE tenant_id = ?").get(tenantId) as
    | { stage: Stage | null; owner_user_id: number | null; tags: string; updated_at: number | null }
    | undefined;
  let tags: string[] = [];
  try { tags = row ? cleanTags(JSON.parse(row.tags) as string[]) : []; } catch { tags = []; }
  return { tenantId, stage: row?.stage ?? null, stageAuto: defaultStage(facts), ownerUserId: row?.owner_user_id ?? null, tags, updatedAt: row?.updated_at ?? null };
}

export function setTenantMeta(tenantId: number, patch: { stage?: Stage | null; ownerUserId?: number | null; tags?: string[] }): void {
  controlSqlite.prepare("INSERT OR IGNORE INTO tenant_meta (tenant_id, updated_at) VALUES (?, ?)").run(tenantId, Date.now());
  const sets: string[] = ["updated_at = ?"];
  const args: unknown[] = [Date.now()];
  if (patch.stage !== undefined) { sets.push("stage = ?"); args.push(patch.stage); }
  if (patch.ownerUserId !== undefined) { sets.push("owner_user_id = ?"); args.push(patch.ownerUserId); }
  if (patch.tags !== undefined) { sets.push("tags = ?"); args.push(JSON.stringify(cleanTags(patch.tags))); }
  args.push(tenantId);
  controlSqlite.prepare(`UPDATE tenant_meta SET ${sets.join(", ")} WHERE tenant_id = ?`).run(...args);
}
```

`app/src/lib/platform/notes.ts`:

```ts
import "server-only";

import { controlSqlite } from "@/lib/db/control";

/** Free-text notes platform staff leave on a business. Pinned ones stay on top. */
export interface Note {
  id: number;
  tenantId: number;
  authorUserId: number;
  authorEmail: string;
  body: string;
  pinned: boolean;
  createdAt: number;
}

type Raw = { id: number; tenant_id: number; author_user_id: number; author_email: string; body: string; pinned: number; created_at: number };
const toNote = (r: Raw): Note => ({ id: r.id, tenantId: r.tenant_id, authorUserId: r.author_user_id, authorEmail: r.author_email, body: r.body, pinned: r.pinned === 1, createdAt: r.created_at });
const SELECT = "SELECT n.*, u.email AS author_email FROM tenant_notes n JOIN users u ON u.id = n.author_user_id";

export function listNotes(tenantId: number): Note[] {
  return (controlSqlite.prepare(`${SELECT} WHERE n.tenant_id = ? ORDER BY n.pinned DESC, n.created_at DESC`).all(tenantId) as Raw[]).map(toNote);
}

export function addNote(tenantId: number, authorUserId: number, body: string): Note {
  const id = Number(controlSqlite.prepare("INSERT INTO tenant_notes (tenant_id, author_user_id, body, created_at) VALUES (?, ?, ?, ?)").run(tenantId, authorUserId, body.trim().slice(0, 4000), Date.now()).lastInsertRowid);
  return toNote(controlSqlite.prepare(`${SELECT} WHERE n.id = ?`).get(id) as Raw);
}

export function setNotePinned(id: number, pinned: boolean): void {
  controlSqlite.prepare("UPDATE tenant_notes SET pinned = ? WHERE id = ?").run(pinned ? 1 : 0, id);
}

/** Your own note, or any note if you are an owner. */
export function deleteNote(id: number, byUserId: number, isOwner: boolean): { ok: true } | { ok: false; error: string } {
  const row = controlSqlite.prepare("SELECT author_user_id FROM tenant_notes WHERE id = ?").get(id) as { author_user_id: number } | undefined;
  if (!row) return { ok: false, error: "That note is gone." };
  if (row.author_user_id !== byUserId && !isOwner) return { ok: false, error: "Only the author or an owner can remove a note." };
  controlSqlite.prepare("DELETE FROM tenant_notes WHERE id = ?").run(id);
  return { ok: true };
}
```

`app/src/lib/platform/tasks.ts`:

```ts
import "server-only";

import { controlSqlite } from "@/lib/db/control";

/** A thing a platform operator has to do, optionally about one business, optionally by a date. */
export interface Task {
  id: number;
  tenantId: number | null;
  tenantName: string | null;
  title: string;
  dueAt: number | null;
  assignedTo: number | null;
  doneAt: number | null;
  createdBy: number;
  createdAt: number;
}

type Raw = { id: number; tenant_id: number | null; tenant_name: string | null; title: string; due_at: number | null; assigned_to: number | null; done_at: number | null; created_by: number; created_at: number };
const toTask = (r: Raw): Task => ({ id: r.id, tenantId: r.tenant_id, tenantName: r.tenant_name, title: r.title, dueAt: r.due_at, assignedTo: r.assigned_to, doneAt: r.done_at, createdBy: r.created_by, createdAt: r.created_at });
const SELECT = "SELECT k.*, t.name AS tenant_name FROM platform_tasks k LEFT JOIN tenants t ON t.id = k.tenant_id";

export function listTasks(opts: { tenantId?: number; assignedTo?: number; open?: boolean } = {}): Task[] {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.tenantId !== undefined) { where.push("k.tenant_id = ?"); args.push(opts.tenantId); }
  if (opts.assignedTo !== undefined) { where.push("k.assigned_to = ?"); args.push(opts.assignedTo); }
  if (opts.open) where.push("k.done_at IS NULL");
  const rows = controlSqlite
    .prepare(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY k.done_at IS NOT NULL, k.due_at IS NULL, k.due_at, k.created_at DESC LIMIT 500`)
    .all(...args) as Raw[];
  return rows.map(toTask);
}

export function addTask(input: { tenantId: number | null; title: string; dueAt: number | null; assignedTo: number | null; createdBy: number }): Task {
  const id = Number(
    controlSqlite
      .prepare("INSERT INTO platform_tasks (tenant_id, title, due_at, assigned_to, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(input.tenantId, input.title.trim().slice(0, 200), input.dueAt, input.assignedTo, input.createdBy, Date.now()).lastInsertRowid,
  );
  return toTask(controlSqlite.prepare(`${SELECT} WHERE k.id = ?`).get(id) as Raw);
}

export function setTaskDone(id: number, done: boolean): void {
  controlSqlite.prepare("UPDATE platform_tasks SET done_at = ? WHERE id = ?").run(done ? Date.now() : null, id);
}

export function deleteTask(id: number): void {
  controlSqlite.prepare("DELETE FROM platform_tasks WHERE id = ?").run(id);
}

/** Buckets by due date, against the given instant (UTC day boundaries). */
export function dueBuckets(tasks: Task[], now: number): { overdue: Task[]; today: Task[]; later: Task[]; undated: Task[] } {
  const dayStart = Math.floor(now / 86400000) * 86400000;
  const dayEnd = dayStart + 86400000;
  const out = { overdue: [] as Task[], today: [] as Task[], later: [] as Task[], undated: [] as Task[] };
  for (const t of tasks) {
    if (t.dueAt === null) out.undated.push(t);
    else if (t.dueAt < dayStart) out.overdue.push(t);
    else if (t.dueAt < dayEnd) out.today.push(t);
    else out.later.push(t);
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd app && npm test -- src/lib/platform/tenantMeta.test.ts; npm test -- src/lib/platform/tasks.test.ts`
Expected: both `ok`.

- [ ] **Step 6: Commit**

```bash
git add app/src/lib/db/control.ts app/src/lib/platform/tenantMeta.ts app/src/lib/platform/tenantMeta.test.ts app/src/lib/platform/notes.ts app/src/lib/platform/tasks.ts app/src/lib/platform/tasks.test.ts
git commit -m "feat(platform): tenant stage, owner and tags; staff notes; tasks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Setup progress for an explicit tenant (main app)

**Files:**
- Modify: `app/src/lib/setup/steps.ts`
- Create: `app/src/lib/setup/forTenant.test.ts`

**Interfaces:**
- `getSetupSummaryForTenant(tenantId: number): SetupSummary`. Must be called inside `runWithTenant(tenantId, …)` by callers outside a request (the console API); the function itself wraps that, so callers just call it.

- [ ] **Step 1: Write the failing test**

`app/src/lib/setup/forTenant.test.ts`:

```ts
// Run: npm test -- src/lib/setup/forTenant.test.ts
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  if (request === "next/headers") return { cookies: () => { throw new Error("no request here"); }, headers: () => { throw new Error("no request here"); } };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { getSetupSummaryForTenant } = requireLocal("./steps") as typeof import("./steps");

  const slug = "setup-for-tenant-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, 'Setup Test', ?, 1) RETURNING id").get(slug, `tenants/${slug}/${slug}.db`) as { id: number };
  try {
    // No request, no cookie: this must still work for an explicit tenant.
    const s = getSetupSummaryForTenant(t.id);
    assert.equal(s.steps.length > 5, true);
    assert.equal(s.requiredDone, 0, "a brand-new tenant has done nothing");
    assert.equal(typeof s.nextTitle, "string");
    console.log("forTenant.test.ts: ok");
  } finally {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
    try { fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true }); } catch { /* best effort */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npm test -- src/lib/setup/forTenant.test.ts`
Expected: fails: `getSetupSummaryForTenant is not a function`.

- [ ] **Step 3: Split the detection from the request**

In `app/src/lib/setup/steps.ts` replace `getSetupSummary` with:

```ts
import { getCurrentTenant, runWithTenant } from "@/lib/db/tenant";
import { getBusinessProfileForTenant } from "@/lib/businessProfile";
import { getVenueTypeForTenant, readKeyForTenant } from "@/lib/settings";

/** Detections for an explicit tenant. Everything that reads the tenant DB runs under runWithTenant. */
function detectForTenant(tenantId: number): { detections: Record<string, boolean>; skips: Record<string, boolean>; vocab: Vocab } {
  return runWithTenant(tenantId, () => {
    const p = getBusinessProfileForTenant(tenantId);
    const detections: Record<string, boolean> = {
      business: p.businessName.trim().length > 0 && (p.phone.trim().length > 0 || p.location.trim().length > 0),
      venue: readKeyForTenant<boolean>(tenantId, "setup_ack_venue", false) === true,
      ai_context: isBriefComplete() || p.marketingBrain.trim().length > 0,
      branding: getBrandingLogoFilename() !== null,
      services: serviceCount() > 0,
      email: isEmailConfigured(),
      whatsapp: isWhatsAppConfigured(),
      facebook: listFacebookPages(tenantId).length > 0,
      google: isGoogleProfileConnected(tenantId),
      domain: getSendingDomain(tenantId)?.state === "verified",
      clients: clientCount() > 0,
      team: membershipCount(tenantId) > 1,
    };
    const skips: Record<string, boolean> = Object.fromEntries(
      SETUP_STEPS.filter((s) => s.optional).map((s) => [s.id, readKeyForTenant<boolean>(tenantId, `setup_skip_${s.id}`, false) === true]),
    );
    return { detections, skips, vocab: getVocab(getVenueTypeForTenant(tenantId)) };
  });
}

/** The console's view: no request, the tenant named explicitly. */
export function getSetupSummaryForTenant(tenantId: number): SetupSummary {
  const { detections, skips, vocab } = detectForTenant(tenantId);
  return summarizeSetup(SETUP_STEPS, detections, skips, vocab);
}

/** WIRES live detections for the current (request) tenant. */
export function getSetupSummary(): SetupSummary {
  return getSetupSummaryForTenant(getCurrentTenant().id);
}
```

Keep the existing imports; add the three new ones above (adjust `getCurrentTenant` to be imported once). `isBriefComplete`, `getBrandingLogoFilename`, `isEmailConfigured`, `isWhatsAppConfigured`, `serviceCount`, `clientCount` read the tenant DB through the `db` proxy, which `runWithTenant` binds. If the test's Step 4 run shows one of them calling `getCurrentTenant()` (the error will name it), switch that one call to its `ForTenant` variant if one exists, or wrap its read in the same pattern as `getBusinessProfileForTenant`.

- [ ] **Step 4: Run the test to see it pass**

Run: `cd app && npm test -- src/lib/setup/forTenant.test.ts && npm test -- src/lib/setup/steps.test.ts`
Expected: both `ok`.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib/setup/steps.ts app/src/lib/setup/forTenant.test.ts
git commit -m "feat(setup): setup progress for an explicit tenant, for the console

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Module usage (main app)

**Files:**
- Create: `app/src/lib/analytics/moduleUsage.ts`, `app/src/lib/analytics/moduleUsage.test.ts`
- Modify: `app/src/app/layout.tsx`

**Interfaces:**

```ts
export function noteModuleVisit(tenantId: number, pathname: string, now?: number): void   // buffers; no DB write
export function flushModuleUsage(now?: number): number                                       // writes the buffer; returns rows touched
export function usageByModule(tenantId: number, days: number, now?: number): { key: string; label: string; hits: number; lastAt: number | null; prevHits: number }[]
```

`prevHits` is the same-length window before, for "up or down".

- [ ] **Step 1: Write the failing test**

`app/src/lib/analytics/moduleUsage.test.ts`:

```ts
// Run: npm test -- src/lib/analytics/moduleUsage.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { noteModuleVisit, flushModuleUsage, usageByModule } = requireLocal("./moduleUsage") as typeof import("./moduleUsage");

  const slug = "usage-test";
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite.prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, 'Usage Test', ?, 1) RETURNING id").get(slug, `tenants/${slug}/void.db`) as { id: number };
  const day = 86400000;
  const now = Date.UTC(2026, 10, 11, 12);
  try {
    noteModuleVisit(t.id, "/leads", now);
    noteModuleVisit(t.id, "/leads/123", now);
    noteModuleVisit(t.id, "/nutrition/foods", now - 2 * day);
    noteModuleVisit(t.id, "/dashboard", now); // no module owns it: ignored
    noteModuleVisit(t.id, "/leads", now - 40 * day); // previous window
    assert.equal(controlSqlite.prepare("SELECT count(*) AS n FROM module_usage WHERE tenant_id = ?").get(t.id), undefined, "nothing written before flush");
    const touched = flushModuleUsage(now);
    assert.equal(touched, 3);
    const u = usageByModule(t.id, 30, now);
    const leads = u.find((m) => m.key === "leads")!;
    assert.equal(leads.hits, 2);
    assert.equal(leads.prevHits, 1);
    assert.equal(leads.lastAt, now);
    assert.equal(u.find((m) => m.key === "nutrition")!.hits, 1);
    assert.equal(u.find((m) => m.key === "workout")!.hits, 0, "every module is listed, used or not");
    assert.equal(flushModuleUsage(now), 0, "flushing twice writes nothing");
    console.log("moduleUsage.test.ts: ok");
  } finally {
    controlSqlite.prepare("DELETE FROM module_usage WHERE tenant_id = ?").run(t.id);
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(t.id);
  }
})().catch((e) => { console.error(e); process.exit(1); });
```

(The "nothing written before flush" assertion uses `get()` returning a row with `n: 0`; change it to `assert.equal((… as { n: number }).n, 0)`.)

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npm test -- src/lib/analytics/moduleUsage.test.ts`
Expected: `Cannot find module './moduleUsage'`.

- [ ] **Step 3: Write the module**

`app/src/lib/analytics/moduleUsage.ts`:

```ts
import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { MODULE_CATALOG, moduleForPath } from "@/lib/features";

/**
 * Which modules a business actually opens. The root layout calls
 * noteModuleVisit on every staff page render; that only touches a Map. A
 * timer flushes the Map into module_usage once a minute, one row per
 * (tenant, module, day), so a busy day is one UPDATE, not a write per
 * click. Counts are page renders, which is close enough to "did they use it".
 */
const buffer = new Map<string, { tenantId: number; key: string; day: string; hits: number; lastAt: number }>();

function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function noteModuleVisit(tenantId: number, pathname: string, now: number = Date.now()): void {
  const mod = moduleForPath(pathname);
  if (!mod) return;
  const day = dayOf(now);
  const k = `${tenantId}|${mod.key}|${day}`;
  const cur = buffer.get(k);
  if (cur) {
    cur.hits++;
    cur.lastAt = Math.max(cur.lastAt, now);
  } else buffer.set(k, { tenantId, key: mod.key, day, hits: 1, lastAt: now });
}

export function flushModuleUsage(now: number = Date.now()): number {
  void now;
  if (buffer.size === 0) return 0;
  const rows = [...buffer.values()];
  buffer.clear();
  const up = controlSqlite.prepare(
    `INSERT INTO module_usage (tenant_id, module_key, day, hits, last_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, module_key, day) DO UPDATE SET hits = hits + excluded.hits, last_at = MAX(last_at, excluded.last_at)`,
  );
  const tx = controlSqlite.transaction(() => {
    for (const r of rows) {
      try { up.run(r.tenantId, r.key, r.day, r.hits, r.lastAt); } catch { /* a tenant purged mid-buffer */ }
    }
  });
  tx();
  return rows.length;
}

export function usageByModule(tenantId: number, days: number, now: number = Date.now()): { key: string; label: string; hits: number; lastAt: number | null; prevHits: number }[] {
  const since = dayOf(now - days * 86400000);
  const prevSince = dayOf(now - 2 * days * 86400000);
  const rows = controlSqlite
    .prepare("SELECT module_key, day, hits, last_at FROM module_usage WHERE tenant_id = ? AND day >= ?")
    .all(tenantId, prevSince) as Array<{ module_key: string; day: string; hits: number; last_at: number }>;
  return MODULE_CATALOG.map((m) => {
    const mine = rows.filter((r) => r.module_key === m.key);
    const cur = mine.filter((r) => r.day >= since);
    const prev = mine.filter((r) => r.day < since);
    return {
      key: m.key,
      label: m.label,
      hits: cur.reduce((n, r) => n + r.hits, 0),
      lastAt: mine.length ? Math.max(...mine.map((r) => r.last_at)) : null,
      prevHits: prev.reduce((n, r) => n + r.hits, 0),
    };
  });
}

let flusher: ReturnType<typeof setInterval> | null = null;
if (!flusher && process.env.NEXT_PHASE !== "phase-production-build") {
  flusher = setInterval(() => {
    try { flushModuleUsage(); } catch (err) { console.error("[usage] flush failed:", err); }
  }, 60 * 1000);
  flusher.unref();
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd app && npm test -- src/lib/analytics/moduleUsage.test.ts`
Expected: `moduleUsage.test.ts: ok`.

- [ ] **Step 5: Count from the layout**

In `app/src/app/layout.tsx`, at the module gate (the line `featureFlags = getFeatureFlags();` inside the `if (user)` / `current` branch), add directly before it:

```ts
      // Tier 4 console: which modules this business actually opens. Buffered, never a write here.
      noteModuleVisit(current.tenant.id, pathname);
```

with `import { noteModuleVisit } from "@/lib/analytics/moduleUsage";` among the imports. (`current` is the active membership; `current.tenant.id` is already used a few lines above for `activeTenantId`.)

- [ ] **Step 6: Typecheck and commit**

Run: `cd app && npx tsc --noEmit -p .`

```bash
git add app/src/lib/analytics/moduleUsage.ts app/src/lib/analytics/moduleUsage.test.ts app/src/app/layout.tsx
git commit -m "feat(platform): count which modules each business opens, buffered and flushed by the minute

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Churn risk (main app)

**Files:**
- Create: `app/src/lib/platform/churnRisk.ts`, `app/src/lib/platform/churnRisk.test.ts`
- Modify: `app/src/lib/platform/alertSources.ts`

**Interfaces:**

```ts
export interface RiskFacts { daysSinceLastLogin: number | null; hits30: number; hitsPrev30: number; billingStatus: string | null; exempt: boolean; failedAttempts: number; reconnectsNeeded: number; openBadAlerts: number; setupRequiredDone: number; setupRequiredTotal: number; ageDays: number }
export interface Risk { score: number; level: "low" | "medium" | "high"; reasons: string[] }
export function churnRisk(f: RiskFacts): Risk
export function riskFacts(tenantId: number, setup: { requiredDone: number; requiredTotal: number }, now?: number): RiskFacts
```

Scoring (each reason adds; score capped at 100): no login in 14+ days +25 (30+ days +40); usage down more than half on the previous 30 days +20; past due +20 (3+ failed attempts +30); suspended +40; integration needing reconnect +10 each (max 20); open `bad` alert +10 each (max 20); setup under half done and older than 14 days +15. `high` at 60, `medium` at 30.

- [ ] **Step 1: Write the failing test**

`app/src/lib/platform/churnRisk.test.ts`:

```ts
// Run: npm test -- src/lib/platform/churnRisk.test.ts
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireLocal = createRequire(import.meta.url);
const { churnRisk } = requireLocal("./churnRisk") as typeof import("./churnRisk");

const healthy = { daysSinceLastLogin: 1, hits30: 200, hitsPrev30: 180, billingStatus: "active", exempt: false, failedAttempts: 0, reconnectsNeeded: 0, openBadAlerts: 0, setupRequiredDone: 4, setupRequiredTotal: 4, ageDays: 200 };
assert.deepEqual(churnRisk(healthy), { score: 0, level: "low", reasons: [] });

const quiet = churnRisk({ ...healthy, daysSinceLastLogin: 20 });
assert.equal(quiet.score, 25);
assert.equal(quiet.level, "low");
assert.match(quiet.reasons[0], /20 days/);

assert.equal(churnRisk({ ...healthy, daysSinceLastLogin: 45 }).score, 40);
assert.equal(churnRisk({ ...healthy, daysSinceLastLogin: null, ageDays: 30 }).score, 40, "never logged in counts as 30+");
assert.equal(churnRisk({ ...healthy, hits30: 40, hitsPrev30: 100 }).score, 20);
assert.equal(churnRisk({ ...healthy, hits30: 0, hitsPrev30: 0 }).score, 0, "no usage either side is not a drop");
assert.equal(churnRisk({ ...healthy, billingStatus: "past_due", failedAttempts: 1 }).score, 20);
assert.equal(churnRisk({ ...healthy, billingStatus: "past_due", failedAttempts: 3 }).score, 30);
assert.equal(churnRisk({ ...healthy, billingStatus: "suspended" }).score, 40);
assert.equal(churnRisk({ ...healthy, exempt: true, billingStatus: "past_due" }).score, 0, "exempt accounts have no billing risk");
assert.equal(churnRisk({ ...healthy, reconnectsNeeded: 3 }).score, 20);
assert.equal(churnRisk({ ...healthy, openBadAlerts: 1 }).score, 10);
assert.equal(churnRisk({ ...healthy, setupRequiredDone: 1, ageDays: 30 }).score, 15);
assert.equal(churnRisk({ ...healthy, setupRequiredDone: 1, ageDays: 3 }).score, 0, "a new account is allowed to be unfinished");

const bad = churnRisk({ ...healthy, daysSinceLastLogin: 40, billingStatus: "suspended", reconnectsNeeded: 2, openBadAlerts: 2 });
assert.equal(bad.score, 100);
assert.equal(bad.level, "high");
assert.equal(churnRisk({ ...healthy, daysSinceLastLogin: 20, hits30: 1, hitsPrev30: 100 }).level, "medium");
console.log("churnRisk.test.ts: ok");
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npm test -- src/lib/platform/churnRisk.test.ts`
Expected: `Cannot find module './churnRisk'`.

- [ ] **Step 3: Write the module**

`app/src/lib/platform/churnRisk.ts`:

```ts
import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { usageByModule } from "@/lib/analytics/moduleUsage";
import { countOpenAlerts } from "./healthHistory";

/**
 * A number for "is this business drifting away", with the reasons, from
 * facts the control plane already holds. The rules are plain and listed in
 * the plan so an operator can argue with them; nothing here is learned.
 */
export interface RiskFacts {
  daysSinceLastLogin: number | null;
  hits30: number;
  hitsPrev30: number;
  billingStatus: string | null;
  exempt: boolean;
  failedAttempts: number;
  reconnectsNeeded: number;
  openBadAlerts: number;
  setupRequiredDone: number;
  setupRequiredTotal: number;
  ageDays: number;
}

export interface Risk { score: number; level: "low" | "medium" | "high"; reasons: string[] }

export function churnRisk(f: RiskFacts): Risk {
  let score = 0;
  const reasons: string[] = [];
  const add = (n: number, why: string) => { score += n; reasons.push(why); };

  const idle = f.daysSinceLastLogin === null ? Math.max(30, f.ageDays) : f.daysSinceLastLogin;
  if (idle >= 30) add(40, f.daysSinceLastLogin === null ? "Nobody has ever signed in" : `No sign-in for ${idle} days`);
  else if (idle >= 14) add(25, `No sign-in for ${idle} days`);

  if (f.hitsPrev30 > 0 && f.hits30 < f.hitsPrev30 / 2) add(20, `Usage down ${Math.round((1 - f.hits30 / f.hitsPrev30) * 100)}% on the previous month`);

  if (!f.exempt) {
    if (f.billingStatus === "suspended") add(40, "Suspended for non-payment");
    else if (f.billingStatus === "past_due") add(f.failedAttempts >= 3 ? 30 : 20, `Past due, ${f.failedAttempts} failed ${f.failedAttempts === 1 ? "attempt" : "attempts"}`);
  }

  if (f.reconnectsNeeded > 0) add(Math.min(20, f.reconnectsNeeded * 10), `${f.reconnectsNeeded} ${f.reconnectsNeeded === 1 ? "integration needs" : "integrations need"} reconnecting`);
  if (f.openBadAlerts > 0) add(Math.min(20, f.openBadAlerts * 10), `${f.openBadAlerts} open ${f.openBadAlerts === 1 ? "alert needs" : "alerts need"} action`);
  if (f.setupRequiredTotal > 0 && f.setupRequiredDone < f.setupRequiredTotal / 2 && f.ageDays > 14) add(15, `Setup ${f.setupRequiredDone} of ${f.setupRequiredTotal} after ${f.ageDays} days`);

  score = Math.min(100, score);
  return { score, level: score >= 60 ? "high" : score >= 30 ? "medium" : "low", reasons };
}

export function riskFacts(tenantId: number, setup: { requiredDone: number; requiredTotal: number }, now: number = Date.now()): RiskFacts {
  const login = controlSqlite
    .prepare("SELECT MAX(u.last_login_at) AS last FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.tenant_id = ? AND m.is_active = 1 AND u.is_platform_admin = 0")
    .get(tenantId) as { last: number | null };
  const tenant = controlSqlite.prepare("SELECT created_at FROM tenants WHERE id = ?").get(tenantId) as { created_at: number } | undefined;
  const billing = controlSqlite.prepare("SELECT status, billing_exempt, failed_attempts FROM tenant_billing WHERE tenant_id = ?").get(tenantId) as { status: string; billing_exempt: number; failed_attempts: number } | undefined;
  const reconnects = (controlSqlite.prepare("SELECT (SELECT count(*) FROM facebook_pages WHERE tenant_id = ? AND needs_reconnect_at IS NOT NULL AND revoked_at IS NULL) + (SELECT count(*) FROM meta_grants WHERE tenant_id = ? AND needs_reconnect_at IS NOT NULL) AS n").get(tenantId, tenantId) as { n: number }).n;
  const badAlerts = (controlSqlite.prepare("SELECT count(*) AS n FROM platform_alerts WHERE tenant_id = ? AND resolved_at IS NULL AND level = 'bad'").get(tenantId) as { n: number }).n;
  const usage = usageByModule(tenantId, 30, now);
  void countOpenAlerts;
  return {
    daysSinceLastLogin: login.last ? Math.floor((now - login.last) / 86400000) : null,
    hits30: usage.reduce((n, m) => n + m.hits, 0),
    hitsPrev30: usage.reduce((n, m) => n + m.prevHits, 0),
    billingStatus: billing?.status ?? null,
    exempt: Boolean(billing?.billing_exempt),
    failedAttempts: billing?.failed_attempts ?? 0,
    reconnectsNeeded: reconnects,
    openBadAlerts: badAlerts,
    setupRequiredDone: setup.requiredDone,
    setupRequiredTotal: setup.requiredTotal,
    ageDays: tenant ? Math.floor((now - tenant.created_at) / 86400000) : 0,
  };
}
```

(Remove the `countOpenAlerts` import and the `void` line if the linter objects; it is there only to keep the import list honest about where alert counts come from.)

- [ ] **Step 4: Run the test to see it pass**

Run: `cd app && npm test -- src/lib/platform/churnRisk.test.ts`
Expected: `churnRisk.test.ts: ok`.

- [ ] **Step 5: Risk and tasks feed the inbox**

In `app/src/lib/platform/alertSources.ts` `collectAlertCandidates`, after the billing loop add:

```ts
  // Churn risk, only for businesses that are meant to be live.
  for (const b of billing) {
    if (b.archived_at !== null) continue;
    try {
      const setup = getSetupSummaryForTenant(b.id);
      const r = churnRisk(riskFacts(b.id, { requiredDone: setup.requiredDone, requiredTotal: setup.requiredTotal }, now));
      if (r.level === "high") candidates.push({ tenantId: b.id, key: "churn:high", level: "warn", title: `${b.name} looks at risk: ${r.reasons.join("; ")}`, href: `/gyms/${b.id}` });
    } catch {
      // a tenant whose database cannot be opened already has a health alert
    }
  }
  // Tasks due today or overdue, one alert per task.
  const buckets = dueBuckets(listTasks({ open: true }), now);
  for (const t of [...buckets.overdue, ...buckets.today]) {
    candidates.push({ tenantId: t.tenantId, key: `task:${t.id}`, level: buckets.overdue.includes(t) ? "bad" : "warn", title: `Task ${buckets.overdue.includes(t) ? "overdue" : "due today"}: ${t.title}`, href: t.tenantId ? `/gyms/${t.tenantId}` : "/inbox" });
  }
```

with imports `import { churnRisk, riskFacts } from "./churnRisk";`, `import { getSetupSummaryForTenant } from "@/lib/setup/steps";`, `import { dueBuckets, listTasks } from "./tasks";`.

- [ ] **Step 6: Typecheck and commit**

Run: `cd app && npx tsc --noEmit -p . && npm test -- src/lib/platform/alertSources.test.ts`

```bash
git add app/src/lib/platform/churnRisk.ts app/src/lib/platform/churnRisk.test.ts app/src/lib/platform/alertSources.ts
git commit -m "feat(platform): churn risk with reasons; at-risk businesses and due tasks reach the inbox

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Rollout flags (main app)

**Files:**
- Modify: `app/src/lib/features.ts`
- Create or modify: `app/src/lib/features.test.ts`
- Create: `app/src/lib/platform/flags.ts`
- Modify: `app/src/lib/settings.ts`

**Interfaces:**

```ts
// features.ts (pure)
export interface PlatformFlag { key: string; mode: "all" | "none" | "percent" | "allow"; percent: number; allow: number[] }
export function rolloutIncludes(flag: PlatformFlag, tenantId: number): boolean
export function applyRollout(tenantFlags: FeatureFlags, platform: PlatformFlag[], tenantId: number): FeatureFlags
// platform/flags.ts
export function listPlatformFlags(): PlatformFlag[]     // one per MODULE_CATALOG key, default mode "all"
export function setPlatformFlag(flag: PlatformFlag): void
export function rolloutCount(flag: PlatformFlag, tenantIds: number[]): number
```

`rolloutIncludes` for `percent` is deterministic: `hash(key + ":" + tenantId) % 100 < percent` with a small string hash (FNV-1a), so a business is in or out and stays that way.

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/features.test.ts` (create the file with the standard header if it does not exist):

```ts
import { applyRollout, rolloutIncludes } from "./features";

const all = { key: "leads", mode: "all" as const, percent: 100, allow: [] };
assert.equal(rolloutIncludes(all, 5), true);
assert.equal(rolloutIncludes({ ...all, mode: "none" }, 5), false);
assert.equal(rolloutIncludes({ ...all, mode: "allow", allow: [5, 9] }, 5), true);
assert.equal(rolloutIncludes({ ...all, mode: "allow", allow: [5, 9] }, 6), false);
assert.equal(rolloutIncludes({ ...all, mode: "percent", percent: 0 }, 5), false);
assert.equal(rolloutIncludes({ ...all, mode: "percent", percent: 100 }, 5), true);
const fifty = { ...all, mode: "percent" as const, percent: 50 };
assert.equal(rolloutIncludes(fifty, 7), rolloutIncludes(fifty, 7), "deterministic");
const inCount = Array.from({ length: 1000 }, (_, i) => rolloutIncludes(fifty, i)).filter(Boolean).length;
assert.ok(inCount > 400 && inCount < 600, `about half: ${inCount}`);

assert.deepEqual(applyRollout({}, [{ ...all, mode: "none" }], 5), { leads: false });
assert.deepEqual(applyRollout({ leads: false }, [all], 5), { leads: false }, "a tenant's own off stays off");
assert.deepEqual(applyRollout({}, [all], 5), {});
console.log("features rollout: ok");
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd app && npm test -- src/lib/features.test.ts`
Expected: fails on the import.

- [ ] **Step 3: The pure part**

Append to `app/src/lib/features.ts`:

```ts
/**
 * Staged rollout of a module across the fleet, set from the console. A
 * tenant's own explicit `false` always wins; the rollout only decides for
 * tenants that have not been switched off by hand.
 */
export interface PlatformFlag {
  key: string;
  mode: "all" | "none" | "percent" | "allow";
  percent: number;
  allow: number[];
}

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function rolloutIncludes(flag: PlatformFlag, tenantId: number): boolean {
  switch (flag.mode) {
    case "all": return true;
    case "none": return false;
    case "allow": return flag.allow.includes(tenantId);
    case "percent": return fnv(`${flag.key}:${tenantId}`) % 100 < Math.max(0, Math.min(100, flag.percent));
  }
}

export function applyRollout(tenantFlags: FeatureFlags, platform: PlatformFlag[], tenantId: number): FeatureFlags {
  const out: FeatureFlags = { ...tenantFlags };
  for (const f of platform) {
    if (!MODULE_KEYS.includes(f.key)) continue;
    if (!rolloutIncludes(f, tenantId)) out[f.key] = false;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd app && npm test -- src/lib/features.test.ts`
Expected: `features rollout: ok`.

- [ ] **Step 5: Storage and the readers**

`app/src/lib/platform/flags.ts`:

```ts
import "server-only";

import { controlSqlite } from "@/lib/db/control";
import { MODULE_CATALOG, rolloutIncludes, type PlatformFlag } from "@/lib/features";

export function listPlatformFlags(): PlatformFlag[] {
  const rows = controlSqlite.prepare("SELECT key, mode, percent, allow FROM platform_flags").all() as Array<{ key: string; mode: PlatformFlag["mode"]; percent: number; allow: string }>;
  return MODULE_CATALOG.map((m) => {
    const r = rows.find((x) => x.key === m.key);
    let allow: number[] = [];
    try { allow = r ? (JSON.parse(r.allow) as number[]).filter((n) => Number.isInteger(n)) : []; } catch { allow = []; }
    return { key: m.key, mode: r?.mode ?? "all", percent: r?.percent ?? 100, allow };
  });
}

export function setPlatformFlag(flag: PlatformFlag): void {
  controlSqlite
    .prepare(
      `INSERT INTO platform_flags (key, mode, percent, allow, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET mode = excluded.mode, percent = excluded.percent, allow = excluded.allow, updated_at = excluded.updated_at`,
    )
    .run(flag.key, flag.mode, Math.max(0, Math.min(100, Math.round(flag.percent))), JSON.stringify(flag.allow.slice(0, 500)), Date.now());
}

export function rolloutCount(flag: PlatformFlag, tenantIds: number[]): number {
  return tenantIds.filter((id) => rolloutIncludes(flag, id)).length;
}
```

In `app/src/lib/settings.ts` change the two readers:

```ts
import { applyRollout, parseFeatureFlags, type FeatureFlags } from "@/lib/features";
import { listPlatformFlags } from "@/lib/platform/flags";

export function getFeatureFlags(): FeatureFlags {
  return applyRollout(parseFeatureFlags(readKey<unknown>(FEATURES_KEY, null)), listPlatformFlags(), getCurrentTenant().id);
}

export function getFeatureFlagsForTenant(tenantId: number): FeatureFlags {
  return applyRollout(parseFeatureFlags(readKeyForTenant<unknown>(tenantId, FEATURES_KEY, null)), listPlatformFlags(), tenantId);
}
```

(`getCurrentTenant` is imported in settings.ts already or add `import { getCurrentTenant } from "@/lib/db/tenant";`. The `features/route.ts` POST still writes only the tenant's own exceptions through `setFeatureFlags`; its GET now reports the combined state, which is what the console should show.)

- [ ] **Step 6: Typecheck, test, commit**

Run: `cd app && npx tsc --noEmit -p . && npm test 2>&1 | tail -1`

```bash
git add app/src/lib/features.ts app/src/lib/features.test.ts app/src/lib/platform/flags.ts app/src/lib/settings.ts
git commit -m "feat(platform): module rollouts by percentage or allowlist, applied under each tenant's own flags

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Routes (main app)

**Files:**
- Create: `app/src/app/api/platform/tenants/[id]/meta/route.ts`, `notes/route.ts`, `tasks/route.ts`, `usage/route.ts`
- Create: `app/src/app/api/platform/tasks/route.ts`, `app/src/app/api/platform/flags/route.ts`
- Modify: `app/src/app/api/platform/tenants/[id]/route.ts`, `app/src/app/api/platform/fleet/route.ts`, `app/src/lib/platform/fleet.ts`

**Interfaces:**
- `GET /tenants/:id` adds `meta: TenantMeta`, `setup: SetupSummary`, `risk: Risk`.
- `PUT /tenants/:id/meta { stage?, ownerUserId?, tags? }` (audited `meta.set`).
- `GET /tenants/:id/notes` → `{ notes }`; `POST { body }`; `DELETE ?id=`; `PATCH { id, pinned }`.
- `GET /tenants/:id/tasks` → `{ tasks }`; `POST { title, dueAt, assignedTo }`; `PATCH { id, done }`; `DELETE ?id=`.
- `GET /tasks?assignedTo&open=1` → `{ tasks }`.
- `GET /tenants/:id/usage?days=30` → `{ modules }`.
- `GET /flags` → `{ flags, tenantIds, counts: Record<key, number> }`; `PUT { flag }` (owner-only, audited `flags.set`).
- `GET /fleet` rows add `stage`, `risk: { score, level }`, `setup: { requiredDone, requiredTotal }`.

- [ ] **Step 1: The per-tenant routes**

`app/src/app/api/platform/tenants/[id]/meta/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { STAGES, setTenantMeta } from "@/lib/platform/tenantMeta";

export const dynamic = "force-dynamic";

const schema = z.object({
  stage: z.enum(STAGES as [string, ...string[]]).nullable().optional(),
  ownerUserId: z.number().int().positive().nullable().optional(),
  tags: z.array(z.string().max(30)).max(20).optional(),
});

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const tenantId = Number(id);
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  setTenantMeta(tenantId, parsed.data as Parameters<typeof setTenantMeta>[1]);
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId, action: "meta.set", detail: parsed.data, ip: requestIp(req) });
  return NextResponse.json({ ok: true });
}
```

`app/src/app/api/platform/tenants/[id]/notes/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { addNote, deleteNote, listNotes, setNotePinned } from "@/lib/platform/notes";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  return NextResponse.json({ notes: listNotes(Number(id)) });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = z.object({ body: z.string().trim().min(1).max(4000) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Write something." }, { status: 400 });
  const note = addNote(Number(id), g.userId, parsed.data.body);
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: Number(id), action: "note.add", detail: { id: note.id }, ip: requestIp(req) });
  return NextResponse.json({ ok: true, note });
}

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = z.object({ id: z.number().int().positive(), pinned: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  setNotePinned(parsed.data.id, parsed.data.pinned);
  void id;
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const noteId = Number(req.nextUrl.searchParams.get("id"));
  const r = deleteNote(noteId, g.userId, g.role === "owner");
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: Number(id), action: "note.delete", detail: { id: noteId }, ip: requestIp(req), ok: r.ok, error: r.ok ? null : r.error });
  return NextResponse.json(r, { status: r.ok ? 200 : 403 });
}
```

`app/src/app/api/platform/tenants/[id]/tasks/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { guardPlatform } from "@/lib/platform/auth";
import { addTask, deleteTask, listTasks, setTaskDone } from "@/lib/platform/tasks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  return NextResponse.json({ tasks: listTasks({ tenantId: Number(id) }) });
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = z.object({ title: z.string().trim().min(1).max(200), dueAt: z.number().int().nullable(), assignedTo: z.number().int().positive().nullable() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Give the task a title." }, { status: 400 });
  const task = addTask({ tenantId: Number(id), ...parsed.data, createdBy: g.userId });
  return NextResponse.json({ ok: true, task });
}

export async function PATCH(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = z.object({ id: z.number().int().positive(), done: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  setTaskDone(parsed.data.id, parsed.data.done);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  deleteTask(Number(req.nextUrl.searchParams.get("id")));
  return NextResponse.json({ ok: true });
}
```

`app/src/app/api/platform/tasks/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { listTasks } from "@/lib/platform/tasks";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const sp = req.nextUrl.searchParams;
  const assignedTo = Number(sp.get("assignedTo"));
  return NextResponse.json({ tasks: listTasks({ assignedTo: Number.isInteger(assignedTo) && assignedTo > 0 ? assignedTo : undefined, open: sp.get("open") === "1" }) });
}
```

`app/src/app/api/platform/tenants/[id]/usage/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";

import { guardPlatform } from "@/lib/platform/auth";
import { usageByModule } from "@/lib/analytics/moduleUsage";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  return NextResponse.json({ modules: usageByModule(Number(id), days) });
}
```

`app/src/app/api/platform/flags/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { controlSqlite } from "@/lib/db/control";
import { guardPlatform } from "@/lib/platform/auth";
import { recordAudit, requestIp } from "@/lib/platform/audit";
import { listPlatformFlags, rolloutCount, setPlatformFlag } from "@/lib/platform/flags";
import { MODULE_KEYS } from "@/lib/features";

export const dynamic = "force-dynamic";

function activeTenantIds(): number[] {
  return (controlSqlite.prepare("SELECT id FROM tenants WHERE is_active = 1 AND archived_at IS NULL").all() as Array<{ id: number }>).map((r) => r.id);
}

export async function GET(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const flags = listPlatformFlags();
  const ids = activeTenantIds();
  return NextResponse.json({ flags, tenantIds: ids, counts: Object.fromEntries(flags.map((f) => [f.key, rolloutCount(f, ids)])) });
}

const schema = z.object({
  flag: z.object({
    key: z.string().refine((k) => MODULE_KEYS.includes(k), { message: "Unknown module" }),
    mode: z.enum(["all", "none", "percent", "allow"]),
    percent: z.number().int().min(0).max(100),
    allow: z.array(z.number().int().positive()).max(500),
  }),
});

/** Owner-only: this changes what every business can see. */
export async function PUT(req: NextRequest) {
  const g = guardPlatform(req);
  if (g instanceof Response) return g;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "That request does not make sense." }, { status: 400 });
  if (g.role !== "owner") {
    recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: null, action: "flags.set", detail: parsed.data.flag, ip: requestIp(req), ok: false, error: "not an owner" });
    return NextResponse.json({ ok: false, error: "Rollouts are an owner's action." }, { status: 403 });
  }
  setPlatformFlag(parsed.data.flag);
  recordAudit({ actorUserId: g.userId, actorEmail: g.email, actorRole: g.role, tenantId: null, action: "flags.set", detail: parsed.data.flag, ip: requestIp(req) });
  return NextResponse.json({ ok: true, flags: listPlatformFlags() });
}
```

- [ ] **Step 2: Detail and fleet include the new facts**

In `app/src/app/api/platform/tenants/[id]/route.ts` `GET`, compute and add to the JSON:

```ts
  const setup = getSetupSummaryForTenant(id);
  const risk = churnRisk(riskFacts(id, { requiredDone: setup.requiredDone, requiredTotal: setup.requiredTotal }));
  const billingRow = tenant.billing;
  const meta = getTenantMeta(id, {
    archived: Boolean(getTenantLifecycle(id)?.archivedAt),
    billingStatus: billingRow?.status ?? null,
    exempt: Boolean(billingRow?.billingExempt),
    setupRequiredDone: setup.requiredDone,
    setupRequiredTotal: setup.requiredTotal,
    riskScore: risk.score,
  });
```

and `meta, setup: { requiredDone: setup.requiredDone, requiredTotal: setup.requiredTotal, resolved: setup.resolved, total: setup.total, nextTitle: setup.nextTitle, steps: setup.steps.map((s) => ({ id: s.id, title: s.title, done: s.done, skipped: s.skipped, optional: Boolean(s.optional) })) }, risk` in the response object. Imports: `getSetupSummaryForTenant` from `@/lib/setup/steps`, `churnRisk`, `riskFacts` from `@/lib/platform/churnRisk`, `getTenantMeta` from `@/lib/platform/tenantMeta`. (`tenant.billing` is the summary's billing object; if the field names differ, read `tenant_billing` as in `alertSources.ts`.)

In `app/src/lib/platform/fleet.ts` `listFleet`, after the rows are built, enrich each (wrapped so one bad tenant cannot fail the list):

```ts
  return rows.map((r) => {
    let setup = { requiredDone: 0, requiredTotal: 0 };
    let risk: { score: number; level: "low" | "medium" | "high" } = { score: 0, level: "low" };
    let stage: string | null = null;
    try {
      const s = getSetupSummaryForTenant(r.id);
      setup = { requiredDone: s.requiredDone, requiredTotal: s.requiredTotal };
      const rk = churnRisk(riskFacts(r.id, setup));
      risk = { score: rk.score, level: rk.level };
      const m = getTenantMeta(r.id, { archived: r.archivedAt !== null, billingStatus: r.billingStatus, exempt: r.billingExempt, setupRequiredDone: setup.requiredDone, setupRequiredTotal: setup.requiredTotal, riskScore: rk.score });
      stage = m.stage ?? m.stageAuto;
    } catch {
      // keep the row; the console shows blanks
    }
    return { ...r, setup, risk, stage };
  });
```

(`rows` is whatever the function currently returns; add the three fields to `FleetTenantRow`'s type in `fleet.ts` as `setup: { requiredDone: number; requiredTotal: number }; risk: { score: number; level: "low" | "medium" | "high" }; stage: string | null`.)

- [ ] **Step 3: Typecheck, test, commit**

Run: `cd app && npx tsc --noEmit -p . && npm test 2>&1 | tail -1`

```bash
git add app/src/app/api/platform app/src/lib/platform/fleet.ts
git commit -m "feat(platform): meta, notes, tasks, usage and rollout endpoints; fleet rows carry stage, risk and setup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Then deploy the app (the console tasks below need these routes in production to be verified there):

```bash
cd app && rm -rf .next && npx next build 2>&1 | tail -2 && git push origin main && railway up --detach
```

---

### Task 7: Business 360 (console)

**Files:**
- Modify: `admin/src/lib/types.ts`
- Create: `admin/src/app/(console)/gyms/[id]/business-actions.ts`
- Create: `admin/src/components/business/Properties.tsx`, `Notes.tsx`, `Tasks.tsx`, `SetupProgress.tsx`, `UsagePanel.tsx`, `RiskCard.tsx`
- Modify: `admin/src/app/(console)/gyms/[id]/layout.tsx`, `admin/src/app/(console)/gyms/[id]/page.tsx`, `admin/src/components/BusinessesTable.tsx`, `admin/src/components/features/FeaturesPanel.tsx`, `admin/src/app/globals.css`

- [ ] **Step 1: Types**

Add to `admin/src/lib/types.ts`:

```ts
export type Stage = "trial" | "onboarding" | "active" | "at_risk" | "churned";
export const STAGE_LABEL: Record<Stage, string> = { trial: "Trial", onboarding: "Onboarding", active: "Active", at_risk: "At risk", churned: "Churned" };
export interface TenantMeta { tenantId: number; stage: Stage | null; stageAuto: Stage; ownerUserId: number | null; tags: string[]; updatedAt: number | null }
export interface SetupView { requiredDone: number; requiredTotal: number; resolved: number; total: number; nextTitle: string | null; steps: { id: string; title: string; done: boolean; skipped: boolean; optional: boolean }[] }
export interface Risk { score: number; level: "low" | "medium" | "high"; reasons: string[] }
export interface Note { id: number; tenantId: number; authorUserId: number; authorEmail: string; body: string; pinned: boolean; createdAt: number }
export interface Task { id: number; tenantId: number | null; tenantName: string | null; title: string; dueAt: number | null; assignedTo: number | null; doneAt: number | null; createdBy: number; createdAt: number }
export interface ModuleUsage { key: string; label: string; hits: number; lastAt: number | null; prevHits: number }
export interface PlatformFlag { key: string; mode: "all" | "none" | "percent" | "allow"; percent: number; allow: number[] }
```

Extend `TenantDetail` with `meta: TenantMeta; setup: SetupView; risk: Risk;` and `FleetTenantRow` with `setup: { requiredDone: number; requiredTotal: number }; risk: { score: number; level: "low" | "medium" | "high" }; stage: string | null;`.

- [ ] **Step 2: Server actions**

`admin/src/app/(console)/gyms/[id]/business-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";
import { bust } from "@/lib/revalidate";
import type { Note, Stage, Task } from "@/lib/types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(err: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: err instanceof ApiError ? err.message : fallback };
}
function done(tenantId: number) {
  bust(tenantId);
  revalidatePath(`/gyms/${tenantId}`);
  revalidatePath("/gyms");
}

export async function setMetaAction(tenantId: number, patch: { stage?: Stage | null; ownerUserId?: number | null; tags?: string[] }): Promise<Result> {
  try { await api(`/tenants/${tenantId}/meta`, { method: "PUT", body: patch }); done(tenantId); return { ok: true }; }
  catch (err) { return fail(err, "Could not save that."); }
}

export async function addNoteAction(tenantId: number, body: string): Promise<Result<Note>> {
  try { const r = await api<{ note: Note }>(`/tenants/${tenantId}/notes`, { method: "POST", body: { body } }); done(tenantId); return { ok: true, data: r.note }; }
  catch (err) { return fail(err, "Could not add the note."); }
}

export async function pinNoteAction(tenantId: number, id: number, pinned: boolean): Promise<Result> {
  try { await api(`/tenants/${tenantId}/notes`, { method: "PATCH", body: { id, pinned } }); done(tenantId); return { ok: true }; }
  catch (err) { return fail(err, "Could not pin that."); }
}

export async function deleteNoteAction(tenantId: number, id: number): Promise<Result> {
  try { await api(`/tenants/${tenantId}/notes?id=${id}`, { method: "DELETE" }); done(tenantId); return { ok: true }; }
  catch (err) { return fail(err, "Could not remove that note."); }
}

export async function addTaskAction(tenantId: number, input: { title: string; dueAt: number | null; assignedTo: number | null }): Promise<Result<Task>> {
  try { const r = await api<{ task: Task }>(`/tenants/${tenantId}/tasks`, { method: "POST", body: input }); done(tenantId); revalidatePath("/inbox"); return { ok: true, data: r.task }; }
  catch (err) { return fail(err, "Could not add the task."); }
}

export async function setTaskDoneAction(tenantId: number | null, id: number, isDone: boolean): Promise<Result> {
  try { await api(`/tenants/${tenantId ?? 0}/tasks`, { method: "PATCH", body: { id, done: isDone } }); if (tenantId) done(tenantId); revalidatePath("/inbox"); return { ok: true }; }
  catch (err) { return fail(err, "Could not update the task."); }
}

export async function deleteTaskAction(tenantId: number | null, id: number): Promise<Result> {
  try { await api(`/tenants/${tenantId ?? 0}/tasks?id=${id}`, { method: "DELETE" }); if (tenantId) done(tenantId); revalidatePath("/inbox"); return { ok: true }; }
  catch (err) { return fail(err, "Could not remove the task."); }
}
```

- [ ] **Step 3: The components**

`admin/src/components/business/Properties.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

import { notify } from "@/lib/toast";
import { setMetaAction } from "@/app/(console)/gyms/[id]/business-actions";
import { STAGE_LABEL, type PlatformStaffRow, type Stage, type TenantMeta } from "@/lib/types";

const STAGES: Stage[] = ["trial", "onboarding", "active", "at_risk", "churned"];

/** Stage, owner, tags: the strip under the business header. Each control saves on change. */
export function Properties({ tenantId, meta, staff }: { tenantId: number; meta: TenantMeta; staff: PlatformStaffRow[] }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [tag, setTag] = useState("");
  const save = (patch: Parameters<typeof setMetaAction>[1], okMsg: string) =>
    start(async () => {
      const r = await setMetaAction(tenantId, patch);
      if (r.ok) { notify.ok(okMsg); router.refresh(); } else notify.fail(r.error);
    });
  return (
    <div className="props">
      <label className="prop">
        <span className="prop-label">Stage</span>
        <select className="input" value={meta.stage ?? ""} onChange={(e) => save({ stage: (e.target.value || null) as Stage | null }, "Stage saved")}>
          <option value="">Auto: {STAGE_LABEL[meta.stageAuto]}</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
      </label>
      <label className="prop">
        <span className="prop-label">Owner</span>
        <select className="input" value={meta.ownerUserId ?? ""} onChange={(e) => save({ ownerUserId: e.target.value ? Number(e.target.value) : null }, "Owner saved")}>
          <option value="">Nobody</option>
          {staff.map((s) => <option key={s.userId} value={s.userId}>{s.name ?? s.email}</option>)}
        </select>
      </label>
      <div className="prop prop--tags">
        <span className="prop-label">Tags</span>
        <span className="tags">
          {meta.tags.map((t) => (
            <span key={t} className="chip">
              {t}
              <button type="button" aria-label={`Remove ${t}`} onClick={() => save({ tags: meta.tags.filter((x) => x !== t) }, "Tag removed")}><X size={11} /></button>
            </span>
          ))}
          <input
            className="input tag-input"
            placeholder="Add tag"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && tag.trim()) { e.preventDefault(); save({ tags: [...meta.tags, tag] }, "Tag added"); setTag(""); }
            }}
          />
        </span>
      </div>
    </div>
  );
}
```

`admin/src/components/business/Notes.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pin, PinOff, Trash2 } from "lucide-react";

import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { addNoteAction, deleteNoteAction, pinNoteAction } from "@/app/(console)/gyms/[id]/business-actions";
import type { Note } from "@/lib/types";

export function Notes({ tenantId, notes, meId, isOwner }: { tenantId: number; notes: Note[]; meId: number; isOwner: boolean }) {
  const router = useRouter();
  const ask = useConfirm();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const after = (r: { ok: boolean; error?: string }, okMsg: string) => { if (r.ok) { notify.ok(okMsg); router.refresh(); } else notify.fail(r.error ?? "That did not work."); };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (!body.trim()) return; start(async () => { after(await addNoteAction(tenantId, body), "Note added"); setBody(""); }); }}
        style={{ display: "flex", gap: 8, alignItems: "flex-start" }}
      >
        <textarea className="input" rows={2} placeholder="Leave a note for the team…" value={body} onChange={(e) => setBody(e.target.value)} style={{ resize: "vertical" }} />
        <button className="btn btn--primary btn--md" type="submit" disabled={pending || !body.trim()}>Add</button>
      </form>
      {notes.length === 0 && <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>No notes yet.</p>}
      <ul className="notes">
        {notes.map((n) => (
          <li key={n.id} className={n.pinned ? "is-pinned" : undefined}>
            <div className="note-body">{n.body}</div>
            <div className="note-meta">
              <span>{n.authorEmail}, {new Date(n.createdAt).toLocaleDateString("en-IE")}</span>
              <span className="note-actions">
                <button type="button" className="btn btn--ghost btn--icon" aria-label={n.pinned ? "Unpin" : "Pin"} onClick={() => start(async () => after(await pinNoteAction(tenantId, n.id, !n.pinned), n.pinned ? "Unpinned" : "Pinned"))}>{n.pinned ? <PinOff size={13} /> : <Pin size={13} />}</button>
                {(n.authorUserId === meId || isOwner) && (
                  <button type="button" className="btn btn--ghost btn--icon" aria-label="Delete" onClick={async () => { const r = await ask({ title: "Remove this note?", confirmLabel: "Remove", danger: true }); if (r.ok) start(async () => after(await deleteNoteAction(tenantId, n.id), "Note removed")); }}><Trash2 size={13} /></button>
                )}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`admin/src/components/business/Tasks.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { notify } from "@/lib/toast";
import { addTaskAction, deleteTaskAction, setTaskDoneAction } from "@/app/(console)/gyms/[id]/business-actions";
import type { PlatformStaffRow, Task } from "@/lib/types";

export function Tasks({ tenantId, tasks, staff, meId }: { tenantId: number; tasks: Task[]; staff: PlatformStaffRow[]; meId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [who, setWho] = useState(String(meId));
  const after = (r: { ok: boolean; error?: string }, okMsg: string) => { if (r.ok) { notify.ok(okMsg); router.refresh(); } else notify.fail(r.error ?? "That did not work."); };
  const open = tasks.filter((t) => !t.doneAt);
  const doneList = tasks.filter((t) => t.doneAt).slice(0, 5);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          start(async () => {
            after(await addTaskAction(tenantId, { title, dueAt: due ? Date.parse(due) + 9 * 3600000 : null, assignedTo: who ? Number(who) : null }), "Task added");
            setTitle(""); setDue("");
          });
        }}
      >
        <input className="input toolbar-search" placeholder="What needs doing?" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" />
        <select className="input" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Assign to">
          <option value="">Unassigned</option>
          {staff.map((s) => <option key={s.userId} value={s.userId}>{s.userId === meId ? "Me" : s.name ?? s.email}</option>)}
        </select>
        <button className="btn btn--primary btn--md" type="submit" disabled={pending || !title.trim()}>Add</button>
      </form>
      {open.length === 0 && <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>Nothing open.</p>}
      <ul className="tasks">
        {[...open, ...doneList].map((t) => {
          const overdue = t.dueAt !== null && !t.doneAt && t.dueAt < Date.now();
          const assignee = staff.find((s) => s.userId === t.assignedTo);
          return (
            <li key={t.id} className={t.doneAt ? "is-done" : undefined}>
              <input type="checkbox" checked={Boolean(t.doneAt)} aria-label="Done" onChange={() => start(async () => after(await setTaskDoneAction(tenantId, t.id, !t.doneAt), t.doneAt ? "Reopened" : "Done"))} />
              <span className="task-title">{t.title}</span>
              <span className="task-meta" style={overdue ? { color: "var(--red)" } : undefined}>
                {t.dueAt ? new Date(t.dueAt).toLocaleDateString("en-IE") : ""}{assignee ? ` · ${assignee.name ?? assignee.email}` : ""}
              </span>
              <button type="button" className="btn btn--ghost btn--icon" aria-label="Delete" onClick={() => start(async () => after(await deleteTaskAction(tenantId, t.id), "Task removed"))}><Trash2 size={13} /></button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

`admin/src/components/business/SetupProgress.tsx`:

```tsx
import type { SetupView } from "@/lib/types";

/** How far through setup the business is, and where it is stuck. */
export function SetupProgress({ setup }: { setup: SetupView }) {
  const pct = setup.total === 0 ? 0 : Math.round((setup.resolved / setup.total) * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="bar" aria-label={`${pct}% of setup done`}><i style={{ width: `${pct}%` }} /></div>
      <div style={{ fontSize: 13.5 }}>
        {setup.requiredDone} of {setup.requiredTotal} required steps done
        {setup.nextTitle && <span style={{ color: "var(--text-secondary)" }}>. Next: {setup.nextTitle}</span>}
        {!setup.nextTitle && <span style={{ color: "var(--text-secondary)" }}>. All done.</span>}
      </div>
      <ul className="steps">
        {setup.steps.map((s) => (
          <li key={s.id} className={s.done ? "is-done" : s.skipped ? "is-skipped" : undefined}>
            <i aria-hidden /> {s.title}{s.optional && !s.done && !s.skipped ? <span className="step-opt"> optional</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`admin/src/components/business/UsagePanel.tsx`:

```tsx
import type { ModuleUsage } from "@/lib/types";

/** Which modules they open, last 30 days, with the change on the month before. */
export function UsagePanel({ modules }: { modules: ModuleUsage[] }) {
  const max = Math.max(1, ...modules.map((m) => m.hits));
  const used = modules.filter((m) => m.hits > 0 || m.prevHits > 0).sort((a, b) => b.hits - a.hits);
  if (used.length === 0) return <p style={{ margin: 0, fontSize: 13.5, color: "var(--text-secondary)" }}>No activity recorded yet. Counting started with this release.</p>;
  return (
    <ul className="usage">
      {used.map((m) => {
        const delta = m.prevHits === 0 ? null : Math.round(((m.hits - m.prevHits) / m.prevHits) * 100);
        return (
          <li key={m.key}>
            <span className="usage-label">{m.label}</span>
            <span className="usage-bar"><i style={{ width: `${(m.hits / max) * 100}%` }} /></span>
            <span className="usage-n">{m.hits}</span>
            <span className="usage-delta" style={{ color: delta === null ? "var(--text-tertiary)" : delta < 0 ? "var(--red)" : "var(--green)" }}>{delta === null ? "new" : `${delta > 0 ? "+" : ""}${delta}%`}</span>
          </li>
        );
      })}
      <li className="usage-unused">Not opened: {modules.filter((m) => m.hits === 0 && m.prevHits === 0).map((m) => m.label).join(", ") || "none"}</li>
    </ul>
  );
}
```

`admin/src/components/business/RiskCard.tsx`:

```tsx
import type { Risk } from "@/lib/types";

export function RiskCard({ risk }: { risk: Risk }) {
  const colour = risk.level === "high" ? "var(--red)" : risk.level === "medium" ? "var(--amber)" : "var(--green)";
  return (
    <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
      <div style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", fontSize: 34, lineHeight: 1, color: colour, fontVariantNumeric: "tabular-nums" }}>{risk.score}</div>
      <div style={{ fontSize: 13.5 }}>
        <div style={{ color: colour, textTransform: "capitalize", fontWeight: 500 }}>{risk.level === "at_risk" ? "At risk" : risk.level} risk</div>
        {risk.reasons.length === 0 ? <div style={{ color: "var(--text-secondary)" }}>Nothing points to churn.</div> : <ul style={{ margin: "6px 0 0", paddingLeft: 16, color: "var(--text-secondary)" }}>{risk.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      </div>
    </div>
  );
}
```

Append to `admin/src/app/globals.css`:

```css
/* ── Business 360 ───────────────────────────────────────────────────────── */
.props { display: flex; gap: 18px; flex-wrap: wrap; align-items: flex-end; padding: 14px 0 0; }
.prop { display: flex; flex-direction: column; gap: 5px; }
.prop .input { width: auto; min-height: 36px; padding-top: 0; padding-bottom: 0; font-size: 13px; }
.prop-label { font-family: var(--font-mono), ui-monospace, monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--text-tertiary); }
.prop--tags { flex: 1 1 260px; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.tags .chip { padding-left: 10px; background-image: none; display: inline-flex; align-items: center; gap: 4px; }
.tags .chip button { border: 0; background: transparent; color: inherit; cursor: pointer; display: grid; place-items: center; padding: 0; }
.tag-input { width: 120px !important; min-height: 30px !important; font-size: 12.5px !important; }
.bar { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.bar i { display: block; height: 100%; background: linear-gradient(90deg, #ffffff, #9fb0c4); }
.steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px 16px; font-size: 13px; color: var(--text-secondary); }
.steps li { display: flex; align-items: center; gap: 8px; }
.steps i { width: 8px; height: 8px; border-radius: 50%; background: var(--surface-3); flex: 0 0 auto; }
.steps .is-done { color: var(--text-primary); }
.steps .is-done i { background: var(--green); }
.steps .is-skipped i { background: var(--text-tertiary); }
.step-opt { color: var(--text-tertiary); font-size: 11.5px; }
.usage { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.usage li { display: grid; grid-template-columns: 180px 1fr 48px 56px; gap: 12px; align-items: center; font-size: 13px; }
.usage-bar { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.usage-bar i { display: block; height: 100%; background: #9fb0c4; }
.usage-n { text-align: right; font-family: var(--font-mono), ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.usage-delta { font-size: 12px; text-align: right; }
.usage-unused { display: block !important; margin-top: 6px; font-size: 12.5px; color: var(--text-tertiary); }
.notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.notes li { padding: 12px 14px; border-radius: 10px; background: var(--surface-2); border: 1px solid transparent; }
.notes li.is-pinned { border-color: var(--hairline-strong); }
.note-body { white-space: pre-wrap; font-size: 13.5px; line-height: 1.5; }
.note-meta { display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 12px; color: var(--text-tertiary); }
.note-actions { display: flex; gap: 2px; }
.note-actions .btn--icon { width: 26px; height: 26px; }
.tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.tasks li { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--grid); font-size: 13.5px; }
.tasks li.is-done .task-title { text-decoration: line-through; color: var(--text-tertiary); }
.task-title { flex: 1; }
.task-meta { font-size: 12px; color: var(--text-tertiary); }
.tasks .btn--icon { width: 26px; height: 26px; }
```

- [ ] **Step 4: Wire the layout and the Overview**

In `admin/src/app/(console)/gyms/[id]/layout.tsx`: fetch staff alongside the detail (`const staff = await api<StaffResponse>("/staff", { revalidate: 30, tags: ["fleet"] });`) and render `<Properties tenantId={tenant.id} meta={data.meta} staff={staff.staff} />` directly after the `biz-head` div (inside the same wrapper, before `<TenantTabs>`). Add a stage chip to the title row: `<span className="chip">{STAGE_LABEL[(data.meta.stage ?? data.meta.stageAuto)]}</span>`.

In `admin/src/app/(console)/gyms/[id]/page.tsx` (Overview): fetch `notes`, `tasks` and `usage` in parallel with the detail, and replace the "Add-ons" and "Recent staff activity" cards with this layout (keep "At a glance" and "Credits" as they are):

```tsx
      <div className="chart-grid-2">
        <Card>
          <h2 className="card-title" style={{ margin: "0 0 14px" }}>Churn risk</h2>
          <RiskCard risk={data.risk} />
        </Card>
        <Card>
          <h2 className="card-title" style={{ margin: "0 0 14px" }}>Setup</h2>
          <SetupProgress setup={data.setup} />
        </Card>
      </div>
      <Card>
        <h2 className="card-title" style={{ margin: "0 0 4px" }}>What they use</h2>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--text-secondary)" }}>Page opens in the last 30 days, and the change on the 30 before.</p>
        <UsagePanel modules={usage.modules} />
      </Card>
      <div className="chart-grid-2">
        <Card>
          <h2 className="card-title" style={{ margin: "0 0 14px" }}>Notes</h2>
          <Notes tenantId={id} notes={notes.notes} meId={me.userId} isOwner={me.role === "owner"} />
        </Card>
        <Card>
          <h2 className="card-title" style={{ margin: "0 0 14px" }}>Tasks</h2>
          <Tasks tenantId={id} tasks={tasks.tasks} staff={staff.staff} meId={me.userId} />
        </Card>
      </div>
```

with `const [notes, tasks, usage, staff] = await Promise.all([api<{ notes: Note[] }>(\`/tenants/${id}/notes\`), api<{ tasks: Task[] }>(\`/tenants/${id}/tasks\`), api<{ modules: ModuleUsage[] }>(\`/tenants/${id}/usage?days=30\`), api<StaffResponse>("/staff", { revalidate: 30, tags: ["fleet"] })]);` and `const me = await requireAdminSession();`. Keep the "Recent staff activity" card below if it is wanted; the Timeline tab has the full list.

- [ ] **Step 5: Businesses table columns, Features last-used**

In `admin/src/components/BusinessesTable.tsx` add three columns after Status:

```tsx
    { key: "stage", label: "Stage", sortable: true, value: (t) => t.stage ?? "", render: (t) => (t.stage ? STAGE_LABEL[t.stage as Stage] : "—") },
    { key: "risk", label: "Risk", sortable: true, align: "right", value: (t) => t.risk.score, render: (t) => <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", color: t.risk.level === "high" ? "var(--red)" : t.risk.level === "medium" ? "var(--amber)" : "var(--text-secondary)" }}>{t.risk.score}</span> },
    { key: "setup", label: "Setup", sortable: true, align: "right", value: (t) => (t.setup.requiredTotal ? t.setup.requiredDone / t.setup.requiredTotal : 0), render: (t) => <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}>{t.setup.requiredDone}/{t.setup.requiredTotal}</span> },
```

(import `STAGE_LABEL` and `Stage` from types.)

In `admin/src/components/features/FeaturesPanel.tsx`, accept a new prop `usage: ModuleUsage[]` (fetch it in `features/page.tsx` the same way as the Overview) and beside each module's label render `{(() => { const u = usage.find((m) => m.key === module.key); return u?.lastAt ? <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-tertiary)" }}>last opened {new Date(u.lastAt).toLocaleDateString("en-IE")}</span> : <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-tertiary)" }}>never opened</span>; })()}` (use the panel's actual module variable name).

- [ ] **Step 6: Tasks in the inbox**

In `admin/src/app/(console)/inbox/page.tsx` fetch `api<{ tasks: Task[] }>("/tasks?open=1")` too, and above the alerts card render:

```tsx
      {tasks.tasks.length > 0 && (
        <Card>
          <h2 className="card-title" style={{ margin: "0 0 12px" }}>Open tasks</h2>
          <ul className="tasks">
            {tasks.tasks.map((t) => (
              <li key={t.id}>
                <span className="task-title">{t.tenantName ? <Link href={`/gyms/${t.tenantId}`}>{t.tenantName}</Link> : null}{t.tenantName ? ": " : ""}{t.title}</span>
                <span className="task-meta" style={t.dueAt && t.dueAt < Date.now() ? { color: "var(--red)" } : undefined}>{t.dueAt ? new Date(t.dueAt).toLocaleDateString("en-IE") : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
```

- [ ] **Step 7: Check, screenshot, commit**

Run: `cd admin && npx tsc --noEmit -p . && ADMIN_SESSION=$RAW node scripts/screens.mjs /tmp/screens gym gyms features`

```bash
git add admin/src/lib/types.ts "admin/src/app/(console)/gyms/[id]" admin/src/components/business admin/src/components/BusinessesTable.tsx admin/src/components/features/FeaturesPanel.tsx "admin/src/app/(console)/inbox/page.tsx" admin/src/app/globals.css
git commit -m "feat(console): business 360: stage, owner, tags, notes, tasks, setup progress, usage and churn risk

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Rollout flags page (console)

**Files:**
- Create: `admin/src/app/(console)/flags/page.tsx`, `admin/src/app/(console)/flags/actions.ts`, `admin/src/components/flags/FlagEditor.tsx`
- Modify: `admin/src/components/Shell.tsx`, `admin/src/lib/shortcuts.ts`, `admin/src/lib/shortcuts.test.ts`, `admin/src/lib/palette.ts`

- [ ] **Step 1: Shortcut first**

Add `assert.deepEqual(resolveShortcut("g", "f"), { kind: "go", href: "/flags" });` to the shortcuts test; run (fails); add `{ keys: "g f", label: "Feature flags", href: "/flags" }` to `SHORTCUTS` and `{ title: "Feature flags", hint: "g f", href: "/flags" }` to `STATIC_COMMANDS`; run (passes).

- [ ] **Step 2: Action, editor, page**

`admin/src/app/(console)/flags/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { api, ApiError } from "@/lib/api";
import { bust } from "@/lib/revalidate";
import type { PlatformFlag } from "@/lib/types";

export async function setFlagAction(flag: PlatformFlag): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await api("/flags", { method: "PUT", body: { flag } });
    bust();
    revalidatePath("/flags");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof ApiError ? err.message : "Could not save that rollout." };
  }
}
```

`admin/src/components/flags/FlagEditor.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { notify } from "@/lib/toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { setFlagAction } from "@/app/(console)/flags/actions";
import type { FleetTenantRow, PlatformFlag } from "@/lib/types";

/** One module's rollout: everyone, nobody, a percentage, or a named list. Saves on Apply, with a confirm that says how many businesses change. */
export function FlagEditor({ flag, label, count, total, tenants, isOwner }: { flag: PlatformFlag; label: string; count: number; total: number; tenants: FleetTenantRow[]; isOwner: boolean }) {
  const router = useRouter();
  const ask = useConfirm();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<PlatformFlag>(flag);
  const dirty = JSON.stringify(draft) !== JSON.stringify(flag);

  async function apply() {
    const r = await ask({
      title: `Change the rollout of ${label}`,
      body: draft.mode === "all" ? "Every business gets it." : draft.mode === "none" ? "No business gets it; their pages are refused and the module leaves their sidebar." : draft.mode === "percent" ? `About ${draft.percent}% of businesses get it, chosen by a stable hash so nobody flips back and forth.` : `${draft.allow.length} named ${draft.allow.length === 1 ? "business gets" : "businesses get"} it.`,
      confirmLabel: "Apply",
      danger: draft.mode === "none",
    });
    if (!r.ok) return;
    start(async () => {
      const res = await setFlagAction(draft);
      if (res.ok) { notify.ok(`${label}: rollout saved`); router.refresh(); } else notify.fail(res.error);
    });
  }

  return (
    <div className="flag">
      <div className="flag-head">
        <strong>{label}</strong>
        <span className="flag-count">{count} of {total} businesses</span>
      </div>
      <div className="toolbar">
        <select className="input" value={draft.mode} disabled={!isOwner} onChange={(e) => setDraft({ ...draft, mode: e.target.value as PlatformFlag["mode"] })}>
          <option value="all">Everyone</option>
          <option value="percent">A percentage</option>
          <option value="allow">Named businesses</option>
          <option value="none">Nobody</option>
        </select>
        {draft.mode === "percent" && (
          <label className="check">
            <input type="range" min={0} max={100} step={5} value={draft.percent} disabled={!isOwner} onChange={(e) => setDraft({ ...draft, percent: Number(e.target.value) })} />
            <span style={{ fontFamily: "var(--font-mono), ui-monospace, monospace", minWidth: 40 }}>{draft.percent}%</span>
          </label>
        )}
        {isOwner && dirty && <button type="button" className="btn btn--primary btn--sm" onClick={apply} disabled={pending}>Apply</button>}
        {isOwner && dirty && <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDraft(flag)} disabled={pending}>Reset</button>}
      </div>
      {draft.mode === "allow" && (
        <div className="flag-allow">
          {tenants.map((t) => (
            <label key={t.id} className="check">
              <input type="checkbox" checked={draft.allow.includes(t.id)} disabled={!isOwner} onChange={(e) => setDraft({ ...draft, allow: e.target.checked ? [...draft.allow, t.id] : draft.allow.filter((x) => x !== t.id) })} /> {t.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

`admin/src/app/(console)/flags/page.tsx`:

```tsx
import { api } from "@/lib/api";
import { requireAdminSession } from "@/lib/session";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { FlagEditor } from "@/components/flags/FlagEditor";
import type { FleetResponse, PlatformFlag, TenantFeatures } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Staged rollout of each module across the fleet. A business's own switch (Features tab) still wins when it is off. */
export default async function FlagsPage() {
  const me = await requireAdminSession();
  const [{ flags, counts, tenantIds }, fleet] = await Promise.all([
    api<{ flags: PlatformFlag[]; counts: Record<string, number>; tenantIds: number[] }>("/flags"),
    api<FleetResponse>("/fleet", { revalidate: 30, tags: ["fleet"] }),
  ]);
  // Labels come from any business's feature list; the catalog is the same for all.
  const first = fleet.tenants[0];
  const labels = first ? (await api<TenantFeatures>(`/tenants/${first.id}/features`)).modules : [];
  const label = (key: string) => labels.find((m) => m.key === key)?.label ?? key;
  const live = fleet.tenants.filter((t) => tenantIds.includes(t.id));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PageHeader eyebrow="Console" title="Feature flags" sub={me.role === "owner" ? "Roll a module out to everyone, a percentage, a named few, or nobody. A business switched off on its own Features tab stays off." : "Only an owner can change these."} />
      <Card style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        {flags.map((f) => (
          <FlagEditor key={f.key} flag={f} label={label(f.key)} count={counts[f.key] ?? 0} total={tenantIds.length} tenants={live} isOwner={me.role === "owner"} />
        ))}
      </Card>
    </div>
  );
}
```

Append to `admin/src/app/globals.css`:

```css
.flag { display: flex; flex-direction: column; gap: 10px; padding-bottom: 18px; border-bottom: 1px solid var(--grid); }
.flag:last-child { border-bottom: 0; padding-bottom: 0; }
.flag-head { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; }
.flag-count { font-family: var(--font-mono), ui-monospace, monospace; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-tertiary); }
.flag-allow { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px 16px; padding: 4px 0; }
input[type="range"] { accent-color: #ffffff; width: 180px; }
```

In `admin/src/components/Shell.tsx` add `{ href: "/flags", label: "Feature flags", icon: ToggleLeft }` to the Console group (import `ToggleLeft` from `lucide-react`).

- [ ] **Step 3: Check and commit**

Run: `cd admin && npx tsc --noEmit -p . && npm test 2>&1 | tail -1`

```bash
git add "admin/src/app/(console)/flags" admin/src/components/flags admin/src/components/Shell.tsx admin/src/lib/shortcuts.ts admin/src/lib/shortcuts.test.ts admin/src/lib/palette.ts admin/src/app/globals.css
git commit -m "feat(console): roll a module out to everyone, a percentage, named businesses or nobody

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Deploy the console and verify

- [ ] **Step 1: Checks and deploy**

```bash
cd admin && npx tsc --noEmit -p . && npm test 2>&1 | tail -1 && npx next build 2>&1 | tail -2
git push origin main && railway up --detach
```

- [ ] **Step 2: Verify**

On admin.adonisagent.ie open Optimal Health: the header shows its stage; the strip lets you set owner and add a tag; the Overview shows risk with reasons, setup progress with the stuck step, "What they use" (empty until the app has been used after the deploy; counts appear within a minute of a staff member opening a page), notes and tasks. Add a task due today: it appears in the Inbox. Businesses lists Stage, Risk and Setup columns and sorts by them. Feature flags: set Nutrition to "Named businesses" with none ticked and Apply: the Businesses count reads 0 of N, and inside a business the Nutrition module leaves the sidebar; set it back to Everyone.

---

## Self-review

**Spec coverage.** Business 360 overview (health score, lifecycle stage, owner, tags, merged timeline): Tasks 1, 6, 7; the merged timeline already exists on the Timeline tab (Tier 0) and gains alert rows via Tier 3 Task 8. Notes and tasks with due dates in the inbox: Tasks 1, 4, 6, 7. Onboarding progress on Overview and as a Businesses column: Tasks 2, 6, 7. Usage per feature on Overview and beside each module switch: Tasks 3, 6, 7. Churn risk with reasons, in the Businesses list, on Overview, and into the inbox: Tasks 4, 6, 7. Feature flags with percentage rollout and allowlist: Tasks 5, 6, 8.

**Placeholders.** Task 2 Step 3 names the fallback if a helper inside `detectForTenant` turns out to read the request tenant: the test tells you which, and the fix pattern is given. Task 6 Step 2 says how to find the billing fields if the summary names them differently, and gives the fallback query. Task 7 Step 5 asks the implementer to use the panel's real loop variable name; the JSX to insert is complete.

**Type consistency.** `Stage`/`TenantMeta` (app, Task 1) match admin's (Task 7). `SetupSummary` fields map onto `SetupView` (Task 6 Step 2 lists the mapping). `Risk` is the same shape in both. `Note`, `Task`, `ModuleUsage`, `PlatformFlag` are declared identically on both sides. `FleetTenantRow` gains `setup`, `risk`, `stage` in both `fleet.ts` (Task 6) and `admin/src/lib/types.ts` (Task 7). `setFlagAction` sends `{ flag }` which `PUT /flags` expects.
