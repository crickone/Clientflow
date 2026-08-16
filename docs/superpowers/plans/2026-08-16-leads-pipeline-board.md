# Leads Pipeline Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat `/leads` card grid with a drag-and-drop kanban pipeline board (7 funnel columns + Lapsed/Lost rails), speed-to-lead timers, and a funnel metrics strip — built on the existing `lib/pipeline` stage engine with zero schema changes.

**Architecture:** A server component (`/leads/page.tsx`) loads leads (with a `firstOutboundAt` join) once and computes metrics, then hands them to a client `PipelineBoard`. Dragging a card calls the existing `setLeadStageAction` (manual stage override) optimistically with a 5s Undo; the auto-advance engine keeps moving cards on real events, made visible by a 30s/on-focus `router.refresh()` plus `motion` layout animation. All derivation logic (SLA tone, staleness, metrics) lives in a pure, unit-tested module.

**Tech Stack:** Next.js 14 App Router, React server + client components, drizzle-orm 0.45 + better-sqlite3 (synchronous), `motion` v12 (`motion/react`), `@dnd-kit/core` (new), `sonner` toasts, inline token-driven styles.

## Global Constraints

- **No schema changes.** `leads.pipelineStage` and the 9-stage enum already exist; do not alter them.
- **No new stage vocabulary/engine changes.** Reuse `STAGES`, `STAGE_ORDER`, `PipelineStage` from `src/lib/pipeline/stages.ts` and `setLeadStageAction` from `src/app/leads/actions.ts` verbatim.
- **Sends stay on the detail page.** The board may deep-link to `/leads/[id]` to *start* an AI draft or reply; it never sends a message directly.
- **Test runner is the plain-tsx assert runner** (`node scripts/test.mjs`): every `*.test.ts` under `src/` is a standalone script using `node:assert/strict`; failure = non-zero exit (a thrown assert). **Pure tests only — no DB access in tests** (the tenant `db` proxy needs a request context).
- **SLA colours (inline hex, no CSS tokens exist):** amber `#d29922`, red `#dc2626`, neutral `var(--text-tertiary)`.
- **Won-stage windowing:** `sale` and `repeat_customer` columns show only cards updated in the last 30 days; header shows `visible / all-time`.
- **Styling is token-driven** (`--surface-1`, `--hairline`, `--text-primary/secondary/tertiary`, stage `colourHex`) so it inherits each tenant's theme.
- **Only new dependency:** `@dnd-kit/core`.
- **Quality gate before done:** `npm run typecheck && npm test && npx next build` all green, run from `app/`. Deploy (`railway up` from `app/`) is a separate manual step the user runs — not part of this plan.

---

### Task 1: Pure SLA tone + staleness helpers (TDD)

**Files:**
- Create: `app/src/lib/pipeline/boardMetrics.ts`
- Test: `app/src/lib/pipeline/boardMetrics.test.ts`

**Interfaces:**
- Consumes: `PipelineStage` from `./stages`.
- Produces:
  - `type SlaTone = "neutral" | "amber" | "red"`
  - `slaTone(waitingMs: number): SlaTone`
  - `isStale(msInStage: number, stage: PipelineStage): boolean`
  - constants `SLA_AMBER_MS = 900000`, `SLA_RED_MS = 3600000`, `STALE_MS = 604800000`

- [ ] **Step 1: Write the failing test**

Create `app/src/lib/pipeline/boardMetrics.test.ts`:

```ts
/**
 * Pure unit tests for board derivations. No I/O, no DB.
 * Run: npm test -- src/lib/pipeline/boardMetrics.test.ts
 */
import assert from "node:assert/strict";

import { slaTone, isStale, SLA_AMBER_MS, SLA_RED_MS, STALE_MS } from "./boardMetrics";

let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  assert.deepEqual(actual, expected, `${name}: expected ${expected}, got ${actual}`);
  passed++;
  console.log("  ✓", name);
}

// slaTone: <15m neutral, 15m–1h amber (inclusive both ends), >1h red
check("0ms → neutral", slaTone(0), "neutral");
check("14m → neutral", slaTone(14 * 60_000), "neutral");
check("15m (boundary) → amber", slaTone(SLA_AMBER_MS), "amber");
check("59m → amber", slaTone(59 * 60_000), "amber");
check("60m (boundary) → amber", slaTone(SLA_RED_MS), "amber");
check("61m → red", slaTone(61 * 60_000), "red");

// isStale: >7d in stage, suppressed for sale/repeat_customer/lost
check("8d in hot_lead → stale", isStale(8 * 86_400_000, "hot_lead"), true);
check("6d in hot_lead → not stale", isStale(6 * 86_400_000, "hot_lead"), false);
check("exactly 7d → not stale (strictly greater)", isStale(STALE_MS, "hot_lead"), false);
check("30d in sale → suppressed", isStale(30 * 86_400_000, "sale"), false);
check("30d in repeat_customer → suppressed", isStale(30 * 86_400_000, "repeat_customer"), false);
check("30d in lost → suppressed", isStale(30 * 86_400_000, "lost"), false);
check("8d in new_lead → stale", isStale(8 * 86_400_000, "new_lead"), true);

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/lib/pipeline/boardMetrics.test.ts`
Expected: FAIL — `Cannot find module './boardMetrics'`.

