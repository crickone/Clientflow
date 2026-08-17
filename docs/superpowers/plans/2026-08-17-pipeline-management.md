# Pipeline Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each tenant edit their own pipeline stages (add / rename / recolour / reorder / delete) from a settings screen, keep the auto-advance engine working via **stage roles**, and segment the board by campaign / therapy / source — built on the existing `lib/pipeline` engine and the kanban board, with zero visible change until someone edits.

**Architecture:** A new per-tenant `pipeline_stages` table + a `leads.stage_id` FK replace the hardcoded 9-stage vocabulary; a fixed **role** vocabulary (9 roles) tags stages so events target a role, not a name. An idempotent migration seeds today's 9 stages and backfills `stage_id`, so day one is identical. The change is **expand → migrate → contract**: the role model is added alongside the old `STAGES`/`PipelineStage` exports; the engine dual-writes `pipeline_stage` (frozen) while readers migrate to `stage_id`/role task-by-task; dead exports are removed last. Segmentation is client-side filtering over the already-loaded leads feeding the pure `computeBoardMetrics`.

**Tech Stack:** Next.js 14 App Router, drizzle-orm 0.45 + better-sqlite3 (synchronous), `@dnd-kit/core` (already a dep), `motion` v12, `sonner`, `zod`, the plain-tsx assert test runner.

## Global Constraints

- **No breaking the deploy:** every task must leave `npm run typecheck` and `npm test` green. Removals happen only in the final contract task (Task 11), once all readers have migrated.
- **Fixed role vocabulary (closed set of 9):** `new · engaged · booked · no_show · attended · won · repeat · lapsed · lost`. Users tag stages with roles; they never invent roles. Legacy name → role map is exact: `new_lead→new, hot_lead→engaged, consultation_booked→booked, no_show→no_show, attended→attended, sale→won, repeat_customer→repeat, lapsed→lapsed, lost→lost`.
- **Out-of-band roles keep `rank:0` semantics:** `lost` is frozen (no auto event moves it); from `lapsed`, any forward funnel event pulls the lead out. `position` orders the board for display but does NOT order these two for advancement.
- **Invariants:** always ≥1 stage; each role used at most once per tenant; entry stage = the `role:new` stage, else the lowest `position`.
- **Additive DDL → `ensureTenantTables`; one-time backfill → a versioned `TENANT_MIGRATIONS` entry** (see `migrations/index.ts` division of labour). The migration is transactional + idempotent.
- **`leads.pipeline_stage` (text) is frozen** — kept for the backfill + rollback; dual-written by the engine during transition; never the source of truth after Task 6.
- **The lapse job (`lapse.ts`) runs outside request context** on a raw `TenantDb` connection — it must use connection-based resolvers, never the request-scoped `db` proxy.
- **Token-driven styling**; admin-only settings (`requireAdminPage`/`requireAdmin`); tenant-scoped everything (never a client-supplied tenant id).
- **Test runner** `node scripts/test.mjs` — pure `*.test.ts` only, no DB. Gate before done: `npm run typecheck && npm test && npx next build` (run from `app/`).

## File structure

- **Create** `app/src/lib/pipeline/roles.ts` — pure: `StageRole` union, `STAGE_ROLES` metadata, `DEFAULT_STAGES` seed array, `LEGACY_KEY_TO_ROLE`, `roleOf`, role-sets, `shouldAdvance`, invariant helpers. No `server-only` (testable).
- **Create** `app/src/lib/pipeline/stageRepo.ts` — `server-only`: DB access for stages (request-scoped + `*OnConn` variants) + CRUD.
- **Create** `app/src/app/settings/pipeline/{page.tsx,actions.ts}` + `app/src/components/settings/PipelineStagesManager.tsx`.
- **Modify** `schema.ts` (add `pipelineStages` table + `leads.stageId`), `tenant.ts` (`ensureTenantTables`), `migrations/index.ts` (seed+backfill migration), `lib/pipeline/{stage.ts,stages.ts,lapse.ts,boardMetrics.ts}`, `lib/pipeline/metrics.ts`, `lib/leads.ts`, the board components + `LeadDetail`/`LeadList`, `tools.sales.ts` (+ its tests), `leads/actions.ts`, `settings/page.tsx`.
- **Keep** `stages.ts`'s `STAGES`/`STAGE_ORDER`/`PipelineStage`/`nextAutoStage` until Task 11.

---

### Task 1: Schema — `pipeline_stages` table + `leads.stage_id`

**Files:**
- Modify: `app/src/lib/db/schema.ts` (add `pipelineStages` table; add `stageId` to `leads`)
- Modify: `app/src/lib/db/tenant.ts` (`ensureTenantTables` ~line 411: add `CREATE TABLE IF NOT EXISTS pipeline_stages`; near line 1345 add the PRAGMA-guarded `ALTER TABLE leads ADD COLUMN stage_id`)

**Interfaces:**
- Produces: drizzle `pipelineStages` table (`id, name, colour, position, role, createdAt`); `leads.stageId` (`integer("stage_id")`, nullable). Types `PipelineStageRow = typeof pipelineStages.$inferSelect`.

- [ ] **Step 1: Add the drizzle table + column in `schema.ts`**

After the `leads` table definition, add:

```ts
/**
 * Per-tenant, editable pipeline stages (Pipeline Management). Replaces the
 * hardcoded 9-stage vocabulary in lib/pipeline/stages.ts. `role` (nullable) is
 * one of the fixed StageRole values and is unique-per-tenant where set — it's
 * how the auto-advance engine targets a stage without depending on its name.
 * `position` drives board order + funnel advancement.
 */
export const pipelineStages = sqliteTable(
  "pipeline_stages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    colour: text("colour").notNull(),
    position: integer("position").notNull(),
    role: text("role"), // StageRole | null; app-enforced unique-where-set
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({ byRole: uniqueIndex("idx_pipeline_stages_role").on(t.role) }),
);
```

Then add to the `leads` table object (after `pipelineStage`, before `clientId`):

```ts
  // Pipeline Management: the editable-stage FK. Supersedes `pipelineStage` (which
  // is frozen: kept for backfill + rollback, dual-written during transition).
  stageId: integer("stage_id").references(() => pipelineStages.id),
```

> Note on the unique index: SQLite treats each `NULL` as distinct, so `uniqueIndex` on `role` allows many null-role stages while enforcing at most one of each non-null role — exactly the invariant.

- [ ] **Step 2: Create the table in `ensureTenantTables`**

In `app/src/lib/db/tenant.ts`, inside `ensureTenantTables` (the `sqlite.exec(\`…\`)` block of `CREATE TABLE IF NOT EXISTS` statements, ~line 411+), add:

```sql
    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      colour TEXT NOT NULL,
      position INTEGER NOT NULL,
      role TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_role ON pipeline_stages(role);
```

- [ ] **Step 3: Add the `stage_id` column (PRAGMA-guarded), mirroring the existing `pipeline_stage` add at ~line 1345**

In `tenant.ts`, alongside the other `PRAGMA table_info(leads)` guarded ALTERs, add:

```ts
  {
    const cols = sqlite.prepare("PRAGMA table_info(leads)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "stage_id")) {
      sqlite.exec("ALTER TABLE leads ADD COLUMN stage_id INTEGER REFERENCES pipeline_stages(id)");
    }
  }
```

- [ ] **Step 4: Typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS (additive only).

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/db/schema.ts src/lib/db/tenant.ts
git commit -m "feat(pipeline): pipeline_stages table + leads.stage_id column (additive)"
```

---

### Task 2: Pure role model + `shouldAdvance` (TDD)

**Files:**
- Create: `app/src/lib/pipeline/roles.ts`
- Test: `app/src/lib/pipeline/roles.test.ts`

**Interfaces:**
- Produces:
  - `type StageRole = "new"|"engaged"|"booked"|"no_show"|"attended"|"won"|"repeat"|"lapsed"|"lost"`
  - `ALL_ROLES: StageRole[]`, `OUT_OF_BAND: ReadonlySet<StageRole>` (`{lapsed, lost}`), `WON_ROLES`/`INACTIVE_ROLES`/`STALE_SUPPRESSED_ROLES: ReadonlySet<StageRole>`
  - `DEFAULT_STAGES: { name; colour; position; role: StageRole }[]` (the 9 canonical, in order)
  - `LEGACY_KEY_TO_ROLE: Record<string, StageRole>`; `roleOf(legacyKey: string): StageRole | null`
  - `ROLE_HINTS: Record<StageRole, string>` (settings UI copy)
  - `interface StageLike { position: number; role: StageRole | null }`
  - `shouldAdvance(current: StageLike, candidate: StageLike): boolean`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/pipeline/roles.test.ts`:

```ts
/**
 * Pure tests for the pipeline role model. No I/O, no DB.
 * Run: npm test -- src/lib/pipeline/roles.test.ts
 */
import assert from "node:assert/strict";

import {
  DEFAULT_STAGES,
  LEGACY_KEY_TO_ROLE,
  roleOf,
  shouldAdvance,
  ALL_ROLES,
  type StageRole,
} from "./roles";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${expected}, got ${actual}`);
  passed++;
  console.log("  ✓", name);
}

// DEFAULT_STAGES: 9 canonical, ordered, each with a role, positions 0..8, unique roles.
check("9 default stages", DEFAULT_STAGES.length, 9);
check("positions are 0..8 in order", DEFAULT_STAGES.map((s) => s.position), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
check("default roles in funnel order", DEFAULT_STAGES.map((s) => s.role), [
  "new", "engaged", "booked", "no_show", "attended", "won", "repeat", "lapsed", "lost",
]);
check("every default stage has a name + hex colour", DEFAULT_STAGES.every((s) => s.name.length > 0 && /^#[0-9a-fA-F]{6}$/.test(s.colour)), true);
check("default roles are unique", new Set(DEFAULT_STAGES.map((s) => s.role)).size, 9);

// LEGACY_KEY_TO_ROLE covers all 9 old keys; roleOf resolves + is null for unknown.
check("legacy map covers all 9 keys", Object.keys(LEGACY_KEY_TO_ROLE).length, 9);
check("hot_lead → engaged", roleOf("hot_lead"), "engaged");
check("sale → won", roleOf("sale"), "won");
check("repeat_customer → repeat", roleOf("repeat_customer"), "repeat");
check("unknown key → null", roleOf("nonsense"), null);
check("ALL_ROLES has 9", ALL_ROLES.length, 9);

// shouldAdvance — funnel: forward-only by position among funnel stages.
const S = (position: number, role: StageRole | null) => ({ position, role });
check("new→engaged advances (pos up)", shouldAdvance(S(0, "new"), S(1, "engaged")), true);
check("engaged→new does NOT regress", shouldAdvance(S(1, "engaged"), S(0, "new")), false);
check("same stage no-op", shouldAdvance(S(2, "booked"), S(2, "booked")), false);
check("won→engaged does NOT regress (existing customer reply)", shouldAdvance(S(5, "won"), S(1, "engaged")), false);

// Out-of-band: lost frozen; lapsed pull-out to any funnel stage.
check("lost is frozen (lost→won blocked even forward)", shouldAdvance(S(8, "lost"), S(5, "won")), false);
check("lost→engaged blocked", shouldAdvance(S(8, "lost"), S(1, "engaged")), false);
check("lapsed→won pulls out (even though lapsed.position > won.position)", shouldAdvance(S(7, "lapsed"), S(5, "won")), true);
check("lapsed→repeat pulls out", shouldAdvance(S(7, "lapsed"), S(6, "repeat")), true);
check("lapsed→lapsed no-op", shouldAdvance(S(7, "lapsed"), S(7, "lapsed")), false);

// Candidate into an out-of-band role is never an 'advance' via this fn (lapse job / manual set it directly).
check("funnel→lapsed not via shouldAdvance", shouldAdvance(S(5, "won"), S(7, "lapsed")), false);
check("funnel→lost not via shouldAdvance", shouldAdvance(S(5, "won"), S(8, "lost")), false);

// A null-role (manual-only) stage never auto-advances in or out.
check("null-role current → no advance", shouldAdvance(S(3, null), S(4, "attended")), false);
check("advance INTO null-role blocked", shouldAdvance(S(1, "engaged"), S(3, null)), false);

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd app && npm test -- src/lib/pipeline/roles.test.ts`
Expected: FAIL — `Cannot find module './roles'`.

- [ ] **Step 3: Implement `roles.ts`**

Create `app/src/lib/pipeline/roles.ts`:

```ts
/**
 * Pure pipeline ROLE model (Pipeline Management). Stages themselves are now
 * per-tenant DB rows (schema.pipelineStages); this file holds the fixed role
 * vocabulary those stages are tagged with, the seed defaults, the legacy
 * name→role map for the one-time backfill, and the pure advancement decision.
 * NO `server-only`, no DB — loads under the plain-tsx test runner (mirrors
 * boardMetrics.ts / humanName.ts).
 */

export type StageRole =
  | "new"
  | "engaged"
  | "booked"
  | "no_show"
  | "attended"
  | "won"
  | "repeat"
  | "lapsed"
  | "lost";

export const ALL_ROLES: StageRole[] = [
  "new", "engaged", "booked", "no_show", "attended", "won", "repeat", "lapsed", "lost",
];

/** The two out-of-band roles (today's rank:0): not ordered by position for advancement. */
export const OUT_OF_BAND: ReadonlySet<StageRole> = new Set<StageRole>(["lapsed", "lost"]);

// Role sets consumed by boardMetrics (Task 7).
export const WON_ROLES: ReadonlySet<StageRole> = new Set<StageRole>(["won", "repeat"]);
export const INACTIVE_ROLES: ReadonlySet<StageRole> = new Set<StageRole>(["won", "repeat", "lost"]);
export const STALE_SUPPRESSED_ROLES: ReadonlySet<StageRole> = new Set<StageRole>(["won", "repeat", "lost"]);

/** The 9 canonical stages seeded for every tenant — matches today's STAGES record verbatim. */
export const DEFAULT_STAGES: { name: string; colour: string; position: number; role: StageRole }[] = [
  { name: "New lead", colour: "#8b949e", position: 0, role: "new" },
  { name: "Hot lead", colour: "#ef5a24", position: 1, role: "engaged" },
  { name: "Consultation booked", colour: "#3b82f6", position: 2, role: "booked" },
  { name: "No-show", colour: "#d29922", position: 3, role: "no_show" },
  { name: "Attended", colour: "#2ea043", position: 4, role: "attended" },
  { name: "Sale", colour: "#1f9d55", position: 5, role: "won" },
  { name: "Repeat customer", colour: "#8a3fd1", position: 6, role: "repeat" },
  { name: "Lapsed", colour: "#6e7681", position: 7, role: "lapsed" },
  { name: "Lost", colour: "#484f58", position: 8, role: "lost" },
];

/** Old `leads.pipeline_stage` text value → role, for the one-time backfill. */
export const LEGACY_KEY_TO_ROLE: Record<string, StageRole> = {
  new_lead: "new",
  hot_lead: "engaged",
  consultation_booked: "booked",
  no_show: "no_show",
  attended: "attended",
  sale: "won",
  repeat_customer: "repeat",
  lapsed: "lapsed",
  lost: "lost",
};

/** Reverse: role → the legacy key the engine dual-writes into the frozen column during transition. */
export const ROLE_TO_LEGACY_KEY: Record<StageRole, string> = {
  new: "new_lead",
  engaged: "hot_lead",
  booked: "consultation_booked",
  no_show: "no_show",
  attended: "attended",
  won: "sale",
  repeat: "repeat_customer",
  lapsed: "lapsed",
  lost: "lost",
};

export function roleOf(legacyKey: string): StageRole | null {
  return LEGACY_KEY_TO_ROLE[legacyKey] ?? null;
}

/** Plain-English hints for the settings role dropdown. */
export const ROLE_HINTS: Record<StageRole, string> = {
  new: "New — where fresh leads land.",
  engaged: "Engaged — set automatically when a lead replies.",
  booked: "Booked — set when a consultation is booked.",
  no_show: "No-show — set when a booked lead doesn't attend.",
  attended: "Attended — set when a lead attends.",
  won: "Won — set on first payment.",
  repeat: "Repeat — set on a second payment.",
  lapsed: "Lapsed — set automatically after 90 days inactive.",
  lost: "Lost — a dead lead (never moved automatically).",
};

export interface StageLike {
  position: number;
  role: StageRole | null;
}

/**
 * PURE forward-only decision, role-aware. Mirrors today's rank semantics:
 *  - a `lost` current stage is frozen (no auto event moves it);
 *  - a `lapsed` current stage is pulled out by ANY forward funnel event
 *    (candidate must be a FUNNEL — non-out-of-band — role);
 *  - among funnel stages, advance only if candidate.position > current.position;
 *  - a candidate that is itself out-of-band (lapsed/lost) is never reached via
 *    this fn (the lapse job / manual override set those directly);
 *  - a null-role stage (manual-only) never auto-advances in or out.
 */
export function shouldAdvance(current: StageLike, candidate: StageLike): boolean {
  if (candidate.role == null || OUT_OF_BAND.has(candidate.role)) return false;
  if (current.role === "lost") return false;
  if (current.role === "lapsed") return true; // pull-out to any funnel stage
  if (current.role == null) return false;
  return candidate.position > current.position;
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `cd app && npm test -- src/lib/pipeline/roles.test.ts`
Expected: PASS — all checks pass.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/pipeline/roles.ts src/lib/pipeline/roles.test.ts
git commit -m "feat(pipeline): pure role model + shouldAdvance (roles, seed defaults, legacy map)"
```

---

### Task 3: Migration — seed 9 stages + backfill `leads.stage_id`

**Files:**
- Modify: `app/src/lib/db/migrations/index.ts` (add `0002-seed-pipeline-stages` to `TENANT_MIGRATIONS`)

**Interfaces:**
- Consumes: `DEFAULT_STAGES`, `LEGACY_KEY_TO_ROLE` from `@/lib/pipeline/roles`.
- Produces: (DB effect only) every tenant DB gets its 9 stages + every lead's `stage_id` set.

- [ ] **Step 1: Add the migration**

In `app/src/lib/db/migrations/index.ts`, import at top:

```ts
import { DEFAULT_STAGES, LEGACY_KEY_TO_ROLE } from "@/lib/pipeline/roles";
```

Append to the `TENANT_MIGRATIONS` array (after `0001-baseline`):

```ts
  {
    id: "0002-seed-pipeline-stages",
    description:
      "Seed the 9 canonical pipeline_stages (once, if empty) and backfill leads.stage_id from the frozen pipeline_stage text via role.",
    up: (sqlite) => {
      const count = (sqlite.prepare("SELECT count(*) AS n FROM pipeline_stages").get() as { n: number }).n;
      if (count === 0) {
        const insert = sqlite.prepare(
          "INSERT INTO pipeline_stages (name, colour, position, role, created_at) VALUES (?, ?, ?, ?, ?)",
        );
        const now = Date.now();
        for (const s of DEFAULT_STAGES) insert.run(s.name, s.colour, s.position, s.role, now);
      }
      // Backfill: map each lead's old text key → role → the seeded stage of that role.
      const stageIdByRole = new Map<string, number>();
      for (const row of sqlite.prepare("SELECT id, role FROM pipeline_stages").all() as Array<{ id: number; role: string | null }>) {
        if (row.role) stageIdByRole.set(row.role, row.id);
      }
      const setStage = sqlite.prepare("UPDATE leads SET stage_id = ? WHERE id = ?");
      const leads = sqlite.prepare("SELECT id, pipeline_stage FROM leads WHERE stage_id IS NULL").all() as Array<{ id: number; pipeline_stage: string }>;
      for (const l of leads) {
        const role = LEGACY_KEY_TO_ROLE[l.pipeline_stage] ?? "new";
        const stageId = stageIdByRole.get(role) ?? stageIdByRole.get("new");
        if (stageId != null) setStage.run(stageId, l.id);
      }
    },
  },
```

> The migration runs inside a transaction (see `runMigrations`); `ensureTenantTables` (Task 1) has already created the table + column before this runs (tenant.ts calls `ensureTenantTables` then `runMigrations`). Idempotent: the empty-check guards re-seeding; the framework records the id so `up()` never re-runs.

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Smoke the migration on a throwaway DB**

Run:
```bash
cd app && npx tsx -e '
import Database from "better-sqlite3";
import { ensureTenantTables } from "./src/lib/db/tenant";
import { runMigrations, TENANT_MIGRATIONS } from "./src/lib/db/migrations";
const db = new Database(":memory:");
ensureTenantTables(db);
db.exec("INSERT INTO leads (source, pipeline_stage) VALUES (\"facebook\", \"sale\"), (\"manual\", \"new_lead\")");
runMigrations(db, TENANT_MIGRATIONS);
console.log("stages:", db.prepare("SELECT count(*) n FROM pipeline_stages").get());
console.log("leads:", db.prepare("SELECT l.id, l.pipeline_stage, s.role FROM leads l JOIN pipeline_stages s ON s.id = l.stage_id").all());
'
```
Expected: `stages: { n: 9 }` and both leads joined to a stage whose `role` matches (`sale→won`, `new_lead→new`). (`NODE_OPTIONS=--conditions=react-server` is applied by the test runner but not needed here since we import directly; if the import errors on `server-only`, prefix the command with `NODE_OPTIONS=--conditions=react-server`.)

- [ ] **Step 4: Commit**

```bash
cd app && git add src/lib/db/migrations/index.ts
git commit -m "feat(pipeline): migration seeds 9 stages + backfills leads.stage_id from pipeline_stage"
```

---

### Task 4: Stage repository + pure invariants (TDD for the pure parts)

**Files:**
- Create: `app/src/lib/pipeline/stageRepo.ts`
- Test: `app/src/lib/pipeline/stageInvariants.test.ts`
- Modify: `app/src/lib/pipeline/roles.ts` (add the pure invariant helpers — they belong with the pure model)

**Interfaces:**
- Produces (pure, in `roles.ts`):
  - `interface StageRecord { id: number; name: string; colour: string; position: number; role: StageRole | null }`
  - `resolveEntryStage(stages: StageRecord[]): StageRecord | null` (role `new`, else lowest position)
  - `canDeleteStage(stages: StageRecord[], id: number): { ok: true } | { ok: false; reason: string }` (blocks last stage)
  - `roleConflict(stages: StageRecord[], role: StageRole, exceptId: number | null): StageRecord | null` (the stage already holding `role`, if any)
- Produces (`stageRepo.ts`, server-only): `listStages()`, `listStagesOnConn(conn)`, `resolveStageIdByRole(role)`, `resolveStageIdByRoleOnConn(conn, role)`, `resolveEntryStageId()`, `resolveEntryStageIdOnConn(conn)`, `createStage`, `updateStage`, `reorderStages`, `deleteStageWithMove`.

- [ ] **Step 1: Write the failing test for the pure invariants**

Create `app/src/lib/pipeline/stageInvariants.test.ts`:

```ts
/**
 * Pure tests for stage invariants (no DB). Run: npm test -- src/lib/pipeline/stageInvariants.test.ts
 */
import assert from "node:assert/strict";
import { resolveEntryStage, canDeleteStage, roleConflict, type StageRecord } from "./roles";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  passed++;
  console.log("  ✓", name);
}

const mk = (id: number, position: number, role: StageRecord["role"], name = `S${id}`): StageRecord =>
  ({ id, name, colour: "#8b949e", position, role });

const stages = [mk(10, 0, "new"), mk(11, 1, "engaged"), mk(12, 2, null)];

check("entry stage = the role:new stage", resolveEntryStage(stages)?.id, 10);
check("entry falls back to lowest position when no role:new", resolveEntryStage([mk(20, 3, null), mk(21, 1, null)])?.id, 21);
check("entry of empty list is null", resolveEntryStage([]), null);

check("can delete a non-last stage", canDeleteStage(stages, 11), { ok: true });
check("cannot delete the last remaining stage", canDeleteStage([mk(30, 0, "new")], 30), { ok: false, reason: "A pipeline needs at least one stage." });

check("role conflict finds the holder", roleConflict(stages, "engaged", null)?.id, 11);
check("role conflict ignores the excepted id (self-edit)", roleConflict(stages, "engaged", 11), null);
check("no conflict for an unused role", roleConflict(stages, "won", null), null);

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd app && npm test -- src/lib/pipeline/stageInvariants.test.ts`
Expected: FAIL — `resolveEntryStage` / `canDeleteStage` / `roleConflict` / `StageRecord` not exported.

- [ ] **Step 3: Add the pure helpers to `roles.ts`**

Append to `app/src/lib/pipeline/roles.ts`:

```ts
export interface StageRecord {
  id: number;
  name: string;
  colour: string;
  position: number;
  role: StageRole | null;
}

/** The stage new leads enter: the `role:new` stage, else the lowest position, else null. */
export function resolveEntryStage(stages: StageRecord[]): StageRecord | null {
  if (stages.length === 0) return null;
  const byRole = stages.find((s) => s.role === "new");
  if (byRole) return byRole;
  return stages.reduce((lo, s) => (s.position < lo.position ? s : lo));
}

/** Guard: a pipeline must always keep ≥1 stage. */
export function canDeleteStage(stages: StageRecord[], id: number): { ok: true } | { ok: false; reason: string } {
  if (stages.length <= 1) return { ok: false, reason: "A pipeline needs at least one stage." };
  return { ok: true };
}

/** The stage currently holding `role` (other than `exceptId`), or null — for the unique-role guard. */
export function roleConflict(stages: StageRecord[], role: StageRole, exceptId: number | null): StageRecord | null {
  return stages.find((s) => s.role === role && s.id !== exceptId) ?? null;
}
```

- [ ] **Step 4: Run — verify pass**

Run: `cd app && npm test -- src/lib/pipeline/stageInvariants.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the DB repository**

Create `app/src/lib/pipeline/stageRepo.ts`:

```ts
import "server-only";
import { asc, eq } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import type { TenantDb } from "@/lib/db/tenant";
import { resolveEntryStage, type StageRecord, type StageRole } from "./roles";

const SELECT = {
  id: schema.pipelineStages.id,
  name: schema.pipelineStages.name,
  colour: schema.pipelineStages.colour,
  position: schema.pipelineStages.position,
  role: schema.pipelineStages.role,
} as const;

function normalize(rows: Array<{ id: number; name: string; colour: string; position: number; role: string | null }>): StageRecord[] {
  return rows.map((r) => ({ ...r, role: (r.role as StageRole | null) }));
}

/** All stages for the current tenant, ordered by position (request-scoped). */
export function listStages(): StageRecord[] {
  return normalize(db.select(SELECT).from(schema.pipelineStages).orderBy(asc(schema.pipelineStages.position)).all());
}

/** Connection-based variant for the lapse job (no request context). */
export function listStagesOnConn(conn: TenantDb): StageRecord[] {
  return normalize(conn.select(SELECT).from(schema.pipelineStages).orderBy(asc(schema.pipelineStages.position)).all());
}

export function resolveStageIdByRole(role: StageRole): number | null {
  const row = db.select({ id: schema.pipelineStages.id }).from(schema.pipelineStages).where(eq(schema.pipelineStages.role, role)).get();
  return row?.id ?? null;
}
export function resolveStageIdByRoleOnConn(conn: TenantDb, role: StageRole): number | null {
  const row = conn.select({ id: schema.pipelineStages.id }).from(schema.pipelineStages).where(eq(schema.pipelineStages.role, role)).get();
  return row?.id ?? null;
}

export function resolveEntryStageId(): number | null {
  return resolveEntryStage(listStages())?.id ?? null;
}
export function resolveEntryStageIdOnConn(conn: TenantDb): number | null {
  return resolveEntryStage(listStagesOnConn(conn))?.id ?? null;
}

export function createStage(input: { name: string; colour: string; role: StageRole | null }): void {
  const maxPos = db.select({ p: schema.pipelineStages.position }).from(schema.pipelineStages).orderBy(asc(schema.pipelineStages.position)).all();
  const position = (maxPos.length ? Math.max(...maxPos.map((r) => r.p)) : -1) + 1;
  db.insert(schema.pipelineStages).values({ name: input.name, colour: input.colour, position, role: input.role }).run();
}

export function updateStage(id: number, patch: { name?: string; colour?: string; role?: StageRole | null }): void {
  db.update(schema.pipelineStages).set(patch).where(eq(schema.pipelineStages.id, id)).run();
}

/** Persist a new order: positions become the index in `orderedIds`. */
export function reorderStages(orderedIds: number[]): void {
  const tx = db.transaction((ids: number[]) => {
    ids.forEach((id, i) => db.update(schema.pipelineStages).set({ position: i }).where(eq(schema.pipelineStages.id, id)).run());
  });
  tx(orderedIds);
}

/** Move any leads on `id` to `moveToId`, then delete `id` — atomically. */
export function deleteStageWithMove(id: number, moveToId: number): void {
  const tx = db.transaction(() => {
    db.update(schema.leads).set({ stageId: moveToId }).where(eq(schema.leads.stageId, id)).run();
    db.delete(schema.pipelineStages).where(eq(schema.pipelineStages.id, id)).run();
  });
  tx();
}
```

- [ ] **Step 6: Typecheck + commit**

Run: `cd app && npm run typecheck`
Expected: PASS.

```bash
cd app && git add src/lib/pipeline/roles.ts src/lib/pipeline/stageInvariants.test.ts src/lib/pipeline/stageRepo.ts
git commit -m "feat(pipeline): stage repository (list/resolve/CRUD + conn variants) + pure invariants"
```

---

### Task 5: Engine + lapse job → roles / stage_id (signatures preserved; dual-write)

**Files:**
- Modify: `app/src/lib/pipeline/stage.ts` (rewrite internals of `advanceStage`, `writeStage`, `setStageManual`, `currentStage`; keep the 5 event-hook signatures)
- Modify: `app/src/lib/pipeline/lapse.ts` (`writeLapseStage` + the two selects → roles/stage_id via `*OnConn`)

**Interfaces:**
- Consumes: `resolveStageIdByRole`, `resolveEntryStageId`, `listStages` (+ `*OnConn`) from `./stageRepo`; `shouldAdvance`, `ROLE_TO_LEGACY_KEY`, `type StageRole` from `./roles`.
- Produces (unchanged public API): `advanceStage(leadId, role: StageRole)`, `setStageManual(leadId, stage: PipelineStage)` (name-based, still — resolves internally), the 5 hooks. **New:** `writeStageId(leadId, stageId)`.
- Note: `advanceStage`'s 2nd arg was `PipelineStage` (a name); it is now `StageRole`. Its only callers are the hooks in THIS file, which this task updates to pass roles — so no external break.

- [ ] **Step 1: Rewrite `stage.ts`**

Replace the body of `app/src/lib/pipeline/stage.ts` with:

```ts
import "server-only";

import { and, eq, gt, sql } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { logActivity } from "@/lib/queries";
import { listStages, resolveStageIdByRole, resolveEntryStageId } from "./stageRepo";
import { shouldAdvance, ROLE_TO_LEGACY_KEY, roleOf, type StageRecord, type StageRole } from "./roles";

// Legacy re-exports kept until the contract task (Task 11); readers migrate off these.
export { STAGES, STAGE_ORDER, nextAutoStage } from "./stages";
export type { PipelineStage } from "./stages";
export type { StageRole } from "./roles";

/** The lead's current stage record (id/position/role), or null if the lead is missing. */
export function currentStageRecord(leadId: number): StageRecord | null {
  const row = db.select({ stageId: schema.leads.stageId }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!row || row.stageId == null) return null;
  return listStages().find((s) => s.id === row.stageId) ?? null;
}

/**
 * Canonical writer: set a lead's stage_id + dual-write the frozen pipeline_stage
 * text (from the stage's role → legacy key) so not-yet-migrated readers/tests keep
 * working during the transition. Logs an activity row.
 */
export function writeStageId(leadId: number, stageId: number, note: string): void {
  const stage = listStages().find((s) => s.id === stageId);
  const legacy = stage?.role ? ROLE_TO_LEGACY_KEY[stage.role] : undefined;
  db.update(schema.leads)
    .set({ stageId, ...(legacy ? { pipelineStage: legacy as typeof schema.leads.$inferInsert.pipelineStage } : {}), updatedAt: new Date() })
    .where(eq(schema.leads.id, leadId))
    .run();
  void logActivity("pipeline.stage", note, { leadId });
}

/**
 * Forward-only auto-advance to the tenant's stage tagged `role`. No-ops if the
 * lead is missing, the tenant has no stage for that role, or `shouldAdvance`
 * says no (lost frozen / lapsed pull-out / forward-only-by-position).
 */
export function advanceStage(leadId: number, role: StageRole): void {
  const cur = currentStageRecord(leadId);
  if (!cur) return;
  const targetId = resolveStageIdByRole(role);
  if (targetId == null) return; // this tenant doesn't use that role → automation off
  const stages = listStages();
  const candidate = stages.find((s) => s.id === targetId);
  if (!candidate) return;
  if (!shouldAdvance(cur, candidate)) return;
  writeStageId(leadId, candidate.id, `Lead moved to ${candidate.name}`);
}

/** Operator override — set ANY stage by id (drag / picker / agent), bypassing forward-only. */
export function setStageToId(leadId: number, stageId: number): void {
  const exists = db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.id, leadId)).get();
  if (!exists) return;
  const stage = listStages().find((s) => s.id === stageId);
  if (!stage) return;
  writeStageId(leadId, stageId, `Lead set to ${stage.name} (manual)`);
}

/** Legacy name-based manual override — kept for callers not yet migrated (leads/actions, tools.sales). */
export function setStageManual(leadId: number, stage: import("./stages").PipelineStage): void {
  const role = roleOf(stage);
  const id = role ? resolveStageIdByRole(role) : null;
  if (id != null) setStageToId(leadId, id);
}

export function leadIdForClient(clientId: number): number | null {
  const row = db.select({ id: schema.leads.id }).from(schema.leads).where(eq(schema.leads.clientId, clientId)).get();
  return row?.id ?? null;
}

// ── Event hooks (signatures UNCHANGED — call sites in appointments/packages/whatsapp untouched) ──
export function onInboundFromLead(leadId: number): void {
  advanceStage(leadId, "engaged");
}
export function onInboundFromClient(clientId: number): void {
  const leadId = leadIdForClient(clientId);
  if (leadId) advanceStage(leadId, "engaged");
}
export function onAppointmentBooked(clientId: number, status: string): void {
  const leadId = leadIdForClient(clientId);
  if (!leadId) return;
  advanceStage(leadId, "booked");
  if (status === "completed") advanceStage(leadId, "attended");
  else if (status === "no_show") advanceStage(leadId, "no_show");
}
export function onAppointmentStatus(appointmentId: number, status: string): void {
  if (status !== "completed" && status !== "no_show") return;
  const appt = db.select({ clientId: schema.appointments.clientId }).from(schema.appointments).where(eq(schema.appointments.id, appointmentId)).get();
  if (!appt) return;
  const leadId = leadIdForClient(appt.clientId);
  if (!leadId) return;
  advanceStage(leadId, status === "completed" ? "attended" : "no_show");
}
export function onPaymentRecorded(clientId: number): void {
  const leadId = leadIdForClient(clientId);
  if (!leadId) return;
  const row = db.select({ n: sql<number>`count(*)` }).from(schema.payments).where(and(eq(schema.payments.clientId, clientId), gt(schema.payments.amountEur, 0))).get();
  const paid = Number(row?.n ?? 0);
  if (paid >= 2) advanceStage(leadId, "repeat");
  else if (paid >= 1) advanceStage(leadId, "won");
}
```

> `currentStage` (the old name-returning fn) is used by `tools.sales.ts` — it's replaced by `currentStageRecord`. `tools.sales.ts` migrates in Task 9; until then it imports `currentStage`. To keep it green now, ALSO keep a thin legacy `currentStage`:

Add to `stage.ts`:

```ts
/** Legacy name accessor — kept for tools.sales until Task 9. */
export function currentStage(leadId: number): import("./stages").PipelineStage | null {
  const rec = currentStageRecord(leadId);
  if (!rec?.role) return null;
  return ROLE_TO_LEGACY_KEY[rec.role] as import("./stages").PipelineStage;
}
```

- [ ] **Step 2: Rewrite the lapse job to roles/stage_id (connection-based)**

In `app/src/lib/pipeline/lapse.ts`, replace `writeLapseStage` and the two stage selects. Add import:

```ts
import { resolveStageIdByRoleOnConn } from "./stageRepo";
import { ROLE_TO_LEGACY_KEY, type StageRole } from "./roles";
```

Replace `writeLapseStage`:

```ts
function writeLapseStage(conn: TenantDb, leadId: number, role: "lapsed" | "won" | "repeat"): void {
  const stageId = resolveStageIdByRoleOnConn(conn, role);
  if (stageId == null) return; // tenant doesn't use this role → skip
  conn
    .update(schema.leads)
    .set({ stageId, pipelineStage: ROLE_TO_LEGACY_KEY[role] as typeof schema.leads.$inferInsert.pipelineStage, updatedAt: new Date() })
    .where(eq(schema.leads.id, leadId))
    .run();
  conn.insert(schema.activityLog).values({
    type: "pipeline.stage",
    message: `Lead ${role === "lapsed" ? "lapsed" : "re-activated"} (auto)`,
    meta: JSON.stringify({ leadId }),
  }).run();
}
```

In `recomputeLapsed`, replace the two selects that filter by `pipelineStage` with `stage_id`-by-role filters:

```ts
  const wonId = resolveStageIdByRoleOnConn(conn, "won");
  const repeatId = resolveStageIdByRoleOnConn(conn, "repeat");
  const lapsedId = resolveStageIdByRoleOnConn(conn, "lapsed");
  const customerStageIds = [wonId, repeatId].filter((x): x is number => x != null);

  const customers = customerStageIds.length
    ? conn.select({ id: schema.leads.id, clientId: schema.leads.clientId }).from(schema.leads).where(inArray(schema.leads.stageId, customerStageIds)).all()
    : [];
  for (const l of customers) {
    if (l.clientId == null) continue;
    if (!isActive(conn, l.clientId, cutoffIso, cutoffMs)) { writeLapseStage(conn, l.id, "lapsed"); lapsed++; }
  }

  const lapsedLeads = lapsedId != null
    ? conn.select({ id: schema.leads.id, clientId: schema.leads.clientId }).from(schema.leads).where(eq(schema.leads.stageId, lapsedId)).all()
    : [];
  for (const l of lapsedLeads) {
    if (l.clientId == null) continue;
    if (isActive(conn, l.clientId, cutoffIso, cutoffMs)) { writeLapseStage(conn, l.id, paidCount(conn, l.clientId) >= 2 ? "repeat" : "won"); reactivated++; }
  }
```

(The `role` param types on `writeLapseStage` changed from stage-names to roles; keep `inArray` imported.)

- [ ] **Step 3: Gate — typecheck + full test suite**

Run: `cd app && npm run typecheck && npm test`
Expected: typecheck clean; **all tests pass** — critically `stages.test.ts` (still tests the untouched `nextAutoStage`), and `tools.sales.test.ts` + `runAgentTurn.test.ts` (they assert `pipelineStage` text, which the dual-write keeps correct).

- [ ] **Step 4: Commit**

```bash
cd app && git add src/lib/pipeline/stage.ts src/lib/pipeline/lapse.ts
git commit -m "feat(pipeline): engine + lapse job move by role→stage_id (dual-write pipeline_stage bridge)"
```

---

### Task 6: `leads.ts` — board data carries stage rows; new leads get the entry stage

**Files:**
- Modify: `app/src/lib/leads.ts` (`upsertLead` sets `stageId`; `listLeadsForBoard` joins `pipeline_stages`; extend `LeadWithSla`)

**Interfaces:**
- Consumes: `resolveEntryStageId` from `@/lib/pipeline/stageRepo`; `type StageRole` from `@/lib/pipeline/roles`.
- Produces: `LeadWithSla = Lead & { firstOutboundAt: number | null; stage: { id: number; name: string; colour: string; position: number; role: StageRole | null } | null }`.

- [ ] **Step 1: Set the entry stage on insert in `upsertLead`**

In `upsertLead` (the `.insert(leads).values({...})` call), add `stageId: resolveEntryStageId()` to the values. Add the import at top: `import { resolveEntryStageId } from "./pipeline/stageRepo";`. (Existing default `pipeline_stage='new_lead'` stays as the frozen dual-value.)

```ts
  const inserted = db
    .insert(leads)
    .values({
      source,
      sourceLeadId,
      campaign: nz(input.campaign),
      firstName: nz(firstName),
      lastName: nz(lastName),
      email: nz(input.email),
      phone: nz(input.phone),
      therapyInterest: nz(input.therapyInterest),
      notes: nz(input.notes),
      rawPayload: input.rawPayload ? JSON.stringify(input.rawPayload) : null,
      stageId: resolveEntryStageId() ?? undefined,
    })
    .returning()
    .all();
```

- [ ] **Step 2: Join stages in `listLeadsForBoard`**

Replace `listLeadsForBoard`'s body + `LeadWithSla` type:

```ts
import type { StageRole } from "./pipeline/roles";

export type LeadWithSla = Lead & {
  firstOutboundAt: number | null;
  stage: { id: number; name: string; colour: string; position: number; role: StageRole | null } | null;
};

export function listLeadsForBoard(): LeadWithSla[] {
  const firstOutbound = db
    .select({ leadId: leadMessages.leadId, firstOutboundAt: sql<number>`min(${leadMessages.sentAt})`.as("first_outbound_at") })
    .from(leadMessages)
    .where(and(eq(leadMessages.direction, "outbound"), isNotNull(leadMessages.sentAt)))
    .groupBy(leadMessages.leadId)
    .as("first_outbound");

  const rows = db
    .select({
      lead: leads,
      firstOutboundAt: firstOutbound.firstOutboundAt,
      sId: pipelineStages.id, sName: pipelineStages.name, sColour: pipelineStages.colour, sPos: pipelineStages.position, sRole: pipelineStages.role,
    })
    .from(leads)
    .leftJoin(firstOutbound, eq(firstOutbound.leadId, leads.id))
    .leftJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))
    .orderBy(desc(leads.createdAt))
    .all();

  return rows.map((r) => ({
    ...r.lead,
    firstOutboundAt: r.firstOutboundAt ?? null,
    stage: r.sId != null ? { id: r.sId, name: r.sName!, colour: r.sColour!, position: r.sPos!, role: (r.sRole as StageRole | null) } : null,
  }));
}
```

Add `pipelineStages` to the schema import at the top of `leads.ts` (`import { leadMessages, leads, pipelineStages, type Lead, type LeadMessage } from "./db/schema";`).

- [ ] **Step 3: Gate**

Run: `cd app && npm run typecheck && npm test`
Expected: PASS (76/76 — LeadWithSla is a superset; the board still reads `pipelineStage` for now).

- [ ] **Step 4: Commit**

```bash
cd app && git add src/lib/leads.ts
git commit -m "feat(leads): board query joins pipeline_stages; new leads get the entry stage"
```

---

### Task 7: `boardMetrics` → role sets; `metrics.ts` passes role

**Files:**
- Modify: `app/src/lib/pipeline/boardMetrics.ts` (swap `PipelineStage` sets → role sets; `LeadMetricInput.role`)
- Modify: `app/src/lib/pipeline/boardMetrics.test.ts` (fixtures use `role`)
- Modify: `app/src/lib/pipeline/metrics.ts` (`boardMetricsFromLeads` passes `lead.stage?.role`)

**Interfaces:**
- Consumes: `WON_ROLES`, `INACTIVE_ROLES`, `STALE_SUPPRESSED_ROLES`, `type StageRole` from `./roles`.
- Produces: `LeadMetricInput = { createdAt; updatedAt; role: StageRole | null; firstOutboundAt }`; `isStale(msInStage, role: StageRole | null)`.

- [ ] **Step 1: Update the test fixtures to `role`**

In `boardMetrics.test.ts`, change the `isStale` checks + the `computeBoardMetrics` fixtures from stage names to roles: `"new_lead"→"new"`, `"hot_lead"→"engaged"`, `"sale"→"won"`, `"repeat_customer"→"repeat"`, `"lost"→"lost"`, and the `LeadMetricInput` field `pipelineStage:` → `role:`. (e.g. `isStale(30 * 86_400_000, "sale")` → `isStale(30 * 86_400_000, "won")`; fixture `pipelineStage: "sale"` → `role: "won"`.) Keep every expected numeric value identical — the role sets are the same membership as the old stage sets.

- [ ] **Step 2: Run — verify it fails**

Run: `cd app && npm test -- src/lib/pipeline/boardMetrics.test.ts`
Expected: FAIL — `role` not a field / `isStale` signature mismatch.

- [ ] **Step 3: Refactor `boardMetrics.ts`**

Replace the `PipelineStage` import + the three sets + the two consumers:

```ts
import { WON_ROLES, INACTIVE_ROLES, STALE_SUPPRESSED_ROLES, type StageRole } from "./roles";
```

Delete the local `STALE_SUPPRESSED`, `WON_STAGES`, `INACTIVE_STAGES` consts and the `import type { PipelineStage }`. Update:

```ts
export function isStale(msInStage: number, role: StageRole | null): boolean {
  if (role != null && STALE_SUPPRESSED_ROLES.has(role)) return false;
  return msInStage > STALE_MS;
}

export interface LeadMetricInput {
  createdAt: number;
  updatedAt: number;
  role: StageRole | null;
  firstOutboundAt: number | null;
}
```

In `computeBoardMetrics`, replace the two set lookups:
- `!INACTIVE_STAGES.has(l.pipelineStage)` → `(l.role == null || !INACTIVE_ROLES.has(l.role))`
- `if (WON_STAGES.has(l.pipelineStage)) won90++` → `if (l.role != null && WON_ROLES.has(l.role)) won90++`

- [ ] **Step 4: Update `metrics.ts`**

In `boardMetricsFromLeads`, map `role` from the joined stage:

```ts
  const input: LeadMetricInput[] = leads.map((l) => ({
    createdAt: l.createdAt.getTime(),
    updatedAt: l.updatedAt.getTime(),
    role: l.stage?.role ?? null,
    firstOutboundAt: l.firstOutboundAt,
  }));
```

Drop the now-unused `PipelineStage` import from `metrics.ts`.

- [ ] **Step 5: Gate**

Run: `cd app && npm test -- src/lib/pipeline/boardMetrics.test.ts && npm run typecheck`
Expected: PASS (same numeric expectations, role-keyed).

- [ ] **Step 6: Commit**

```bash
cd app && git add src/lib/pipeline/boardMetrics.ts src/lib/pipeline/boardMetrics.test.ts src/lib/pipeline/metrics.ts
git commit -m "feat(pipeline): board metrics key off stage role instead of hardcoded stage names"
```

---

### Task 8: Board + LeadDetail/LeadList render from DB stages; drag/picker set by id

**Files:**
- Modify: `app/src/components/pipeline/StageChip.tsx` (take a `{name,colour}` record)
- Modify: `app/src/components/pipeline/LeadCard.tsx`, `StageColumn.tsx`, `PipelineBoard.tsx`
- Modify: `app/src/components/leads/LeadDetail.tsx`, `LeadList.tsx`
- Modify: `app/src/app/leads/actions.ts` (`setLeadStageAction` → `(leadId, stageId)`), `app/src/app/leads/[id]/page.tsx` (pass `stages`), `app/src/app/leads/page.tsx` (pass `stages` to the board)

**Interfaces:**
- Consumes: `listStages()` from `@/lib/pipeline/stageRepo`; `LeadWithSla.stage` (Task 6); `setStageToId` from `@/lib/pipeline/stage`; `StageRecord` from `@/lib/pipeline/roles`.
- Produces: `StageChip({ stage }: { stage: { name: string; colour: string } | null })`; `PipelineBoard`/`LeadDetail`/`LeadList` take a `stages: StageRecord[]` prop; `setLeadStageAction(leadId: number, stageId: number)`.

- [ ] **Step 1: `StageChip` takes a record (name+colour), not a name-union**

Rewrite `StageChip.tsx`:

```tsx
/** Colour-coded chip for a lead's current stage. Takes the resolved record (DB stage). */
export function StageChip({ stage }: { stage: { name: string; colour: string } | null }) {
  const colour = stage?.colour ?? "#8b949e";
  const label = stage?.name ?? "—";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "3px 9px", borderRadius: "var(--radius)", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", color: colour, background: `${colour}1f`, border: `1px solid ${colour}55` }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: colour }} />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: `setLeadStageAction` → id-based**

In `app/src/app/leads/actions.ts`: change the import to `setStageToId` and the action to `(leadId: number, stageId: number)`:

```ts
import { setStageToId } from "@/lib/pipeline/stage";
export async function setLeadStageAction(leadId: number, stageId: number) {
  await requireUser();
  setStageToId(leadId, stageId);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/leads");
}
```

- [ ] **Step 3: Board components use the DB `stages` + `lead.stage`**

- `LeadCard.tsx`: replace `STAGES`/`PipelineStage` usage — it uses `isStale(msInStage, stage)` and (from Task 4/7) staleness is by role: pass `lead.stage?.role ?? null`. Replace `const stage = lead.pipelineStage as PipelineStage` with `const role = lead.stage?.role ?? null;` and `isStale(msInStage, role)`. The staleness tooltip uses `lead.stage?.name ?? ""`. Remove `STAGES`/`PipelineStage` imports (keep `isStale` from boardMetrics).
- `StageColumn.tsx`: it currently imports `STAGES`/`PipelineStage` to render the header dot/label from `STAGES[stage]`. Change its prop from `stage: PipelineStage` to `stage: { name: string; colour: string }` (the header renders `stage.colour`/`stage.name`); the droppable id stays the stage **id** (string) now — change `useDroppable({ id: stage })` to `useDroppable({ id: String(stageId) })` with a new `stageId: number` prop. Rework `PipelineBoard` to pass `stageId` + the stage record.
- `PipelineBoard.tsx`: take a new prop `stages: StageRecord[]`. Build columns from `stages` (funnel = stages whose role ∉ {lapsed,lost} ordered by position; rails = the lapsed/lost-role stages). Bucket leads by `lead.stage?.id`. Won-window applies to columns whose `role ∈ {won,repeat}`. Drag `onDragEnd`: `over.id` is the target stage **id** (string) → `setLeadStageAction(leadId, Number(over.id))`; optimistic update sets `lead.stage` to the target stage record; Undo/ revert as today. `LeadCard` gets `lead` (with `.stage`). The `STAGES`/`STAGE_ORDER`/`PipelineStage` imports are removed.
- `LeadDetail.tsx`: replace the picker (`STAGE_ORDER.map`) with `stages.map` (new `stages: StageRecord[]` prop from the page); `setStage(stageId)` → `setLeadStageAction(lead.id, stageId)`; the header `<StageChip stage={lead.stage} />`; toast `Moved to ${stage.name}`; active row = `lead.stageId === s.id`; row colour = `s.colour`, label = `s.name`. Remove `STAGES`/`STAGE_ORDER`/`PipelineStage`.
- `LeadList.tsx`: the filter tabs build from `stages` (a new prop) instead of `STAGE_ORDER`; `<StageChip stage={l.stage} />`; filter compares `l.stageId === filter`. Remove `STAGES`/`STAGE_ORDER`/`PipelineStage`.

(Each file's exact JSX mirrors its current structure with the record swaps above; keep all styling/behaviour otherwise identical.)

- [ ] **Step 4: Pages pass `stages`**

- `app/src/app/leads/page.tsx`: `const stages = listStages();` and `<PipelineBoard leads={leads} stages={stages} />`; `<LeadList>` inside PipelineBoard receives `stages` too.
- `app/src/app/leads/[id]/page.tsx`: load `listStages()` and pass `stages` to `<LeadDetail>`.

- [ ] **Step 5: Gate (incl. build — this is the big UI change)**

Run: `cd app && npm run typecheck && npm test && npx next build`
Expected: all green. `PipelineStage`/`STAGES`/`STAGE_ORDER` no longer referenced by board/detail/list files (verify: `grep -rn "STAGE_ORDER\|STAGES\[" src/components/pipeline src/components/leads` → no hits).

- [ ] **Step 6: Commit**

```bash
cd app && git add src/components/pipeline src/components/leads src/app/leads
git commit -m "feat(pipeline): board, lead detail + list render from DB stages; drag/picker set by stage id"
```

---

### Task 9: Sales agent tools speak the tenant's stages

**Files:**
- Modify: `app/src/lib/agents/tools.sales.ts`
- Modify: `app/src/lib/agents/tools.sales.test.ts`, `app/src/lib/agents/runAgentTurn.test.ts`

**Interfaces:**
- Consumes: `listStages`, `resolveStageIdByRole`, `setStageToId` from `@/lib/pipeline/{stageRepo,stage}`.

- [ ] **Step 1: Build the tool schemas + set-stage from DB stages**

In `tools.sales.ts`: replace `STAGE_ORDER`/`STAGES`/`currentStage`/`setStageManual`/`PipelineStage` with DB stages resolved at tool-run time:
- The `list_leads` + `set_lead_stage` `input_schema` `enum` becomes the tenant's stage **names**: `const stages = listStages(); const stageNames = stages.map((s) => s.name);` → `enum: stageNames`.
- `list_leads` stage filter: resolve the model's stage name → `stages.find((s) => s.name === stageArg)?.id` → filter `eq(leads.stageId, id)`. Echo `stage: <the lead's stage name>` (join or look up) in results.
- `set_lead_stage`: validate the name ∈ stageNames; `const target = stages.find((s) => s.name === stage)!;` → `setStageToId(leadId, target.id)`; confirmation text `moved … to "${target.name}"`. Look up the "before" stage via the lead's current `stageId`.
- Any `l.pipelineStage` echo → resolve to the stage name via the loaded `stages` (or keep echoing the frozen text — acceptable for the agent's read-only reporting; prefer the DB name for correctness).

- [ ] **Step 2: Update the two agent tests**

- `tools.sales.test.ts`: the seeded lead + assertions — the test seeds a tenant DB; ensure it seeds `pipeline_stages` (run the migration in the harness) so `listStages()` works. Change `stage: "new_lead"` assertions to the stage **name** `"New lead"`; `setLeadStageTool(ctx, { leadId, stage: "hot_lead" })` → `stage: "Hot lead"`; re-read assertion checks `stageId` resolves to the "Hot lead" stage (or the dual-written `pipelineStage: "hot_lead"`, still valid).
- `runAgentTurn.test.ts`: same — seed pipeline_stages in the harness; the denied-write assertion re-reads `stageId`/`pipelineStage`.

(Confirm the test harness's DB setup calls `ensureTenantTables` + `runMigrations` so `pipeline_stages` exists; if it only calls `ensureTenantTables`, add the seed insert or `runMigrations(db, TENANT_MIGRATIONS)`.)

- [ ] **Step 3: Gate**

Run: `cd app && npm run typecheck && npm test`
Expected: all pass, including the two updated agent tests.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/lib/agents/tools.sales.ts src/lib/agents/tools.sales.test.ts src/lib/agents/runAgentTurn.test.ts
git commit -m "feat(agents): sales tools use the tenant's editable stages (name enum + set by id)"
```

---

### Task 10: `/settings/pipeline` — the stage editor

**Files:**
- Create: `app/src/app/settings/pipeline/page.tsx`, `app/src/app/settings/pipeline/actions.ts`, `app/src/components/settings/PipelineStagesManager.tsx`
- Modify: `app/src/app/settings/page.tsx` (add the nav entry)

**Interfaces:**
- Consumes: `listStages`, `createStage`, `updateStage`, `reorderStages`, `deleteStageWithMove` from `@/lib/pipeline/stageRepo`; `canDeleteStage`, `roleConflict`, `ALL_ROLES`, `ROLE_HINTS`, `type StageRole`, `type StageRecord` from `@/lib/pipeline/roles`.

- [ ] **Step 1: Actions (admin-only, tenant-scoped, invariant-guarded)**

Create `app/src/app/settings/pipeline/actions.ts` (mirror `api-keys/actions.ts`): `requireAdmin()`; each action re-reads `listStages()` and enforces invariants before mutating:
- `addStageAction({name, colour, role})` — if `role`, reject when `roleConflict(stages, role, null)`; else `createStage`.
- `updateStageAction(id, {name?, colour?, role?})` — if setting a role, reject on `roleConflict(stages, role, id)`; else `updateStage`.
- `reorderStagesAction(orderedIds: number[])` — `reorderStages`.
- `deleteStageAction(id, moveToId)` — reject when `!canDeleteStage(stages, id).ok`; else `deleteStageWithMove(id, moveToId)`.
Each returns `{ ok: true } | { ok: false; error: string }` and `revalidatePath("/settings/pipeline")` + `revalidatePath("/leads")`.

- [ ] **Step 2: Manager component**

Create `PipelineStagesManager.tsx` (`"use client"`): a `@dnd-kit` sortable list of stage rows (drag handle → `reorderStagesAction(orderedIds)` on drop), each row = colour swatch (a small fixed palette derived from `DEFAULT_STAGES` colours + a few extras), inline name input (blur → `updateStageAction`), a **role** `<select>` (options `ALL_ROLES` + "— none —", each showing `ROLE_HINTS[role]`; a role already used elsewhere is shown disabled with its stage name), a delete button (opens a "move N leads to [stage select]" confirm → `deleteStageAction`), and an "Add stage" row (`addStageAction`). Toasts via `sonner`. Explicit saves.

- [ ] **Step 3: Page + nav**

Create `page.tsx` (mirror `api-keys/page.tsx`): `requireAdminPage()`, back-link, `PageHeader(eyebrow="Configure", title="Pipeline", subtitle="Add, rename, reorder or recolour the stages leads move through. Tag a stage with a role to wire up the automations.")`, `<PipelineStagesManager stages={listStages()} />`. In `settings/page.tsx`, add to `buildSections` (after "API keys"): `{ href: "/settings/pipeline", icon: <import a suitable lucide icon, e.g. `GitBranch`>, title: "Pipeline", desc: "Add, rename, reorder and recolour the lead pipeline stages; tag stages with roles to drive automation." }` and import the icon.

- [ ] **Step 4: Gate (incl. build)**

Run: `cd app && npm run typecheck && npm test && npx next build`
Expected: green; `/settings/pipeline` in the route list.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/app/settings/pipeline src/components/settings/PipelineStagesManager.tsx src/app/settings/page.tsx
git commit -m "feat(pipeline): /settings/pipeline stage editor (reorder/rename/recolour/role/add/delete-with-move)"
```

---

### Task 11: Contract — remove the dead legacy exports

**Files:**
- Modify: `app/src/lib/pipeline/stages.ts` (remove `STAGES`, `STAGE_ORDER`, `PipelineStage`, `nextAutoStage`; keep nothing else referenced — the file may be deleted if empty), `app/src/lib/pipeline/stages.test.ts` (delete — it tested `nextAutoStage`), `app/src/lib/pipeline/stage.ts` (drop the legacy re-exports + the `setStageManual`/`currentStage` shims if now unreferenced)

- [ ] **Step 1: Confirm nothing references the legacy symbols**

Run:
```bash
cd app && grep -rn "STAGE_ORDER\|\bSTAGES\b\|PipelineStage\|nextAutoStage\|setStageManual\|currentStage\b" src --include="*.ts" --include="*.tsx" | grep -v "pipeline/stages.ts\|pipeline/stage.ts\|pipeline/stages.test.ts"
```
Expected: **no hits** (all readers migrated). If any remain, migrate them before deleting.

- [ ] **Step 2: Delete the dead code**

Remove `STAGES`, `STAGE_ORDER`, `PipelineStage`, `nextAutoStage` from `stages.ts` (delete the file if nothing remains and update `stage.ts`'s re-export line). Delete `stages.test.ts`. In `stage.ts` remove the `export { STAGES, STAGE_ORDER, nextAutoStage } from "./stages"` line, the `export type { PipelineStage }` line, and the `setStageManual`/`currentStage` legacy shims **iff** Step 1 showed them unreferenced. Keep `writeStageId`, `setStageToId`, `advanceStage`, `currentStageRecord`, the hooks.

- [ ] **Step 3: Gate**

Run: `cd app && npm run typecheck && npm test && npx next build`
Expected: green; the frozen `leads.pipeline_stage` column + its drizzle enum remain (untouched) as the rollback snapshot.

- [ ] **Step 4: Commit**

```bash
cd app && git add -A src/lib/pipeline
git commit -m "refactor(pipeline): remove dead hardcoded stage vocabulary (STAGES/STAGE_ORDER/PipelineStage/nextAutoStage)"
```

---

### Task 12: Board segmentation — campaign / therapy / source filter + segment metrics

**Files:**
- Modify: `app/src/components/pipeline/PipelineBoard.tsx` (filter bar + segment-scoped metrics)
- Modify: `app/src/app/leads/page.tsx` (metrics move client-side onto the filtered set — pass raw leads; `PipelineBoard` computes metrics) OR keep server metrics for the unfiltered default and recompute client-side on filter (see step 1)

**Interfaces:**
- Consumes: `computeBoardMetrics` (pure, `@/lib/pipeline/boardMetrics`) — already client-safe; `PipelineMetrics` renders a `BoardMetrics`.

- [ ] **Step 1: Move metric computation into the board so it tracks the filtered segment**

`computeBoardMetrics` is pure and client-safe. In `PipelineBoard` (client), compute metrics from the currently-filtered leads and render `<PipelineMetrics metrics={...} />` there (moving it out of the page, or keeping the page's initial render and overriding on filter). Map each `LeadWithSla` → `LeadMetricInput` inline (`createdAt.getTime()`, `updatedAt.getTime()`, `role: lead.stage?.role ?? null`, `firstOutboundAt`) and `computeBoardMetrics(filtered.map(...), now)`.

- [ ] **Step 2: Filter bar**

Add three dropdowns above the board — **Campaign**, **Therapy**, **Source** — each populated from the distinct non-null values across `leads` (`[...new Set(leads.map((l) => l.campaign))].filter(Boolean)` etc.). Selecting a value narrows `filtered` (AND-combined with the existing search). Persist the three selections per user in `localStorage` (`leads.filter.campaign|therapy|source`), same pattern as the board/list toggle. Reset ("All") option per dropdown.

- [ ] **Step 3: Gate (incl. build)**

Run: `cd app && npm run typecheck && npm test && npx next build`
Expected: green.

- [ ] **Step 4: Manual QA**

`npm run dev` → `/leads`: filter by a campaign → columns + metric tiles recompute for that segment; combine with search; reload persists the filter. Add a stage in `/settings/pipeline`, reorder it, recolour it → board reflects it. Delete a stage with leads → move prompt → leads reassign. Reply to a lead → it advances to the `engaged`-role stage even if renamed.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/components/pipeline/PipelineBoard.tsx src/app/leads/page.tsx
git commit -m "feat(pipeline): board segmentation (campaign/therapy/source filter + segment-scoped metrics)"
```

---

## Self-Review

**1. Spec coverage:**
- Editable stages (add/rename/reorder/recolour/delete) → Tasks 1,4,10. ✓
- Role-driven automation (events target a role) → Tasks 2,5 (+ shouldAdvance out-of-band). ✓
- Zero visible change on deploy (seed + backfill) → Tasks 1,3. ✓
- Board renders from DB (funnel by position, rails = lapsed/lost roles, won-window on won/repeat) → Task 8. ✓
- Segmentation (campaign/therapy/source + segment metrics, persisted) → Task 12. ✓
- Metrics by role → Task 7. ✓
- Lapse job connection-based → Task 5. ✓
- Downstream readers switch (board, LeadDetail, LeadList, Sales agent) → Tasks 8,9. ✓
- Invariants (≥1 stage, role unique, entry stage) → Task 4 (pure) + Task 10 (enforced in actions). ✓
- Delete-with-move atomic → Task 4 (`deleteStageWithMove` transaction) + Task 10. ✓
- Non-goals respected (no multi-pipeline table; no real tags — Phase 2; no per-stage automations; roles are fixed). ✓
- Frozen `pipeline_stage` + dual-write bridge + rollback → Tasks 5,11. ✓

**2. Placeholder scan:** No TBD/TODO. Task 8's per-file component edits are described as record-swaps over the current structure with the exact prop/type changes given; the code steps show the concrete new signatures (StageChip, setLeadStageAction) and the exact expression swaps (isStale role, over.id → Number). The inbox-AI / triage files are correctly NOT touched (separate `TriageCategory` vocab).

**3. Type consistency:** `StageRole` (Task 2) is used identically in stageRepo/stage/boardMetrics/leads/agents; `StageRecord` (Task 4) threaded into board/detail/list (Task 8) + settings (Task 10); `setStageToId(leadId, stageId)` (Task 5) consumed by `setLeadStageAction` (Task 8) + `tools.sales` (Task 9); `LeadWithSla.stage` (Task 6) consumed by board (Task 8) + metrics (Task 7) + segmentation (Task 12); `resolveEntryStageId` (Task 4) consumed by `upsertLead` (Task 6); `advanceStage(leadId, role)` (Task 5) called only by the hooks in the same file. The dual-write keeps `pipeline_stage` valid for the agent tests until Task 9 migrates them and Task 11 removes the dead vocab.