- [ ] **Step 3: Write minimal implementation**

Create `app/src/lib/pipeline/boardMetrics.ts`:

```ts
/**
 * Pure derivations for the leads pipeline board — NO `import "server-only"`, no
 * DB, no env (mirrors humanName.ts / webhook.ts), so it loads under the plain-tsx
 * test runner. The server wrapper (metrics.ts) injects `now` + DB rows; this file
 * is the fully-tested logic.
 */
import type { PipelineStage } from "./stages";

export const SLA_AMBER_MS = 15 * 60 * 1000; // 900000
export const SLA_RED_MS = 60 * 60 * 1000; // 3600000
export const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 604800000

export type SlaTone = "neutral" | "amber" | "red";

/** Colour tone for how long an uncontacted lead has been waiting for a first reply. */
export function slaTone(waitingMs: number): SlaTone {
  if (waitingMs > SLA_RED_MS) return "red";
  if (waitingMs >= SLA_AMBER_MS) return "amber";
  return "neutral";
}

const STALE_SUPPRESSED: ReadonlySet<PipelineStage> = new Set<PipelineStage>([
  "sale",
  "repeat_customer",
  "lost",
]);

/** True when a card has sat in one stage > 7 days — except won/lost stages, where staleness is meaningless. */
export function isStale(msInStage: number, stage: PipelineStage): boolean {
  if (STALE_SUPPRESSED.has(stage)) return false;
  return msInStage > STALE_MS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- src/lib/pipeline/boardMetrics.test.ts`
Expected: PASS — `13 passed`.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/pipeline/boardMetrics.ts src/lib/pipeline/boardMetrics.test.ts
git commit -m "feat(pipeline): pure SLA-tone + staleness helpers for the leads board"
```

---

### Task 2: Pure board-metrics compute (TDD)

**Files:**
- Modify: `app/src/lib/pipeline/boardMetrics.ts`
- Modify: `app/src/lib/pipeline/boardMetrics.test.ts`

**Interfaces:**
- Consumes: `PipelineStage`, `SLA_RED_MS` (from same file).
- Produces:
  - `interface LeadMetricInput { createdAt: number; updatedAt: number; pipelineStage: PipelineStage; firstOutboundAt: number | null }`
  - `interface BoardMetrics { newThisWeek: number; newThisWeekDelta: number; avgSpeedToLeadMs: number | null; uncontactedNow: number; uncontactedBreaching: boolean; conversionPct: number | null }`
  - `startOfWeekMs(now: number): number` (Monday-based, exported for testing)
  - `computeBoardMetrics(leads: LeadMetricInput[], now: number): BoardMetrics`

- [ ] **Step 1: Write the failing test**

Append to `app/src/lib/pipeline/boardMetrics.test.ts` (before the final `console.log`):

```ts
import { computeBoardMetrics, startOfWeekMs, type LeadMetricInput } from "./boardMetrics";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = 1_000_000_000_000; // fixed epoch ms
const weekStart = startOfWeekMs(NOW);

const fixture: LeadMetricInput[] = [
  // L1: this week, contacted 10m after create (speed sample), new_lead
  { createdAt: weekStart + HOUR, updatedAt: weekStart + HOUR, pipelineStage: "new_lead", firstOutboundAt: weekStart + HOUR + 10 * 60_000 },
  // L2: previous week, uncontacted, hot_lead (age > 1h → breaching)
  { createdAt: weekStart - HOUR, updatedAt: weekStart - HOUR, pipelineStage: "hot_lead", firstOutboundAt: null },
  // L3: 100d ago (outside 90d), sale, uncontacted but inactive stage → not counted
  { createdAt: NOW - 100 * DAY, updatedAt: NOW - 100 * DAY, pipelineStage: "sale", firstOutboundAt: null },
  // L4: 10d ago, sale (won, within 90d), contacted 1h after create (speed sample)
  { createdAt: NOW - 10 * DAY, updatedAt: NOW - 10 * DAY, pipelineStage: "sale", firstOutboundAt: NOW - 10 * DAY + HOUR },
];

const m = computeBoardMetrics(fixture, NOW);
check("newThisWeek counts only this-week leads", m.newThisWeek, 1);
check("delta = thisWeek - prevWeek", m.newThisWeekDelta, 0);
check("avg speed over 30d samples (10m + 1h)/2", m.avgSpeedToLeadMs, (10 * 60_000 + HOUR) / 2);
check("uncontactedNow excludes inactive stages", m.uncontactedNow, 1);
check("uncontactedBreaching true when any >1h", m.uncontactedBreaching, true);
check("conversion = won/created over 90d (1/3)", m.conversionPct, 33);

const empty = computeBoardMetrics([], NOW);
check("empty → avg null", empty.avgSpeedToLeadMs, null);
check("empty → conversion null", empty.conversionPct, null);
check("empty → not breaching", empty.uncontactedBreaching, false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npm test -- src/lib/pipeline/boardMetrics.test.ts`
Expected: FAIL — `computeBoardMetrics` / `startOfWeekMs` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `app/src/lib/pipeline/boardMetrics.ts`:

```ts
export interface LeadMetricInput {
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  pipelineStage: PipelineStage;
  firstOutboundAt: number | null; // epoch ms of first *sent* outbound, or null
}

export interface BoardMetrics {
  newThisWeek: number;
  newThisWeekDelta: number; // vs previous week (signed)
  avgSpeedToLeadMs: number | null; // mean first-response time over last 30d
  uncontactedNow: number;
  uncontactedBreaching: boolean; // any uncontacted active lead > 1h old
  conversionPct: number | null; // won / created over last 90d, 0..100
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WON_STAGES: ReadonlySet<PipelineStage> = new Set<PipelineStage>(["sale", "repeat_customer"]);
const INACTIVE_STAGES: ReadonlySet<PipelineStage> = new Set<PipelineStage>([
  "sale",
  "repeat_customer",
  "lost",
]);

/** Start of the Monday-based week containing `now`, as epoch ms. */
export function startOfWeekMs(now: number): number {
  const d = new Date(now);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday-based (mirrors utils.startOfWeek)
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function computeBoardMetrics(leads: LeadMetricInput[], now: number): BoardMetrics {
  const weekStart = startOfWeekMs(now);
  const prevWeekStart = weekStart - 7 * DAY_MS;
  const cutoff30 = now - 30 * DAY_MS;
  const cutoff90 = now - 90 * DAY_MS;

  let newThisWeek = 0;
  let newPrevWeek = 0;
  let speedSum = 0;
  let speedCount = 0;
  let uncontactedNow = 0;
  let uncontactedBreaching = false;
  let created90 = 0;
  let won90 = 0;

  for (const l of leads) {
    if (l.createdAt >= weekStart) newThisWeek++;
    else if (l.createdAt >= prevWeekStart) newPrevWeek++;

    if (l.firstOutboundAt != null && l.createdAt >= cutoff30) {
      speedSum += l.firstOutboundAt - l.createdAt;
      speedCount++;
    }

    if (l.firstOutboundAt == null && !INACTIVE_STAGES.has(l.pipelineStage)) {
      uncontactedNow++;
      if (now - l.createdAt > SLA_RED_MS) uncontactedBreaching = true;
    }

    if (l.createdAt >= cutoff90) {
      created90++;
      if (WON_STAGES.has(l.pipelineStage)) won90++;
    }
  }

  return {
    newThisWeek,
    newThisWeekDelta: newThisWeek - newPrevWeek,
    avgSpeedToLeadMs: speedCount ? Math.round(speedSum / speedCount) : null,
    uncontactedNow,
    uncontactedBreaching,
    conversionPct: created90 ? Math.round((won90 / created90) * 100) : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npm test -- src/lib/pipeline/boardMetrics.test.ts`
Expected: PASS — `22 passed`.

- [ ] **Step 5: Commit**

```bash
cd app && git add src/lib/pipeline/boardMetrics.ts src/lib/pipeline/boardMetrics.test.ts
git commit -m "feat(pipeline): pure board-metrics compute (week delta, 30d speed, 90d conversion)"
```

---

### Task 3: Data layer — `listLeadsForBoard` + `boardMetricsFromLeads`

**Files:**
- Modify: `app/src/lib/leads.ts`
- Create: `app/src/lib/pipeline/metrics.ts`

**Interfaces:**
- Consumes: `leads`, `leadMessages` tables + `Lead` type from `./db/schema`; `computeBoardMetrics`, `LeadMetricInput`, `BoardMetrics` from `./boardMetrics`.
- Produces:
  - `type LeadWithSla = Lead & { firstOutboundAt: number | null }` (from `@/lib/leads`)
  - `listLeadsForBoard(): LeadWithSla[]`
  - `boardMetricsFromLeads(leads: LeadWithSla[]): BoardMetrics` (from `@/lib/pipeline/metrics`)

- [ ] **Step 1: Add the board query to `leads.ts`**

In `app/src/lib/leads.ts`, update the drizzle import (add `isNotNull`) — the current import is `import { and, desc, eq, like, or, sql } from "drizzle-orm";`. Replace it with:

```ts
import { and, desc, eq, isNotNull, like, or, sql } from "drizzle-orm";
```

Then append at the end of the file:

```ts
/** A board lead: the full row plus the epoch-ms of its first *sent* outbound message (or null). */
export type LeadWithSla = Lead & { firstOutboundAt: number | null };

/**
 * All leads for the pipeline board, each with `firstOutboundAt` computed in a
 * single grouped left-join (no N+1). `firstOutboundAt` = MIN(sent_at) over that
 * lead's SENT outbound messages (drafts have null sent_at and are excluded).
 * Ordered newest-first; the board buckets by stage client-side.
 */
export function listLeadsForBoard(): LeadWithSla[] {
  const firstOutbound = db
    .select({
      leadId: leadMessages.leadId,
      firstOutboundAt: sql<number>`min(${leadMessages.sentAt})`.as("first_outbound_at"),
    })
    .from(leadMessages)
    .where(and(eq(leadMessages.direction, "outbound"), isNotNull(leadMessages.sentAt)))
    .groupBy(leadMessages.leadId)
    .as("first_outbound");

  const rows = db
    .select({ lead: leads, firstOutboundAt: firstOutbound.firstOutboundAt })
    .from(leads)
    .leftJoin(firstOutbound, eq(firstOutbound.leadId, leads.id))
    .orderBy(desc(leads.createdAt))
    .all();

  return rows.map((r) => ({ ...r.lead, firstOutboundAt: r.firstOutboundAt ?? null }));
}
```

- [ ] **Step 2: Create the metrics wrapper**

Create `app/src/lib/pipeline/metrics.ts`:

```ts
/**
 * Thin now-injecting wrapper: maps already-loaded board leads → the pure
 * computeBoardMetrics. Kept separate from boardMetrics.ts so the pure logic
 * stays DB/clock-free and unit-testable. The page loads leads ONCE and passes
 * them here, so metrics add no extra query.
 */
import type { LeadWithSla } from "@/lib/leads";
import { computeBoardMetrics, type BoardMetrics, type LeadMetricInput } from "./boardMetrics";
import type { PipelineStage } from "./stages";

export function boardMetricsFromLeads(leads: LeadWithSla[]): BoardMetrics {
  const input: LeadMetricInput[] = leads.map((l) => ({
    createdAt: l.createdAt.getTime(),
    updatedAt: l.updatedAt.getTime(),
    pipelineStage: l.pipelineStage as PipelineStage,
    firstOutboundAt: l.firstOutboundAt,
  }));
  return computeBoardMetrics(input, Date.now());
}
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS (no errors). This verifies the drizzle subquery types + the `Lead` intersection resolve.

- [ ] **Step 4: Commit**

```bash
cd app && git add src/lib/leads.ts src/lib/pipeline/metrics.ts
git commit -m "feat(leads): listLeadsForBoard (firstOutboundAt join, no N+1) + boardMetricsFromLeads"
```

---

### Task 4: `LeadCard` component

**Files:**
- Create: `app/src/components/pipeline/LeadCard.tsx`

**Interfaces:**
- Consumes: `LeadWithSla` (`@/lib/leads`), `slaTone`, `isStale` (`@/lib/pipeline/boardMetrics`), `STAGES`, `PipelineStage` (`@/lib/pipeline/stages`), `Badge`, `initialsOf`.
- Produces: `LeadCard({ lead, now, onDraft, onWhatsApp }: LeadCardProps)` where
  `interface LeadCardProps { lead: LeadWithSla; now: number; onDraft: (id: number) => void; onWhatsApp: (id: number) => void }`

- [ ] **Step 1: Write the component**

Create `app/src/components/pipeline/LeadCard.tsx`:

```tsx
"use client";

import { Sparkles, MessageCircle } from "lucide-react";
import type { LeadWithSla } from "@/lib/leads";
import { Badge } from "@/components/ui/Badge";
import { slaTone, isStale } from "@/lib/pipeline/boardMetrics";
import { STAGES, type PipelineStage } from "@/lib/pipeline/stages";
import { initialsOf } from "@/lib/utils";

export interface LeadCardProps {
  lead: LeadWithSla;
  now: number;
  onDraft: (id: number) => void;
  onWhatsApp: (id: number) => void;
}

const SLA_HEX = { neutral: "var(--text-tertiary)", amber: "#d29922", red: "#dc2626" } as const;

function waitLabel(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `waiting ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `waiting ${h}h`;
  return `waiting ${Math.floor(h / 24)}d`;
}

/**
 * Presentational board card. Stage is conveyed by the column, so no StageChip
 * here — instead a speed-to-lead timer (uncontacted leads only) + a staleness
 * dot. Quick actions deep-link into the lead; they never send from the board.
 */
export function LeadCard({ lead, now, onDraft, onWhatsApp }: LeadCardProps) {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Anonymous";
  const initials = initialsOf(lead.firstName ?? "?", lead.lastName ?? "") || "??";
  const stage = lead.pipelineStage as PipelineStage;

  const waitingMs = lead.firstOutboundAt == null ? now - lead.createdAt.getTime() : null;
  const tone = waitingMs != null ? slaTone(waitingMs) : null;

  const msInStage = now - lead.updatedAt.getTime();
  const stale = isStale(msInStage, stage);
  const staleDays = Math.floor(msInStage / 86_400_000);

  return (
    <div
      style={{
        background: "var(--surface-2, var(--surface-1))",
        border: "1px solid var(--hairline)",
        borderRadius: "var(--radius)",
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        boxShadow: "var(--shadow-1)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            background: "var(--surface-1)",
            border: "1px solid var(--hairline)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 600,
            flex: "0 0 auto",
          }}
        >
          {initials}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}
          </span>
          <span
            style={{
              display: "block",
              fontSize: 11,
              color: "var(--text-tertiary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {lead.email ?? lead.phone ?? "—"}
          </span>
        </span>
        {stale && (
          <span
            title={`${staleDays}d in ${STAGES[stage].label}`}
            style={{ width: 7, height: 7, borderRadius: "50%", background: "#d29922", flex: "0 0 auto" }}
          />
        )}
      </div>

      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {lead.therapyInterest && <Badge>{lead.therapyInterest}</Badge>}
        {lead.campaign && <Badge>{lead.campaign}</Badge>}
        <Badge tone="neutral">{lead.source}</Badge>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {tone && (
          <span style={{ fontSize: 11, fontWeight: 600, color: SLA_HEX[tone] }}>
            {waitLabel(waitingMs!)}
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
          <button
            type="button"
            title="AI draft"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onDraft(lead.id);
            }}
            style={iconBtn}
          >
            <Sparkles size={14} />
          </button>
          {lead.phone && (
            <button
              type="button"
              title="WhatsApp"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onWhatsApp(lead.id);
              }}
              style={iconBtn}
            >
              <MessageCircle size={14} />
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  borderRadius: "var(--radius)",
  border: "1px solid var(--hairline)",
  background: "transparent",
  color: "var(--text-secondary)",
  cursor: "pointer",
};
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/components/pipeline/LeadCard.tsx
git commit -m "feat(pipeline): LeadCard — SLA timer, staleness dot, deep-link quick actions"
```

---

### Task 5: `StageColumn` (+ collapsed rail)

**Files:**
- Create: `app/src/components/pipeline/StageColumn.tsx`

**Interfaces:**
- Consumes: `useDroppable` (`@dnd-kit/core` — installed in Task 6; this task installs nothing, but the import resolves only after Task 6. To keep tasks independently typecheckable, **install the dep as Step 1 here**), `STAGES`, `PipelineStage` (`@/lib/pipeline/stages`).
- Produces: `StageColumn({ stage, count, total, rail, expanded, onToggle, children }: StageColumnProps)` where
  `interface StageColumnProps { stage: PipelineStage; count: number; total?: number; rail?: boolean; expanded?: boolean; onToggle?: () => void; children: React.ReactNode }`

- [ ] **Step 1: Install `@dnd-kit/core`**

Run: `cd app && npm install @dnd-kit/core`
Expected: `package.json` gains `"@dnd-kit/core"` under dependencies; `package-lock.json` updates.

- [ ] **Step 2: Write the component**

Create `app/src/components/pipeline/StageColumn.tsx`:

```tsx
"use client";

import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { STAGES, type PipelineStage } from "@/lib/pipeline/stages";

export interface StageColumnProps {
  stage: PipelineStage;
  count: number; // cards shown in this column
  total?: number; // all-time count (shown when it differs from `count`, e.g. won-stage 30d window)
  rail?: boolean; // lapsed / lost render as a slim collapsible rail
  expanded?: boolean;
  onToggle?: () => void;
  children: ReactNode;
}

/**
 * One droppable pipeline column. Funnel stages are full columns; `lapsed`/`lost`
 * pass `rail` and collapse to a slim vertical bar that is STILL a drop target
 * (auto-expands on drag-over via the isOver highlight).
 */
export function StageColumn({ stage, count, total, rail = false, expanded = true, onToggle, children }: StageColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const s = STAGES[stage];
  const collapsed = rail && !expanded && !isOver;

  if (collapsed) {
    return (
      <button
        ref={setNodeRef}
        onClick={onToggle}
        title={`${s.label} (${count})`}
        style={{
          width: 46,
          flex: "0 0 auto",
          alignSelf: "stretch",
          border: "1px solid var(--hairline)",
          background: "var(--surface-1)",
          borderRadius: "var(--radius)",
          cursor: "pointer",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: "12px 0",
          color: "var(--text-secondary)",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.colourHex }} />
        <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 12, letterSpacing: "0.04em" }}>
          {s.label}
        </span>
        <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>{count}</span>
      </button>
    );
  }

  return (
    <div
      style={{
        minWidth: 280,
        width: 280,
        flex: "0 0 auto",
        scrollSnapAlign: "start",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", marginBottom: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: s.colourHex }} />
        <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>{s.label}</strong>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-tertiary)" }}>
          {total != null && total !== count ? `${count} / ${total}` : count}
        </span>
        {rail && onToggle && (
          <button
            type="button"
            onClick={onToggle}
            title="Collapse"
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--text-tertiary)", display: "inline-flex" }}
          >
            <ChevronLeft size={14} />
          </button>
        )}
      </div>
      <div
        ref={setNodeRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 8,
          minHeight: 120,
          flex: 1,
          borderRadius: "var(--radius)",
          background: isOver ? `${s.colourHex}14` : "var(--surface-1)",
          border: `1px solid ${isOver ? `${s.colourHex}66` : "var(--hairline)"}`,
          transition: "background .15s var(--ease), border-color .15s var(--ease)",
        }}
      >
        {count === 0 ? (
          <div style={{ padding: "20px 8px", textAlign: "center", color: "var(--text-tertiary)", fontSize: 12, border: "1px dashed var(--hairline)", borderRadius: "var(--radius)" }}>
            No leads here
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
cd app && git add package.json package-lock.json src/components/pipeline/StageColumn.tsx
git commit -m "feat(pipeline): StageColumn droppable + slim collapsible lapsed/lost rail; add @dnd-kit/core"
```

---

### Task 6: `PipelineBoard` — dnd, optimistic move, undo, live refresh, view toggle

**Files:**
- Create: `app/src/components/pipeline/PipelineBoard.tsx`

**Interfaces:**
- Consumes: `LeadWithSla` (`@/lib/leads`), `setLeadStageAction` (`@/app/leads/actions`), `STAGES`, `STAGE_ORDER`, `PipelineStage` (`@/lib/pipeline/stages`), `LeadCard` (Task 4), `StageColumn` (Task 5), `LeadList` (`@/components/leads/LeadList`), `@dnd-kit/core`, `motion/react`, `sonner`, `next/navigation`.
- Produces: `PipelineBoard({ leads }: { leads: LeadWithSla[] })`.

**Notes for the implementer:**
- The 7 funnel columns are `STAGE_ORDER` minus `lapsed`/`lost`. Those two are the rails.
- Won-stage windowing: for `sale` + `repeat_customer`, show only cards with `updatedAt` within the last 30 days; header `total` = all cards in that stage.
- Motion: outer `motion.div layout` owns the auto-move glide; the inner dnd node owns the drag transform — keep them on **separate** elements so their transforms don't collide.

- [ ] **Step 1: Write the component**

Create `app/src/components/pipeline/PipelineBoard.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutGroup, motion } from "motion/react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Search } from "lucide-react";
import { toast } from "sonner";

import type { LeadWithSla } from "@/lib/leads";
import { setLeadStageAction } from "@/app/leads/actions";
import { STAGES, STAGE_ORDER, type PipelineStage } from "@/lib/pipeline/stages";
import { Input } from "@/components/ui/Input";
import { LeadList } from "@/components/leads/LeadList";
import { LeadCard } from "./LeadCard";
import { StageColumn } from "./StageColumn";

const FUNNEL: PipelineStage[] = STAGE_ORDER.filter((s) => s !== "lapsed" && s !== "lost");
const RAILS: PipelineStage[] = ["lapsed", "lost"];
const WON: ReadonlySet<PipelineStage> = new Set<PipelineStage>(["sale", "repeat_customer"]);
const WON_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function PipelineBoard({ leads: propLeads }: { leads: LeadWithSla[] }) {
  const router = useRouter();
  const [leads, setLeads] = useState<LeadWithSla[]>(propLeads);
  const [view, setView] = useState<"board" | "list">("board");
  const [q, setQ] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [railOpen, setRailOpen] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const draggingRef = useRef(false);

  // Server is the source of truth; when a refresh brings new props (e.g. the
  // auto-engine advanced a lead), adopt them — unless a drag is mid-flight.
  useEffect(() => {
    if (!draggingRef.current) setLeads(propLeads);
  }, [propLeads]);

  // Restore the saved view once on mount (avoids SSR mismatch).
  useEffect(() => {
    const saved = localStorage.getItem("leads.view");
    if (saved === "board" || saved === "list") setView(saved);
  }, []);
  useEffect(() => {
    localStorage.setItem("leads.view", view);
  }, [view]);

  // Live-ish clock + auto-move visibility: re-tick `now` and pull fresh server
  // data every 30s and whenever the tab regains focus.
  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      router.refresh();
    };
    const iv = setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(iv);
      window.removeEventListener("focus", tick);
    };
  }, [router]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter((l) =>
      [l.firstName, l.lastName, l.email, l.phone, l.therapyInterest, l.campaign, l.notes, l.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [leads, q]);

  // Bucket by stage; apply the 30-day window to won stages (keep all-time totals).
  const byStage = useMemo(() => {
    const visible = new Map<PipelineStage, LeadWithSla[]>();
    const totals = new Map<PipelineStage, number>();
    for (const s of STAGE_ORDER) {
      visible.set(s, []);
      totals.set(s, 0);
    }
    for (const l of filtered) {
      const s = l.pipelineStage as PipelineStage;
      totals.set(s, (totals.get(s) ?? 0) + 1);
      if (WON.has(s) && now - l.updatedAt.getTime() > WON_WINDOW_MS) continue;
      visible.get(s)?.push(l);
    }
    return { visible, totals };
  }, [filtered, now]);

  const openLead = useCallback((id: number) => router.push(`/leads/${id}`), [router]);
  const draftLead = useCallback((id: number) => router.push(`/leads/${id}?draft=1`), [router]);
  const whatsappLead = useCallback((id: number) => router.push(`/leads/${id}?reply=whatsapp`), [router]);

  const move = useCallback(
    (id: number, to: PipelineStage, from: PipelineStage) => {
      setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, pipelineStage: to } : l)));
      startTransition(async () => {
        try {
          await setLeadStageAction(id, to);
          toast.success(`Moved to ${STAGES[to].label}`, {
            duration: 5000,
            action: { label: "Undo", onClick: () => move(id, from, to) },
          });
        } catch {
          setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, pipelineStage: from } : l)));
          toast.error("Couldn't move the lead. Reverted.");
        }
      });
    },
    [],
  );

  function onDragStart(e: DragStartEvent) {
    draggingRef.current = true;
    setActiveId(Number(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    draggingRef.current = false;
    setActiveId(null);
    const overId = e.over?.id as PipelineStage | undefined;
    if (!overId) return;
    const id = Number(e.active.id);
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.pipelineStage === overId) return;
    move(id, overId, lead.pipelineStage as PipelineStage);
  }

  const activeLead = activeId != null ? leads.find((l) => l.id === activeId) ?? null : null;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, maxWidth: 360 }}>
          <Search size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)", pointerEvents: "none" }} />
          <Input placeholder="Search leads…" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 34 }} />
        </div>
        <div role="tablist" style={{ marginLeft: "auto", display: "inline-flex", background: "var(--surface-1)", border: "1px solid var(--hairline)", borderRadius: "var(--radius)", padding: 3, gap: 2 }}>
          {(["board", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                padding: "6px 14px",
                borderRadius: "var(--radius)",
                fontSize: 13,
                fontWeight: 500,
                textTransform: "capitalize",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                color: view === v ? "var(--text-primary)" : "var(--text-secondary)",
                background: view === v ? "var(--bg)" : "transparent",
                boxShadow: view === v ? "0 1px 3px -1px rgba(0,0,0,0.1)" : "none",
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "list" ? (
        <LeadList leads={leads} />
      ) : (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <LayoutGroup>
            <div style={{ display: "flex", gap: 12, overflowX: "auto", scrollSnapType: "x proximity", paddingBottom: 12, alignItems: "stretch" }}>
              {FUNNEL.map((stage) => {
                const cards = byStage.visible.get(stage) ?? [];
                return (
                  <StageColumn key={stage} stage={stage} count={cards.length} total={byStage.totals.get(stage)}>
                    {cards.map((lead) => (
                      <DraggableCard key={lead.id} lead={lead} now={now} onOpen={openLead} onDraft={draftLead} onWhatsApp={whatsappLead} />
                    ))}
                  </StageColumn>
                );
              })}
              {RAILS.map((stage) => {
                const cards = byStage.visible.get(stage) ?? [];
                return (
                  <StageColumn
                    key={stage}
                    stage={stage}
                    count={cards.length}
                    total={byStage.totals.get(stage)}
                    rail
                    expanded={!!railOpen[stage]}
                    onToggle={() => setRailOpen((r) => ({ ...r, [stage]: !r[stage] }))}
                  >
                    {cards.map((lead) => (
                      <DraggableCard key={lead.id} lead={lead} now={now} onOpen={openLead} onDraft={draftLead} onWhatsApp={whatsappLead} />
                    ))}
                  </StageColumn>
                );
              })}
            </div>
          </LayoutGroup>
          <DragOverlay>
            {activeLead ? (
              <div style={{ width: 280 }}>
                <LeadCard lead={activeLead} now={now} onDraft={() => {}} onWhatsApp={() => {}} />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      )}
    </>
  );
}

/** Wraps a LeadCard: outer motion.div owns the auto-move glide; inner node owns the drag transform. */
function DraggableCard({
  lead,
  now,
  onOpen,
  onDraft,
  onWhatsApp,
}: {
  lead: LeadWithSla;
  now: number;
  onOpen: (id: number) => void;
  onDraft: (id: number) => void;
  onWhatsApp: (id: number) => void;
}) {
  const { setNodeRef, listeners, attributes, transform, isDragging } = useDraggable({ id: lead.id });
  return (
    <motion.div layout transition={{ duration: 0.25 }} style={{ opacity: isDragging ? 0.35 : 1 }}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={() => onOpen(lead.id)}
        style={{
          cursor: "grab",
          touchAction: "none",
          transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        }}
      >
        <LeadCard lead={lead} now={now} onDraft={onDraft} onWhatsApp={onWhatsApp} />
      </div>
    </motion.div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/components/pipeline/PipelineBoard.tsx
git commit -m "feat(pipeline): PipelineBoard — dnd stage moves (optimistic + undo), 30s refresh, board/list toggle"
```

---

### Task 7: `PipelineMetrics` strip

**Files:**
- Create: `app/src/components/pipeline/PipelineMetrics.tsx`

**Interfaces:**
- Consumes: `BoardMetrics` (`@/lib/pipeline/boardMetrics`), `Card` (`@/components/ui/Card`).
- Produces: `PipelineMetrics({ metrics }: { metrics: BoardMetrics })`.

- [ ] **Step 1: Write the component**

Create `app/src/components/pipeline/PipelineMetrics.tsx`:

```tsx
import type { BoardMetrics } from "@/lib/pipeline/boardMetrics";
import { Card } from "@/components/ui/Card";

/** Four funnel stat tiles above the board. Server component — pure render of computed metrics. */
export function PipelineMetrics({ metrics }: { metrics: BoardMetrics }) {
  const speed = fmtDuration(metrics.avgSpeedToLeadMs);
  const delta = metrics.newThisWeekDelta;
  const deltaLabel = delta === 0 ? "same as last week" : `${delta > 0 ? "+" : ""}${delta} vs last week`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 24 }}>
      <Tile label="New this week" value={String(metrics.newThisWeek)} sub={deltaLabel} />
      <Tile label="Avg speed to lead" value={speed} sub="last 30 days" />
      <Tile
        label="Uncontacted now"
        value={String(metrics.uncontactedNow)}
        sub={metrics.uncontactedBreaching ? "some waiting >1h" : "within SLA"}
        danger={metrics.uncontactedBreaching}
      />
      <Tile label="Lead → sale" value={metrics.conversionPct == null ? "—" : `${metrics.conversionPct}%`} sub="last 90 days" />
    </div>
  );
}

function Tile({ label, value, sub, danger = false }: { label: string; value: string; sub: string; danger?: boolean }) {
  return (
    <Card style={{ padding: 16 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-tertiary)", fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, marginTop: 6, color: danger ? "#dc2626" : "var(--text-primary)", fontFamily: "var(--font-heading), sans-serif" }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: "var(--text-tertiary)", marginTop: 2 }}>{sub}</div>
    </Card>
  );
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd app && npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/components/pipeline/PipelineMetrics.tsx
git commit -m "feat(pipeline): PipelineMetrics — 4-tile funnel stat strip"
```

---

### Task 8: Wire `/leads` page + full quality gate

**Files:**
- Modify: `app/src/app/leads/page.tsx`

**Interfaces:**
- Consumes: `listLeadsForBoard` (`@/lib/leads`), `boardMetricsFromLeads` (`@/lib/pipeline/metrics`), `PipelineBoard`, `PipelineMetrics`.

- [ ] **Step 1: Rewrite the page**

Replace the body of `app/src/app/leads/page.tsx` with:

```tsx
import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { PipelineMetrics } from "@/components/pipeline/PipelineMetrics";
import { listLeadsForBoard } from "@/lib/leads";
import { boardMetricsFromLeads } from "@/lib/pipeline/metrics";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = listLeadsForBoard();
  const metrics = boardMetricsFromLeads(leads);

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Pipeline"
        title="Leads"
        subtitle="Drag leads through the funnel as they progress. New Facebook and manual leads land in the first column — respond fast."
        actions={
          <Link href="/leads/new">
            <Button>
              <Plus size={15} />
              Add lead
            </Button>
          </Link>
        }
      />

      {leads.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={32} strokeWidth={1.4} />}
          title="No leads yet"
          message="Facebook Lead Ads flow in automatically once a Page is connected, or add a lead manually to test the flow."
          action={
            <Link href="/leads/new">
              <Button>
                <Plus size={15} />
                Add lead manually
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          <PipelineMetrics metrics={metrics} />
          <PipelineBoard leads={leads} />
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Run the full gate**

Run: `cd app && npm run typecheck && npm test && npx next build`
Expected: typecheck clean; tests all pass (includes `22 passed` from `boardMetrics.test.ts`); `next build` succeeds.

- [ ] **Step 3: Commit**

```bash
cd app && git add src/app/leads/page.tsx
git commit -m "feat(leads): pipeline board is now the Leads page (List tab preserved)"
```

- [ ] **Step 4: Manual QA on `npm run dev` (http://localhost:3000/leads)**

Verify:
- Board renders 7 funnel columns + Lapsed/Lost rails; counts correct; won columns show `visible / total`.
- Drag a card across columns → it stays, "Moved to X" toast appears, **Undo** returns it.
- Kill the network (DevTools offline) → drag → card reverts + error toast.
- New-lead cards show a `waiting Nm` timer that goes amber (>15m) / red (>1h); a card untouched >7d shows the staleness dot.
- Board ↔ List toggle persists across reload (localStorage).
- Change a lead's stage elsewhere (e.g. mark an appointment, or edit in another tab) → within 30s / on focus the card glides to its new column.
- Metrics tiles read sensibly; "Uncontacted now" turns red when a lead is >1h uncontacted.

---

## Self-Review

**1. Spec coverage:**
- Board replaces `/leads`, List tab preserved → Task 8 + Task 6 (`view` toggle rendering `LeadList`). ✓
- 7 funnel columns + Lapsed/Lost slim rails, always droppable, auto-expand on drag-over → Task 5 (`rail`/`collapsed`, `isOver` forces expand) + Task 6 (`FUNNEL`/`RAILS`). ✓
- Won-stage 30d windowing with all-time total in header → Task 6 (`WON_WINDOW_MS` bucketing) + Task 5 (`count / total`). ✓
- Card: SLA timer (amber >15m / red >1h), staleness dot (>7d, suppressed for won/lost), quick actions deep-linking (no board send) → Task 4 + Task 1. ✓
- Drag = `setLeadStageAction` manual override, optimistic + 5s Undo, revert on error → Task 6 (`move`). ✓
- Auto-engine visibility: 30s + focus refresh, motion layout glide → Task 6 (`router.refresh` interval, `motion.div layout`). ✓
- Metrics strip (new this week ±, avg speed 30d, uncontacted w/ red breach, conversion 90d) from existing data, one query → Task 2 (`computeBoardMetrics`) + Task 3 (`boardMetricsFromLeads`, page loads leads once) + Task 7. ✓
- `firstOutboundAt` join, no N+1, no schema change → Task 3 (`listLeadsForBoard`). ✓
- Token-driven styling / theme inheritance → all components use CSS vars + `STAGES[*].colourHex`. ✓
- Error handling: failed drop reverts; page renders even with empty metrics (tiles show `—`) → Task 6 + Task 7. ✓
- Tests: pure SLA thresholds, staleness, metrics bucketing, won-window → Tasks 1–2. ✓
- Open question (refresh mechanism) resolved: `router.refresh()` on 30s + focus (no new endpoint) → Task 6. ✓
- Deferred/non-goals (analytics page, board-side sending, SLA config, saved views) → not built. ✓

**2. Placeholder scan:** No TBD/TODO; every code step has complete code; every command has expected output. ✓

**3. Type consistency:** `LeadWithSla` (Task 3) is consumed identically in Tasks 4/6; `BoardMetrics`/`LeadMetricInput`/`computeBoardMetrics`/`startOfWeekMs` (Task 2) consumed in Tasks 3/7; `slaTone`/`isStale` (Task 1) consumed in Task 4; `StageColumnProps`/`LeadCardProps` signatures match their call sites in Task 6; `setLeadStageAction(id, stage)` matches the existing `(leadId: number, stage: PipelineStage) => Promise<void>`. ✓
