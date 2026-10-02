# Customisable Dashboard — Slice 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed `/dashboard` with a tabbed, customisable dashboard (widget registry, per-user tabs with team/platform defaults, drag/resize/add/remove edit mode, per-tab date range, admin widget-visibility settings) whose default Overview tab reproduces today's dashboard from widgets.

**Architecture:** Pure metadata (`catalog.ts`, `presets.ts`, `range.ts`, `visibility.ts`) is unit-tested without a DB. Server-only widget implementations (`widgets/overview.tsx`) load data via existing queries and render shared view components; `satisfies Record<WidgetKey, WidgetImpl>` makes a missing implementation a type error. Tabs persist in a new tenant `dashboards` table (`tabs.ts`); viewing never writes, the first edit copies the resolved tabs into the user's own rows. The page is a server component reading `?tab=<index>&range=<key>`, rendering each widget in its own Suspense + error boundary, and handing the rendered nodes to a client grid that owns edit mode.

**Tech Stack:** Next.js 14 App Router (server components + server actions), drizzle-orm over better-sqlite3, `@dnd-kit/core` + `@dnd-kit/sortable`, Radix Dialog/Sheet/DropdownMenu via `src/components/ui/*`, lucide-react, zod. Tests: plain `node:assert/strict` scripts run by `npm test -- <path>` (tsx, no framework).

Spec: `docs/superpowers/specs/2026-10-02-customisable-dashboard-design.md`. This plan covers delivery slice 1 only. Slices 2 (recorders), 3 and 4 (presets) get their own plans; this slice must leave the registry and preset shapes ready for them.

## Global Constraints

- NO EMOJIS anywhere (UI, code, comments, commits). Use lucide-react icons.
- All work in `app/`. Run commands from `/Users/truep/Desktop/Clients/Renova/app`.
- New tables are additive: add to `ensureTenantTables` in `src/lib/db/tenant.ts` (`CREATE TABLE IF NOT EXISTS`), plus the drizzle definition in `src/lib/db/schema.ts`. Do NOT add a versioned migration.
- Tenant data goes through the ambient `db` from `@/lib/db`; never take a `tenantId` parameter to smuggle into SQL.
- Sizes: `S`=1, `M`=2, `L`=3, `XL`=4 columns of a 4-column grid; 2 columns at `max-width: 1024px`, 1 column at `max-width: 640px`.
- Range keys: `today`, `7d`, `30d`, `90d`, `month`, plus URL-only `custom` (`&from=YYYY-MM-DD&to=YYYY-MM-DD`). Tab default range `30d`.
- Limits: max 40 widgets per tab, max 20 tabs per user. Deleting the last tab is refused.
- Sensitivity default: `general` visible to staff; `financial` and `spend` hidden from staff. Admins always see every widget.
- Visibility is enforced on the server BEFORE a widget's `load` runs.
- Viewing the dashboard never writes to the DB.
- Venue: `getSchedulingMode() === "timetable"` means `gym`, else `clinic` (same test the current page uses).
- Before deploy: `npm run typecheck`, `npm test`, `npx next build` all pass; deploy with `railway up` from `app/` after pushing `main`.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/dashboard/range.ts` | Range keys, resolution to concrete windows, previous period, `deltaPct` (pure) |
| `src/lib/dashboard/types.ts` | Shared types: sizes, domains, `WidgetMeta`, `WidgetRef`, `WidgetCtx`, `WidgetImpl` |
| `src/lib/dashboard/catalog.ts` | `CATALOG` metadata (pure, `as const`), `WidgetKey`, `CATALOG_BY_KEY`, `validateLayout` |
| `src/lib/dashboard/presets.ts` | Preset definitions (Overview in this slice), `presetWidgets` (pure) |
| `src/lib/dashboard/visibility.ts` | `staffCanSeeByDefault`, `canSee`, `visibleRefs` (pure) |
| `src/lib/dashboard/visibilityStore.ts` | Read/write `dashboard_widget_visibility` setting (server) |
| `src/lib/dashboard/tabs.ts` | Tab storage: resolve, materialise-on-edit, CRUD, team default, reset (server) |
| `src/lib/dashboard/widgets/overview.tsx` | Overview widget implementations (server) |
| `src/lib/dashboard/widgets/index.ts` | `WIDGET_IMPLS: Record<WidgetKey, WidgetImpl>` |
| `src/components/dashboard/views/*.tsx` | Shared views: `KpiTile`, `RowList`, `StageBars`, `TodaysScheduleView`, `TodaysClassesView` |
| `src/components/dashboard/WidgetSlot.tsx` | Async server component: run `load`, render, log failures |
| `src/components/dashboard/WidgetErrorBoundary.tsx` | Client error boundary with Retry |
| `src/components/dashboard/DashboardGrid.tsx` | Client grid + edit mode (sortable, size, remove, add sheet, save/cancel) |
| `src/components/dashboard/TabBar.tsx` | Client tab bar: tabs, add-tab dialog, tab menu, range picker, Customise |
| `src/app/dashboard/actions.ts` | Server actions for every mutation |
| `src/app/dashboard/page.tsx` | Rewritten page |
| `src/app/settings/dashboard/page.tsx` + `VisibilityTable.tsx` | Admin visibility settings |
| `src/app/globals.css` | Grid + wobble CSS |

---

### Task 1: Date ranges

**Files:**
- Create: `src/lib/dashboard/range.ts`
- Test: `src/lib/dashboard/range.test.ts`

**Interfaces:**
- Produces:
  - `type RangeKey = "today" | "7d" | "30d" | "90d" | "month" | "custom"`
  - `const STORED_RANGE_KEYS: readonly ["today","7d","30d","90d","month"]`
  - `interface ResolvedRange { key: RangeKey; label: string; fromMs: number; toMs: number; fromIso: string; toIso: string; days: number }` (`toMs` exclusive, `toIso` inclusive)
  - `parseRangeKey(v: unknown): RangeKey | null`
  - `resolveRange(key: RangeKey, now: Date, custom?: { from?: string; to?: string }): ResolvedRange`
  - `previousRange(r: ResolvedRange): ResolvedRange`
  - `deltaPct(cur: number, prev: number): number | null`

- [ ] **Step 1: Write the failing test**

```ts
// Run: npm test -- src/lib/dashboard/range.test.ts
//
// Dashboard date ranges: every window is whole UTC days, toMs is exclusive,
// toIso inclusive; the previous period is the same length immediately
// before; a bad custom range falls back to 30 days rather than throwing.
import assert from "node:assert/strict";
import { deltaPct, parseRangeKey, previousRange, resolveRange } from "./range";

const now = new Date("2026-10-02T15:00:00Z");

const today = resolveRange("today", now);
assert.equal(today.fromIso, "2026-10-02");
assert.equal(today.toIso, "2026-10-02");
assert.equal(today.days, 1);
assert.equal(today.toMs - today.fromMs, 86_400_000);

const week = resolveRange("7d", now);
assert.equal(week.fromIso, "2026-09-26");
assert.equal(week.toIso, "2026-10-02");
assert.equal(week.days, 7);

assert.equal(resolveRange("30d", now).fromIso, "2026-09-03");
assert.equal(resolveRange("90d", now).days, 90);

const month = resolveRange("month", now);
assert.equal(month.fromIso, "2026-10-01");
assert.equal(month.days, 2);

const prev = previousRange(week);
assert.equal(prev.fromIso, "2026-09-19");
assert.equal(prev.toIso, "2026-09-25");
assert.equal(prev.days, 7);
assert.equal(prev.toMs, week.fromMs);

const custom = resolveRange("custom", now, { from: "2026-09-01", to: "2026-09-10" });
assert.equal(custom.fromIso, "2026-09-01");
assert.equal(custom.toIso, "2026-09-10");
assert.equal(custom.days, 10);
assert.equal(custom.label, "1 Sep - 10 Sep");

const badCustom = resolveRange("custom", now, { from: "2026-09-10", to: "2026-09-01" });
assert.equal(badCustom.key, "30d", "reversed custom range falls back to 30d");
assert.equal(resolveRange("custom", now, { from: "nope" }).key, "30d");

assert.equal(parseRangeKey("7d"), "7d");
assert.equal(parseRangeKey("custom"), "custom");
assert.equal(parseRangeKey("bogus"), null);
assert.equal(parseRangeKey(undefined), null);

assert.equal(deltaPct(12, 10), 20);
assert.equal(deltaPct(5, 10), -50);
assert.equal(deltaPct(5, 0), null, "no baseline means no percentage");
assert.equal(deltaPct(0, 0), null);

console.log("range.test.ts: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/dashboard/range.test.ts`
Expected: FAIL, cannot find module `./range`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Dashboard date ranges. Every window is a run of whole UTC days (the same
 * day boundary lib/dashboard.ts and the appointment `date` column use).
 * `toMs` is exclusive so it can feed `lt()` on timestamp columns; `toIso`
 * is inclusive so it can feed `lte()` on ISO `date` text columns.
 *
 * Pure: no DB, no server imports.
 */
export type RangeKey = "today" | "7d" | "30d" | "90d" | "month" | "custom";

/** The keys a tab may persist. `custom` lives only in the URL. */
export const STORED_RANGE_KEYS = ["today", "7d", "30d", "90d", "month"] as const;
export type StoredRangeKey = (typeof STORED_RANGE_KEYS)[number];

const ALL_KEYS: readonly RangeKey[] = [...STORED_RANGE_KEYS, "custom"];

export const RANGE_LABELS: Record<StoredRangeKey, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  month: "This month",
};

export interface ResolvedRange {
  key: RangeKey;
  label: string;
  fromMs: number;
  toMs: number;
  fromIso: string;
  toIso: string;
  days: number;
}

const DAY = 86_400_000;
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function build(key: RangeKey, label: string, fromMs: number, toMs: number): ResolvedRange {
  return {
    key,
    label,
    fromMs,
    toMs,
    fromIso: isoOf(fromMs),
    toIso: isoOf(toMs - DAY),
    days: Math.round((toMs - fromMs) / DAY),
  };
}

export function parseRangeKey(v: unknown): RangeKey | null {
  return typeof v === "string" && (ALL_KEYS as readonly string[]).includes(v) ? (v as RangeKey) : null;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function resolveRange(
  key: RangeKey,
  now: Date,
  custom?: { from?: string; to?: string },
): ResolvedRange {
  const start = dayStart(now);
  const end = start + DAY;
  switch (key) {
    case "today":
      return build(key, RANGE_LABELS.today, start, end);
    case "7d":
      return build(key, RANGE_LABELS["7d"], start - 6 * DAY, end);
    case "90d":
      return build(key, RANGE_LABELS["90d"], start - 89 * DAY, end);
    case "month":
      return build(key, RANGE_LABELS.month, Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1), end);
    case "custom": {
      const from = custom?.from;
      const to = custom?.to;
      if (from && to && ISO_RE.test(from) && ISO_RE.test(to)) {
        const f = Date.parse(`${from}T00:00:00Z`);
        const t = Date.parse(`${to}T00:00:00Z`);
        if (Number.isFinite(f) && Number.isFinite(t) && f <= t) {
          return build("custom", `${shortDate(from)} - ${shortDate(to)}`, f, t + DAY);
        }
      }
      return resolveRange("30d", now);
    }
    case "30d":
    default:
      return build("30d", RANGE_LABELS["30d"], start - 29 * DAY, end);
  }
}

/** The same-length window immediately before `r`. */
export function previousRange(r: ResolvedRange): ResolvedRange {
  const len = r.toMs - r.fromMs;
  return build(r.key, "Previous period", r.fromMs - len, r.fromMs);
}

/** Percentage change, rounded to a whole number; null when there is no baseline. */
export function deltaPct(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 100);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/dashboard/range.test.ts`
Expected: `range.test.ts: ok`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/range.ts src/lib/dashboard/range.test.ts
git commit -m "feat(dashboard): date range resolution for widgets"
```

---

### Task 2: Types, catalog and layout validation

**Files:**
- Create: `src/lib/dashboard/types.ts`, `src/lib/dashboard/catalog.ts`
- Test: `src/lib/dashboard/catalog.test.ts`

**Interfaces:**
- Consumes: `RangeKey`, `StoredRangeKey`, `ResolvedRange`, `STORED_RANGE_KEYS` from Task 1.
- Produces:
  - `types.ts`: `WidgetSize`, `SIZE_SPAN`, `Domain`, `DOMAIN_LABELS`, `Sensitivity`, `Venue`, `RangeMode`, `WidgetMeta`, `WidgetRef`, `WidgetCtx`, `WidgetImpl<T>`
  - `catalog.ts`: `CATALOG` (readonly `WidgetMeta[]`, `as const`), `type WidgetKey`, `CATALOG_BY_KEY: Map<string, WidgetMeta>`, `MAX_WIDGETS_PER_TAB = 40`, `MAX_TABS_PER_USER = 20`, `validateLayout(input: unknown): WidgetRef[]` (throws `Error` with a readable message)

- [ ] **Step 1: Write the failing test**

```ts
// Run: npm test -- src/lib/dashboard/catalog.test.ts
//
// The widget catalog is the contract every preset, saved layout and the
// visibility screen is checked against. Pure: no DB, no server imports.
import assert from "node:assert/strict";
import { CATALOG, CATALOG_BY_KEY, MAX_WIDGETS_PER_TAB, validateLayout } from "./catalog";
import { SIZE_SPAN } from "./types";

const seen = new Set<string>();
for (const m of CATALOG) {
  assert.ok(!seen.has(m.key), `${m.key} is unique`);
  seen.add(m.key);
  assert.match(m.key, /^[a-z]+\.[a-zA-Z]+$/, `${m.key} is domain.camelName`);
  assert.ok(m.key.startsWith(`${m.domain}.`), `${m.key} is prefixed by its domain`);
  assert.ok(m.title.length > 0 && m.description.length > 0, `${m.key} has copy`);
  assert.ok(m.sizes.length > 0, `${m.key} allows a size`);
  assert.ok((m.sizes as readonly string[]).includes(m.defaultSize), `${m.key} default size is allowed`);
  for (const s of m.sizes) assert.ok(s in SIZE_SPAN, `${m.key} size ${s} is known`);
  assert.ok(m.venues.length > 0, `${m.key} applies to a venue`);
  if (m.rangeMode === "pinned") assert.ok(m.pinnedRange, `${m.key} pinned needs pinnedRange`);
}
assert.equal(CATALOG_BY_KEY.size, CATALOG.length);

// validateLayout: accepts a good layout, drops nothing silently, rejects bad input.
const good = validateLayout([
  { key: "overview.newLeads", size: "S" },
  { key: "overview.revenueTrend", size: "XL", range: "90d" },
]);
assert.equal(good.length, 2);
assert.equal(good[1].range, "90d");

assert.throws(() => validateLayout("x"), /list/);
assert.throws(() => validateLayout([{ key: "nope.widget", size: "S" }]), /Unknown widget/);
assert.throws(() => validateLayout([{ key: "overview.newLeads", size: "XL" }]), /size/);
assert.throws(() => validateLayout([{ key: "overview.newLeads", size: "S", range: "custom" }]), /range/);
assert.throws(
  () => validateLayout(Array.from({ length: MAX_WIDGETS_PER_TAB + 1 }, () => ({ key: "overview.newLeads", size: "S" }))),
  /at most/,
);

console.log("catalog.test.ts: ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/dashboard/catalog.test.ts`
Expected: FAIL, cannot find module `./catalog`.

- [ ] **Step 3: Write `types.ts`**

```ts
import type { ReactNode } from "react";
import type { RangeKey, ResolvedRange, StoredRangeKey } from "./range";
import type { getVocab } from "@/lib/vocabulary";

export type WidgetSize = "S" | "M" | "L" | "XL";
export const SIZE_SPAN: Record<WidgetSize, number> = { S: 1, M: 2, L: 3, XL: 4 };
export const SIZE_ORDER: readonly WidgetSize[] = ["S", "M", "L", "XL"];

export type Domain =
  | "overview"
  | "sales"
  | "marketing"
  | "email"
  | "communication"
  | "frontdesk"
  | "classes"
  | "finance"
  | "content"
  | "website"
  | "competitors"
  | "ai";

export const DOMAIN_LABELS: Record<Domain, string> = {
  overview: "Overview",
  sales: "Sales",
  marketing: "Marketing",
  email: "Email",
  communication: "Communication",
  frontdesk: "Front desk",
  classes: "Classes",
  finance: "Finance",
  content: "Content & Social",
  website: "Website",
  competitors: "Competitors",
  ai: "AI & Usage",
};

export type Sensitivity = "general" | "financial" | "spend";
export type Venue = "clinic" | "gym";
/** tab = follows the tab range; pinned = always `pinnedRange`; none = not time-based. */
export type RangeMode = "tab" | "pinned" | "none";

export interface WidgetMeta {
  key: string;
  title: string;
  description: string;
  domain: Domain;
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  venues: readonly Venue[];
  sensitivity: Sensitivity;
  rangeMode: RangeMode;
  pinnedRange?: StoredRangeKey;
}

/** One widget as saved on a tab. */
export interface WidgetRef {
  key: string;
  size: WidgetSize;
  /** Per-widget override of the tab range (only for rangeMode "tab"). */
  range?: StoredRangeKey;
}

export interface WidgetCtx {
  venue: Venue;
  vocab: ReturnType<typeof getVocab>;
  range: ResolvedRange;
  previous: ResolvedRange;
  now: Date;
  /** Per-request memo shared by every widget on the page. */
  cache: Map<string, Promise<unknown>>;
}

export interface WidgetImpl<T = unknown> {
  /** Title override that needs tenant vocabulary; falls back to meta.title. */
  label?: (ctx: WidgetCtx) => string;
  /** Click-through for the tile header. */
  href?: string;
  load(ctx: WidgetCtx): Promise<T>;
  render(data: T, ctx: WidgetCtx): ReactNode;
}

export type { RangeKey };
```

- [ ] **Step 4: Write `catalog.ts`**

The Overview widgets only in this slice. Later slices append entries for their domains to `CATALOG`.

```ts
/**
 * Every dashboard widget's metadata, in one pure list. Implementations live
 * in ./widgets/*.tsx and are keyed by the same `key`; ./widgets/index.ts
 * uses `satisfies Record<WidgetKey, WidgetImpl>` so a catalog entry without
 * an implementation (or the reverse) fails typecheck.
 *
 * Pure: no DB, no server imports (the tests and the client bundle read it).
 */
import { STORED_RANGE_KEYS, type StoredRangeKey } from "./range";
import { SIZE_SPAN, type WidgetMeta, type WidgetRef, type WidgetSize } from "./types";

export const MAX_WIDGETS_PER_TAB = 40;
export const MAX_TABS_PER_USER = 20;

export const CATALOG = [
  // ── Overview: clinic ────────────────────────────────────────────────────
  {
    key: "overview.todaysBookings",
    title: "Today's bookings",
    description: "Bookings on today's diary, split by confirmed and pending.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "general",
    rangeMode: "pinned",
    pinnedRange: "today",
  },
  {
    key: "overview.todaysEarnings",
    title: "Today's earnings",
    description: "Value of sessions completed today.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "financial",
    rangeMode: "pinned",
    pinnedRange: "today",
  },
  {
    key: "overview.cashToday",
    title: "Cash today",
    description: "Payments recorded on the till today.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "financial",
    rangeMode: "pinned",
    pinnedRange: "today",
  },
  {
    key: "overview.deferredRevenue",
    title: "Deferred revenue",
    description: "Unused package credits plus open voucher balances.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "financial",
    rangeMode: "none",
  },
  {
    key: "overview.activeClients",
    title: "Active clients",
    description: "Clients who visited in the last 90 days.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.plansExpiring",
    title: "Plans expiring",
    description: "Packages expiring in the next 30 days.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.todaysSchedule",
    title: "Today's schedule",
    description: "Every booking on today's diary with its therapies and status.",
    domain: "overview",
    sizes: ["M", "L", "XL"],
    defaultSize: "L",
    venues: ["clinic"],
    sensitivity: "general",
    rangeMode: "pinned",
    pinnedRange: "today",
  },
  // ── Overview: gym ───────────────────────────────────────────────────────
  {
    key: "overview.activeMembers",
    title: "Active members",
    description: "Members on an active membership.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.mrr",
    title: "Monthly recurring",
    description: "Monthly recurring revenue from active memberships.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["gym"],
    sensitivity: "financial",
    rangeMode: "none",
  },
  {
    key: "overview.classesThisWeek",
    title: "Classes this week",
    description: "Classes scheduled Monday to Sunday this week.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.attendance",
    title: "Attendance",
    description: "Share of class bookings attended over the last 30 days.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.todaysClasses",
    title: "Today's classes",
    description: "Today's classes with how full each one is.",
    domain: "overview",
    sizes: ["M", "L", "XL"],
    defaultSize: "L",
    venues: ["gym"],
    sensitivity: "general",
    rangeMode: "pinned",
    pinnedRange: "today",
  },
  // ── Overview: both venues ───────────────────────────────────────────────
  {
    key: "overview.newLeads",
    title: "New leads",
    description: "Leads created in the period, with the change on the previous period.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "tab",
  },
  {
    key: "overview.unreadMessages",
    title: "Unread messages",
    description: "Inbound emails nobody has opened yet.",
    domain: "overview",
    sizes: ["S", "M"],
    defaultSize: "S",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.needsAttention",
    title: "Needs attention",
    description: "Unread email and leads waiting for a first follow-up.",
    domain: "overview",
    sizes: ["L", "XL"],
    defaultSize: "XL",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.recentActivity",
    title: "Recent activity",
    description: "The latest things that happened across the account.",
    domain: "overview",
    sizes: ["S", "M", "L"],
    defaultSize: "S",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.revenueTrend",
    title: "Revenue trend",
    description: "Revenue per day from completed sessions, against the previous period.",
    domain: "overview",
    sizes: ["L", "XL"],
    defaultSize: "XL",
    venues: ["clinic", "gym"],
    sensitivity: "financial",
    rangeMode: "tab",
  },
  {
    key: "overview.pipelineSnapshot",
    title: "Pipeline snapshot",
    description: "How many leads sit in each stage of your main pipeline right now.",
    domain: "overview",
    sizes: ["M", "L", "XL"],
    defaultSize: "M",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
  {
    key: "overview.upcomingPosts",
    title: "Upcoming posts",
    description: "The next social posts scheduled to go out.",
    domain: "overview",
    sizes: ["M", "L"],
    defaultSize: "M",
    venues: ["clinic", "gym"],
    sensitivity: "general",
    rangeMode: "none",
  },
] as const satisfies readonly WidgetMeta[];

export type WidgetKey = (typeof CATALOG)[number]["key"];

export const CATALOG_BY_KEY: Map<string, WidgetMeta> = new Map(
  (CATALOG as readonly WidgetMeta[]).map((m) => [m.key, m]),
);

/**
 * Validate an untrusted layout (from a server action) against the catalog.
 * Throws with a readable message on the first problem; returns a clean copy.
 */
export function validateLayout(input: unknown): WidgetRef[] {
  if (!Array.isArray(input)) throw new Error("Layout must be a list of widgets.");
  if (input.length > MAX_WIDGETS_PER_TAB) {
    throw new Error(`A tab can hold at most ${MAX_WIDGETS_PER_TAB} widgets.`);
  }
  return input.map((raw, i) => {
    const r = raw as Partial<WidgetRef> | null;
    const meta = r && typeof r.key === "string" ? CATALOG_BY_KEY.get(r.key) : undefined;
    if (!meta) throw new Error(`Unknown widget at position ${i + 1}.`);
    const size = r!.size as WidgetSize;
    if (!(size in SIZE_SPAN) || !meta.sizes.includes(size)) {
      throw new Error(`${meta.title} does not come in size ${String(r!.size)}.`);
    }
    const out: WidgetRef = { key: meta.key, size };
    if (r!.range !== undefined) {
      if (!(STORED_RANGE_KEYS as readonly string[]).includes(r!.range as string) || meta.rangeMode !== "tab") {
        throw new Error(`${meta.title} cannot use range ${String(r!.range)}.`);
      }
      out.range = r!.range as StoredRangeKey;
    }
    return out;
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/lib/dashboard/catalog.test.ts`
Expected: `catalog.test.ts: ok`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/types.ts src/lib/dashboard/catalog.ts src/lib/dashboard/catalog.test.ts
git commit -m "feat(dashboard): widget catalog and layout validation"
```

---

### Task 3: Presets and visibility rules

**Files:**
- Create: `src/lib/dashboard/presets.ts`, `src/lib/dashboard/visibility.ts`
- Test: `src/lib/dashboard/presets.test.ts`, `src/lib/dashboard/visibility.test.ts`

**Interfaces:**
- Consumes: `CATALOG`, `CATALOG_BY_KEY`, `validateLayout` (Task 2); `WidgetMeta`, `WidgetRef`, `Venue` (Task 2).
- Produces:
  - `presets.ts`: `interface Preset { key: string; name: string; description: string; icon: PresetIcon; widgets: Record<Venue, WidgetRef[]> }`, `type PresetIcon = "LayoutDashboard" | "TrendingUp" | "Megaphone" | "Mail" | "MessagesSquare" | "CalendarCheck" | "Dumbbell" | "Wallet" | "Images" | "Globe" | "Binoculars" | "Cpu"`, `PRESETS: Preset[]`, `PRESET_BY_KEY: Map<string, Preset>`, `presetWidgets(key: string, venue: Venue): WidgetRef[] | null`, `OVERVIEW_PRESET_KEY = "overview"`
  - `visibility.ts`: `type VisibilityOverrides = Record<string, boolean>`, `staffCanSeeByDefault(meta: WidgetMeta): boolean`, `canSee(meta: WidgetMeta, role: "admin" | "staff", overrides: VisibilityOverrides): boolean`, `visibleRefs(refs: WidgetRef[], opts: { venue: Venue; role: "admin" | "staff"; overrides: VisibilityOverrides }): WidgetRef[]`, `appliesToVenue(meta: WidgetMeta, venue: Venue): boolean`

- [ ] **Step 1: Write the failing tests**

`src/lib/dashboard/presets.test.ts`:

```ts
// Run: npm test -- src/lib/dashboard/presets.test.ts
//
// Every preset must be a valid layout for each venue: known keys, allowed
// sizes, and no widget that does not apply to that venue. Pure.
import assert from "node:assert/strict";
import { CATALOG_BY_KEY, validateLayout } from "./catalog";
import { OVERVIEW_PRESET_KEY, PRESETS, presetWidgets } from "./presets";

const keys = new Set<string>();
for (const p of PRESETS) {
  assert.ok(!keys.has(p.key), `${p.key} unique`);
  keys.add(p.key);
  for (const venue of ["clinic", "gym"] as const) {
    const refs = p.widgets[venue];
    assert.ok(refs.length > 0, `${p.key}/${venue} has widgets`);
    assert.doesNotThrow(() => validateLayout(refs), `${p.key}/${venue} validates`);
    for (const r of refs) {
      const meta = CATALOG_BY_KEY.get(r.key)!;
      assert.ok(meta.venues.includes(venue), `${p.key}/${venue}: ${r.key} applies to ${venue}`);
    }
  }
}
assert.ok(keys.has(OVERVIEW_PRESET_KEY), "overview preset exists");
assert.equal(presetWidgets("nope", "clinic"), null);

const clinic = presetWidgets("overview", "clinic")!;
assert.deepEqual(
  clinic.map((r) => r.key),
  [
    "overview.todaysBookings",
    "overview.todaysEarnings",
    "overview.newLeads",
    "overview.unreadMessages",
    "overview.needsAttention",
    "overview.todaysSchedule",
    "overview.recentActivity",
    "overview.revenueTrend",
    "overview.pipelineSnapshot",
    "overview.upcomingPosts",
  ],
);
// presetWidgets returns a copy: mutating it must not change the preset.
clinic[0].size = "M";
assert.equal(presetWidgets("overview", "clinic")![0].size, "S");

console.log("presets.test.ts: ok");
```

`src/lib/dashboard/visibility.test.ts`:

```ts
// Run: npm test -- src/lib/dashboard/visibility.test.ts
//
// Staff visibility: financial/spend widgets default to hidden from staff,
// an admin override wins, admins always see everything, and visibleRefs
// drops unknown keys and other-venue widgets before anything loads. Pure.
import assert from "node:assert/strict";
import { CATALOG_BY_KEY } from "./catalog";
import { canSee, staffCanSeeByDefault, visibleRefs } from "./visibility";

const leads = CATALOG_BY_KEY.get("overview.newLeads")!;
const revenue = CATALOG_BY_KEY.get("overview.revenueTrend")!;

assert.equal(staffCanSeeByDefault(leads), true);
assert.equal(staffCanSeeByDefault(revenue), false);

assert.equal(canSee(revenue, "staff", {}), false);
assert.equal(canSee(revenue, "staff", { "overview.revenueTrend": true }), true);
assert.equal(canSee(leads, "staff", { "overview.newLeads": false }), false);
assert.equal(canSee(revenue, "admin", { "overview.revenueTrend": false }), true, "admins always see");

const refs = [
  { key: "overview.newLeads", size: "S" as const },
  { key: "overview.revenueTrend", size: "XL" as const },
  { key: "overview.activeMembers", size: "S" as const }, // gym-only
  { key: "removed.widget", size: "S" as const },
];
assert.deepEqual(
  visibleRefs(refs, { venue: "clinic", role: "staff", overrides: {} }).map((r) => r.key),
  ["overview.newLeads"],
);
assert.deepEqual(
  visibleRefs(refs, { venue: "clinic", role: "admin", overrides: {} }).map((r) => r.key),
  ["overview.newLeads", "overview.revenueTrend"],
);

console.log("visibility.test.ts: ok");
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/dashboard/presets.test.ts` and `npm test -- src/lib/dashboard/visibility.test.ts`
Expected: both FAIL, module not found.

- [ ] **Step 3: Write `presets.ts`**

```ts
/**
 * Dashboard presets: named starting layouts a user adds as a tab. Plain
 * data, one layout per venue. Slice 1 ships Overview only; slices 3 and 4
 * append the domain presets here.
 *
 * Pure: no DB, no server imports.
 */
import type { Venue, WidgetRef } from "./types";

export type PresetIcon =
  | "LayoutDashboard"
  | "TrendingUp"
  | "Megaphone"
  | "Mail"
  | "MessagesSquare"
  | "CalendarCheck"
  | "Dumbbell"
  | "Wallet"
  | "Images"
  | "Globe"
  | "Binoculars"
  | "Cpu";

export interface Preset {
  key: string;
  name: string;
  description: string;
  icon: PresetIcon;
  widgets: Record<Venue, WidgetRef[]>;
}

export const OVERVIEW_PRESET_KEY = "overview";

export const PRESETS: Preset[] = [
  {
    key: OVERVIEW_PRESET_KEY,
    name: "Overview",
    description: "Today at a glance: bookings, leads, messages, revenue and what needs attention.",
    icon: "LayoutDashboard",
    widgets: {
      clinic: [
        { key: "overview.todaysBookings", size: "S" },
        { key: "overview.todaysEarnings", size: "S" },
        { key: "overview.newLeads", size: "S" },
        { key: "overview.unreadMessages", size: "S" },
        { key: "overview.needsAttention", size: "XL" },
        { key: "overview.todaysSchedule", size: "L" },
        { key: "overview.recentActivity", size: "S" },
        { key: "overview.revenueTrend", size: "XL" },
        { key: "overview.pipelineSnapshot", size: "M" },
        { key: "overview.upcomingPosts", size: "M" },
      ],
      gym: [
        { key: "overview.activeMembers", size: "S" },
        { key: "overview.mrr", size: "S" },
        { key: "overview.attendance", size: "S" },
        { key: "overview.newLeads", size: "S" },
        { key: "overview.needsAttention", size: "XL" },
        { key: "overview.todaysClasses", size: "L" },
        { key: "overview.recentActivity", size: "S" },
        { key: "overview.revenueTrend", size: "XL" },
        { key: "overview.pipelineSnapshot", size: "M" },
        { key: "overview.upcomingPosts", size: "M" },
      ],
    },
  },
];

export const PRESET_BY_KEY: Map<string, Preset> = new Map(PRESETS.map((p) => [p.key, p]));

/** A fresh copy of a preset's layout for a venue, or null for an unknown preset. */
export function presetWidgets(key: string, venue: Venue): WidgetRef[] | null {
  const p = PRESET_BY_KEY.get(key);
  return p ? p.widgets[venue].map((r) => ({ ...r })) : null;
}
```

- [ ] **Step 4: Write `visibility.ts`**

```ts
/**
 * Who may see which dashboard widget. Admins see everything. Staff see a
 * widget when the admin's override says so, else by sensitivity: general
 * widgets visible, financial and spend widgets hidden.
 *
 * `visibleRefs` is the server-side gate the page runs BEFORE any widget
 * loads, so hidden data never leaves the server. Pure.
 */
import { CATALOG_BY_KEY } from "./catalog";
import type { Venue, WidgetMeta, WidgetRef } from "./types";

export type VisibilityOverrides = Record<string, boolean>;

export function staffCanSeeByDefault(meta: WidgetMeta): boolean {
  return meta.sensitivity === "general";
}

export function canSee(meta: WidgetMeta, role: "admin" | "staff", overrides: VisibilityOverrides): boolean {
  if (role === "admin") return true;
  const o = overrides[meta.key];
  return typeof o === "boolean" ? o : staffCanSeeByDefault(meta);
}

export function appliesToVenue(meta: WidgetMeta, venue: Venue): boolean {
  return meta.venues.includes(venue);
}

export function visibleRefs(
  refs: WidgetRef[],
  opts: { venue: Venue; role: "admin" | "staff"; overrides: VisibilityOverrides },
): WidgetRef[] {
  return refs.filter((r) => {
    const meta = CATALOG_BY_KEY.get(r.key);
    return !!meta && appliesToVenue(meta, opts.venue) && canSee(meta, opts.role, opts.overrides);
  });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- src/lib/dashboard/presets.test.ts` then `npm test -- src/lib/dashboard/visibility.test.ts`
Expected: both print `ok`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/dashboard/presets.ts src/lib/dashboard/visibility.ts src/lib/dashboard/presets.test.ts src/lib/dashboard/visibility.test.ts
git commit -m "feat(dashboard): overview preset and staff visibility rules"
```

---

### Task 4: `dashboards` table and tab storage

**Files:**
- Modify: `src/lib/db/schema.ts` (append the `dashboards` table at the end of the file)
- Modify: `src/lib/db/tenant.ts` (inside `ensureTenantTables`, append to the last big `sqlite.exec(` template string, before its closing backtick)
- Create: `src/lib/dashboard/tabs.ts`
- Test: `src/lib/dashboard/tabs.test.ts`

**Interfaces:**
- Consumes: `presetWidgets`, `OVERVIEW_PRESET_KEY`, `PRESET_BY_KEY` (Task 3); `validateLayout`, `MAX_TABS_PER_USER` (Task 2); `STORED_RANGE_KEYS`, `StoredRangeKey` (Task 1).
- Produces (all synchronous; all scoped to the ambient tenant `db`):
  - `interface DashboardTab { name: string; presetKey: string | null; range: StoredRangeKey; widgets: WidgetRef[] }`
  - `type TabSource = "own" | "team" | "platform"`
  - `resolveTabs(userId: number, venue: Venue): { tabs: DashboardTab[]; source: TabSource }` (never writes)
  - `saveTabWidgets(userId, venue, index: number, widgets: unknown): void`
  - `setTabRange(userId, venue, index: number, range: string): void`
  - `addTab(userId, venue, input: { kind: "preset"; presetKey: string } | { kind: "blank" } | { kind: "duplicate"; index: number }): number` (returns the new tab index)
  - `renameTab(userId, venue, index: number, name: string): void`
  - `deleteTab(userId, venue, index: number): void`
  - `moveTab(userId, venue, from: number, to: number): void`
  - `resetTab(userId, venue, index: number): void`
  - `makeTeamDefault(userId, venue): void`
  - `clearTeamDefault(): void`

- [ ] **Step 1: Add the table**

Append to `src/lib/db/schema.ts`:

```ts
/**
 * Dashboard tabs. One row per tab. `user_id` is the control-plane users.id
 * of the owner, or NULL for the tenant's team default set. `widgets` is a
 * JSON WidgetRef[] (lib/dashboard/types.ts), validated on every write.
 */
export const dashboards = sqliteTable(
  "dashboards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id"),
    name: text("name").notNull(),
    presetKey: text("preset_key"),
    position: integer("position").notNull(),
    range: text("range").notNull().default("30d"),
    widgets: text("widgets").notNull().default("[]"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    byUser: index("idx_dashboards_user").on(t.userId, t.position),
  }),
);
export type DashboardRow = typeof dashboards.$inferSelect;
```

(`sql`, `index`, `sqliteTable`, `integer`, `text` are already imported at the top of `schema.ts`.)

Append inside the last `sqlite.exec(\`...\`)` block of `ensureTenantTables` in `src/lib/db/tenant.ts`:

```sql
    CREATE TABLE IF NOT EXISTS dashboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      name TEXT NOT NULL,
      preset_key TEXT,
      position INTEGER NOT NULL,
      range TEXT NOT NULL DEFAULT '30d',
      widgets TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS idx_dashboards_user ON dashboards(user_id, position);
```

- [ ] **Step 2: Write the failing test**

`src/lib/dashboard/tabs.test.ts` (scratch tenant, same shim as `src/lib/research/store.test.ts`):

```ts
// Run: npm test -- src/lib/dashboard/tabs.test.ts
//
// Tab storage against a real scratch tenant DB. The properties:
//   1. resolution order: own rows > team default rows > platform Overview;
//   2. resolveTabs never writes (viewing is free);
//   3. the first edit copies the resolved set into the user's own rows;
//   4. add (preset/blank/duplicate), rename, move, delete (never the last),
//      range, reset, and the tab cap;
//   5. makeTeamDefault replaces the team set; other users then start from it.
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
  if (request === "next/navigation") {
    return {
      redirect: () => {
        throw new Error("next/navigation.redirect() stub called unexpectedly in tabs.test.ts");
      },
    };
  }
  return realLoad.call(this, request, ...rest);
};

const requireLocal = createRequire(import.meta.url);

(async () => {
  const { controlSqlite } = requireLocal("../db/control") as typeof import("../db/control");
  const { runWithTenant, getTenantDbById } = requireLocal("../db/tenant") as typeof import("../db/tenant");
  const { schema } = requireLocal("../db") as typeof import("../db");
  const tabs = requireLocal("./tabs") as typeof import("./tabs");
  const { MAX_TABS_PER_USER } = requireLocal("./catalog") as typeof import("./catalog");

  const slug = "dashboard-tabs-test";
  const dbFile = `tenants/${slug}/${slug}.db`;
  controlSqlite.prepare("DELETE FROM tenants WHERE slug = ?").run(slug);
  const t = controlSqlite
    .prepare("INSERT INTO tenants (slug, name, db_file, is_active) VALUES (?, ?, ?, 1) RETURNING id")
    .get(slug, "Dashboard Tabs Test", dbFile) as { id: number };
  const tid = t.id;
  const cleanup = () => {
    controlSqlite.prepare("DELETE FROM tenants WHERE id = ?").run(tid);
    try {
      fs.rmSync(path.join(process.cwd(), "data", "tenants", slug), { recursive: true, force: true });
    } catch {
      // best effort
    }
  };
  const rowCount = () => getTenantDbById(tid).select().from(schema.dashboards).all().length;
  const ALICE = 101;
  const BOB = 102;

  try {
    runWithTenant(tid, () => {
      // 1 + 2: platform default, and viewing does not write.
      const first = tabs.resolveTabs(ALICE, "clinic");
      assert.equal(first.source, "platform");
      assert.equal(first.tabs.length, 1);
      assert.equal(first.tabs[0].name, "Overview");
      assert.equal(first.tabs[0].presetKey, "overview");
      assert.equal(first.tabs[0].widgets[0].key, "overview.todaysBookings");
      assert.equal(rowCount(), 0, "resolveTabs never writes");

      // 3: first edit materialises the user's own rows.
      tabs.saveTabWidgets(ALICE, "clinic", 0, [{ key: "overview.newLeads", size: "M" }]);
      const own = tabs.resolveTabs(ALICE, "clinic");
      assert.equal(own.source, "own");
      assert.deepEqual(own.tabs[0].widgets, [{ key: "overview.newLeads", size: "M" }]);
      assert.throws(() => tabs.saveTabWidgets(ALICE, "clinic", 0, [{ key: "x.y", size: "S" }]), /Unknown widget/);

      // 4: add, rename, move, range, delete, reset.
      const blank = tabs.addTab(ALICE, "clinic", { kind: "blank" });
      assert.equal(blank, 1);
      tabs.renameTab(ALICE, "clinic", 1, "  Mine  ");
      const dup = tabs.addTab(ALICE, "clinic", { kind: "duplicate", index: 0 });
      assert.equal(dup, 2);
      let names = tabs.resolveTabs(ALICE, "clinic").tabs.map((x) => x.name);
      assert.deepEqual(names, ["Overview", "Mine", "Overview copy"]);
      tabs.moveTab(ALICE, "clinic", 2, 0);
      names = tabs.resolveTabs(ALICE, "clinic").tabs.map((x) => x.name);
      assert.deepEqual(names, ["Overview copy", "Overview", "Mine"]);
      tabs.setTabRange(ALICE, "clinic", 0, "90d");
      assert.equal(tabs.resolveTabs(ALICE, "clinic").tabs[0].range, "90d");
      assert.throws(() => tabs.setTabRange(ALICE, "clinic", 0, "custom"), /range/);
      tabs.deleteTab(ALICE, "clinic", 2);
      tabs.deleteTab(ALICE, "clinic", 1);
      assert.throws(() => tabs.deleteTab(ALICE, "clinic", 0), /last tab/);
      tabs.resetTab(ALICE, "clinic", 0);
      assert.equal(tabs.resolveTabs(ALICE, "clinic").tabs[0].widgets.length, 10, "reset restores the Overview preset");
      assert.throws(() => tabs.renameTab(ALICE, "clinic", 0, "   "), /name/);
      assert.throws(() => tabs.addTab(ALICE, "clinic", { kind: "preset", presetKey: "nope" }), /preset/);

      // cap
      for (let i = tabs.resolveTabs(ALICE, "clinic").tabs.length; i < MAX_TABS_PER_USER; i++) {
        tabs.addTab(ALICE, "clinic", { kind: "blank" });
      }
      assert.throws(() => tabs.addTab(ALICE, "clinic", { kind: "blank" }), /at most/);

      // 5: team default.
      while (tabs.resolveTabs(ALICE, "clinic").tabs.length > 2) tabs.deleteTab(ALICE, "clinic", 2);
      tabs.makeTeamDefault(ALICE, "clinic");
      const bob = tabs.resolveTabs(BOB, "clinic");
      assert.equal(bob.source, "team");
      assert.equal(bob.tabs.length, 2);
      tabs.renameTab(BOB, "clinic", 1, "Bob's");
      assert.equal(tabs.resolveTabs(BOB, "clinic").source, "own");
      assert.equal(tabs.resolveTabs(ALICE, "clinic").tabs[1].name !== "Bob's", true, "Bob's edit is his own");
      tabs.clearTeamDefault();
      assert.equal(tabs.resolveTabs(9999, "clinic").source, "platform");
    });
    console.log("tabs.test.ts: ok");
  } finally {
    cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/lib/dashboard/tabs.test.ts`
Expected: FAIL, cannot find module `./tabs`.

- [ ] **Step 4: Write `tabs.ts`**

```ts
import "server-only";

import { asc, eq, isNull } from "drizzle-orm";

import { db, schema } from "@/lib/db";
import { MAX_TABS_PER_USER, validateLayout } from "./catalog";
import { OVERVIEW_PRESET_KEY, PRESET_BY_KEY, presetWidgets } from "./presets";
import { STORED_RANGE_KEYS, type StoredRangeKey } from "./range";
import type { Venue, WidgetRef } from "./types";

/**
 * Dashboard tab storage. A user's tabs resolve, in order, from:
 *   1. their own rows (user_id = them);
 *   2. the tenant's team default rows (user_id IS NULL);
 *   3. the platform Overview preset for the venue (in memory).
 * Reading never writes. Every mutation first materialises the resolved set
 * into the user's own rows (`ownRows`), then applies the change, so the
 * first edit is what forks a user off the team default.
 *
 * Tabs are addressed by INDEX (position order), which survives the copy.
 */

export interface DashboardTab {
  name: string;
  presetKey: string | null;
  range: StoredRangeKey;
  widgets: WidgetRef[];
}
export type TabSource = "own" | "team" | "platform";

const T = schema.dashboards;
const MAX_NAME = 40;

function parseWidgets(json: string): WidgetRef[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as WidgetRef[]) : [];
  } catch {
    return [];
  }
}

function asRange(v: string): StoredRangeKey {
  return (STORED_RANGE_KEYS as readonly string[]).includes(v) ? (v as StoredRangeKey) : "30d";
}

function toTab(r: schema.DashboardRow): DashboardTab {
  return { name: r.name, presetKey: r.presetKey, range: asRange(r.range), widgets: parseWidgets(r.widgets) };
}

function rowsFor(userId: number | null) {
  return db
    .select()
    .from(T)
    .where(userId === null ? isNull(T.userId) : eq(T.userId, userId))
    .orderBy(asc(T.position), asc(T.id))
    .all();
}

function platformTabs(venue: Venue): DashboardTab[] {
  const p = PRESET_BY_KEY.get(OVERVIEW_PRESET_KEY)!;
  return [{ name: p.name, presetKey: p.key, range: "30d", widgets: presetWidgets(p.key, venue)! }];
}

export function resolveTabs(userId: number, venue: Venue): { tabs: DashboardTab[]; source: TabSource } {
  const own = rowsFor(userId);
  if (own.length) return { tabs: own.map(toTab), source: "own" };
  const team = rowsFor(null);
  if (team.length) return { tabs: team.map(toTab), source: "team" };
  return { tabs: platformTabs(venue), source: "platform" };
}

function insertTabs(userId: number | null, list: DashboardTab[]): void {
  list.forEach((tab, i) => {
    db.insert(T)
      .values({
        userId,
        name: tab.name,
        presetKey: tab.presetKey,
        position: i,
        range: tab.range,
        widgets: JSON.stringify(tab.widgets),
      })
      .run();
  });
}

/** The user's own rows, copying the resolved set in first if they have none. */
function ownRows(userId: number, venue: Venue): schema.DashboardRow[] {
  const own = rowsFor(userId);
  if (own.length) return own;
  insertTabs(userId, resolveTabs(userId, venue).tabs);
  return rowsFor(userId);
}

function rowAt(userId: number, venue: Venue, index: number): schema.DashboardRow {
  const rows = ownRows(userId, venue);
  const row = rows[index];
  if (!row) throw new Error("That tab no longer exists.");
  return row;
}

function touch(id: number, patch: Partial<typeof T.$inferInsert>): void {
  db.update(T).set({ ...patch, updatedAt: new Date() }).where(eq(T.id, id)).run();
}

function renumber(rows: schema.DashboardRow[]): void {
  rows.forEach((r, i) => {
    if (r.position !== i) db.update(T).set({ position: i }).where(eq(T.id, r.id)).run();
  });
}

function cleanName(name: string): string {
  const n = name.trim().slice(0, MAX_NAME);
  if (!n) throw new Error("A tab needs a name.");
  return n;
}

export function saveTabWidgets(userId: number, venue: Venue, index: number, widgets: unknown): void {
  const clean = validateLayout(widgets);
  db.transaction(() => {
    const row = rowAt(userId, venue, index);
    touch(row.id, { widgets: JSON.stringify(clean) });
  });
}

export function setTabRange(userId: number, venue: Venue, index: number, range: string): void {
  if (!(STORED_RANGE_KEYS as readonly string[]).includes(range)) throw new Error(`Unsupported range ${range}.`);
  db.transaction(() => {
    const row = rowAt(userId, venue, index);
    touch(row.id, { range });
  });
}

export function addTab(
  userId: number,
  venue: Venue,
  input: { kind: "preset"; presetKey: string } | { kind: "blank" } | { kind: "duplicate"; index: number },
): number {
  return db.transaction(() => {
    const rows = ownRows(userId, venue);
    if (rows.length >= MAX_TABS_PER_USER) throw new Error(`You can have at most ${MAX_TABS_PER_USER} tabs.`);
    let tab: DashboardTab;
    if (input.kind === "preset") {
      const p = PRESET_BY_KEY.get(input.presetKey);
      if (!p) throw new Error("Unknown preset.");
      tab = { name: p.name, presetKey: p.key, range: "30d", widgets: presetWidgets(p.key, venue)! };
    } else if (input.kind === "duplicate") {
      const src = rows[input.index];
      if (!src) throw new Error("That tab no longer exists.");
      tab = { ...toTab(src), name: `${src.name} copy`.slice(0, MAX_NAME) };
    } else {
      tab = { name: "New tab", presetKey: null, range: "30d", widgets: [] };
    }
    db.insert(T)
      .values({
        userId,
        name: tab.name,
        presetKey: tab.presetKey,
        position: rows.length,
        range: tab.range,
        widgets: JSON.stringify(tab.widgets),
      })
      .run();
    return rows.length;
  });
}

export function renameTab(userId: number, venue: Venue, index: number, name: string): void {
  const clean = cleanName(name);
  db.transaction(() => {
    const row = rowAt(userId, venue, index);
    touch(row.id, { name: clean });
  });
}

export function deleteTab(userId: number, venue: Venue, index: number): void {
  db.transaction(() => {
    const rows = ownRows(userId, venue);
    if (rows.length <= 1) throw new Error("You can't delete your last tab.");
    const row = rows[index];
    if (!row) throw new Error("That tab no longer exists.");
    db.delete(T).where(eq(T.id, row.id)).run();
    renumber(rows.filter((r) => r.id !== row.id));
  });
}

export function moveTab(userId: number, venue: Venue, from: number, to: number): void {
  db.transaction(() => {
    const rows = ownRows(userId, venue);
    if (!rows[from] || to < 0 || to >= rows.length) throw new Error("That tab no longer exists.");
    const next = [...rows];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    renumber(next);
  });
}

export function resetTab(userId: number, venue: Venue, index: number): void {
  db.transaction(() => {
    const row = rowAt(userId, venue, index);
    let widgets: WidgetRef[] | null = null;
    if (row.presetKey === OVERVIEW_PRESET_KEY) {
      const teamOverview = rowsFor(null).find((r) => r.presetKey === OVERVIEW_PRESET_KEY);
      if (teamOverview) widgets = parseWidgets(teamOverview.widgets);
    }
    if (!widgets && row.presetKey) widgets = presetWidgets(row.presetKey, venue);
    touch(row.id, { widgets: JSON.stringify(widgets ?? []) });
  });
}

/** Replace the team default set with copies of this user's current tabs. */
export function makeTeamDefault(userId: number, venue: Venue): void {
  db.transaction(() => {
    const mine = ownRows(userId, venue).map(toTab);
    db.delete(T).where(isNull(T.userId)).run();
    insertTabs(null, mine);
  });
}

export function clearTeamDefault(): void {
  db.delete(T).where(isNull(T.userId)).run();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/lib/dashboard/tabs.test.ts`
Expected: `tabs.test.ts: ok`.

If `db.transaction(() => ...)` on the ambient proxy is not supported (it is used elsewhere: check with `grep -rn "db.transaction(" src/lib | head -3`), fall back to the pattern those files use.

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/tenant.ts src/lib/dashboard/tabs.ts src/lib/dashboard/tabs.test.ts
git commit -m "feat(dashboard): per-user tab storage with team and platform defaults"
```

---

### Task 5: Visibility store and the Overview widget implementations

**Files:**
- Create: `src/lib/dashboard/visibilityStore.ts`
- Create: `src/components/dashboard/views/KpiTile.tsx`, `RowList.tsx`, `StageBars.tsx`, `TodaysScheduleView.tsx`, `TodaysClassesView.tsx`
- Create: `src/lib/dashboard/widgets/overview.tsx`, `src/lib/dashboard/widgets/index.ts`
- Test: `src/lib/dashboard/widgets/overview.test.ts`

**Interfaces:**
- Consumes: `readKey`, `setKey` from `@/lib/settings`; `dashboardKpis`, `listAppointmentsForDate`, `recentActivity`, `revenueSeries`, `getTherapyMap` from `@/lib/queries`; `getGymDashboard`, `getNeedsAttention` from `@/lib/dashboard` (the existing FILE `src/lib/dashboard.ts`; import it as `@/lib/dashboard` and note the new FOLDER is `@/lib/dashboard/...` — both resolve because the file and the folder coexist, the bare specifier picks the file); `defaultPipelineId` from `@/lib/pipeline/pipelineRepo`; `deltaPct` (Task 1); types (Task 2).
- Produces:
  - `visibilityStore.ts`: `VISIBILITY_KEY = "dashboard_widget_visibility"`, `getVisibilityOverrides(): VisibilityOverrides`, `setWidgetVisibility(key: string, visible: boolean | null): void` (null removes the override), `setSensitivityVisibility(sensitivities: Sensitivity[], visible: boolean): void`
  - `widgets/overview.tsx`: `OVERVIEW_WIDGETS`, `fillDays(rows, fromIso, days)` (pure helper, exported for test)
  - `widgets/index.ts`: `WIDGET_IMPLS: Record<WidgetKey, WidgetImpl<any>>`, `cached<T>(ctx, key, fn): Promise<T>`

Before writing code, confirm the import collision: run `ls src/lib/dashboard.ts src/lib/dashboard/`. If `@/lib/dashboard` resolves to the folder (no `index.ts`) rather than the file in either `tsc` or tsx, RENAME the existing file to `src/lib/dashboard/legacy.ts` with `git mv src/lib/dashboard.ts src/lib/dashboard/legacy.ts` and update its importers (`grep -rln '@/lib/dashboard"' src`), then import from `@/lib/dashboard/legacy` below. Do this check first; it decides the import path for this whole task.

- [ ] **Step 1: Write the failing test (pure helper only)**

`src/lib/dashboard/widgets/overview.test.ts`:

```ts
// Run: npm test -- src/lib/dashboard/widgets/overview.test.ts
//
// fillDays: revenue rows only exist for days that had revenue; the chart
// needs every day in the window, zero-filled, in order.
import assert from "node:assert/strict";
import Module from "node:module";
import { createRequire } from "node:module";

type Loader = (request: string, ...rest: unknown[]) => unknown;
const mod = Module as unknown as { _load: Loader };
const realLoad = mod._load;
mod._load = function (this: unknown, request: string, ...rest: unknown[]) {
  if (request === "react") return { cache: (fn: unknown) => fn, createElement: () => null };
  if (request === "next/navigation") return { redirect: () => { throw new Error("redirect stub"); } };
  return realLoad.call(this, request, ...rest);
};
const requireLocal = createRequire(import.meta.url);
const { fillDays } = requireLocal("./overview") as typeof import("./overview");

const out = fillDays([{ day: "2026-09-02", total: 50 }], "2026-09-01", 3);
assert.deepEqual(out, [
  { day: "2026-09-01", total: 0 },
  { day: "2026-09-02", total: 50 },
  { day: "2026-09-03", total: 0 },
]);
assert.deepEqual(fillDays([], "2026-09-30", 2).map((d) => d.day), ["2026-09-30", "2026-10-01"]);

console.log("overview.test.ts: ok");
```

If requiring `./overview` under the test runner fails because of a JSX/runtime import, move `fillDays` into `src/lib/dashboard/series.ts` (pure, no imports) and require that instead; keep the test identical otherwise.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/dashboard/widgets/overview.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `visibilityStore.ts`**

```ts
import "server-only";

import { readKey, setKey } from "@/lib/settings";
import { CATALOG } from "./catalog";
import type { Sensitivity, WidgetMeta } from "./types";
import type { VisibilityOverrides } from "./visibility";

/** Tenant settings key holding `{ [widgetKey]: staffCanSee }`. */
export const VISIBILITY_KEY = "dashboard_widget_visibility";

export function getVisibilityOverrides(): VisibilityOverrides {
  const v = readKey<unknown>(VISIBILITY_KEY, {});
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: VisibilityOverrides = {};
  for (const [k, b] of Object.entries(v as Record<string, unknown>)) if (typeof b === "boolean") out[k] = b;
  return out;
}

export function setWidgetVisibility(key: string, visible: boolean | null): void {
  const next = { ...getVisibilityOverrides() };
  if (visible === null) delete next[key];
  else next[key] = visible;
  setKey(VISIBILITY_KEY, next);
}

export function setSensitivityVisibility(sensitivities: Sensitivity[], visible: boolean): void {
  const next = { ...getVisibilityOverrides() };
  for (const m of CATALOG as readonly WidgetMeta[]) {
    if (sensitivities.includes(m.sensitivity)) next[m.key] = visible;
  }
  setKey(VISIBILITY_KEY, next);
}
```

Check `setKey`'s signature first (`grep -n "export function setKey" src/lib/settings.ts`). If it takes a pre-serialised string, pass `JSON.stringify(next)`.

- [ ] **Step 4: Write the shared views**

`src/components/dashboard/views/KpiTile.tsx`:

```tsx
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { CardValue } from "@/components/ui/Card";

export function KpiTile({
  value,
  sub,
  delta,
  accent,
}: {
  value: string;
  sub?: string;
  /** Percentage change vs the previous period; null hides the chip. */
  delta?: number | null;
  accent?: boolean;
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <>
      <CardValue style={{ color: accent ? "var(--accent)" : undefined }}>{value}</CardValue>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        {delta != null && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              fontSize: 12,
              fontWeight: 600,
              color: up ? "#22c55e" : "#ef4444",
            }}
          >
            {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(delta)}%
          </span>
        )}
        {sub && <span style={{ color: "var(--text-tertiary)", fontSize: 12 }}>{sub}</span>}
      </div>
    </>
  );
}
```

`src/components/dashboard/views/RowList.tsx`:

```tsx
import Link from "next/link";

export interface Row {
  id: string | number;
  primary: string;
  secondary?: string;
  meta?: string;
  href?: string;
}

export function RowList({ rows, empty }: { rows: Row[]; empty: string }) {
  if (rows.length === 0) {
    return <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{empty}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {rows.map((r) => {
        const body = (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--text-secondary)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis" }}>
                {r.primary}
              </div>
              {r.secondary && <div style={{ color: "var(--text-tertiary)", fontSize: 12, marginTop: 2 }}>{r.secondary}</div>}
            </div>
            {r.meta && <div style={{ color: "var(--text-tertiary)", fontSize: 11, whiteSpace: "nowrap" }}>{r.meta}</div>}
          </div>
        );
        return r.href ? (
          <Link key={r.id} href={r.href}>
            {body}
          </Link>
        ) : (
          <div key={r.id}>{body}</div>
        );
      })}
    </div>
  );
}
```

`src/components/dashboard/views/StageBars.tsx`:

```tsx
export function StageBars({ stages, empty }: { stages: { id: number; name: string; count: number }[]; empty: string }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  if (stages.every((s) => s.count === 0)) {
    return <div style={{ padding: "16px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{empty}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {stages.map((s) => (
        <div key={s.id} style={{ display: "grid", gridTemplateColumns: "minmax(80px, 34%) 1fr 32px", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {s.name}
          </div>
          <div style={{ height: 6, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${(s.count / max) * 100}%`, height: "100%", background: "var(--accent)" }} />
          </div>
          <div style={{ fontSize: 12.5, color: "var(--text-primary)", textAlign: "right", fontWeight: 600 }}>{s.count}</div>
        </div>
      ))}
    </div>
  );
}
```

`src/components/dashboard/views/TodaysScheduleView.tsx` — move the clinic "Today's schedule" list body from the current `src/app/dashboard/page.tsx` (the `todays.length === 0 ? ... : ...` block) into this component unchanged in markup:

```tsx
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatTime } from "@/lib/utils";

export interface ScheduleItem {
  id: number;
  startTime: string;
  status: string;
  clientName: string;
  therapies: { id: number; name: string; colourHex: string }[];
}

export function TodaysScheduleView({ items, empty }: { items: ScheduleItem[]; empty: string }) {
  if (items.length === 0) {
    return <div style={{ padding: "24px 0", color: "var(--text-tertiary)", fontSize: 14 }}>{empty}</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((a) => (
        <Link
          key={a.id}
          href={`/appointments/${a.id}`}
          style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)" }}
        >
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, color: "var(--text-primary)", minWidth: 70 }}>{formatTime(a.startTime)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>{a.clientName}</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
              {a.therapies.map((t) => (
                <Badge key={t.id} colour={t.colourHex}>
                  {t.name}
                </Badge>
              ))}
            </div>
          </div>
          <StatusBadge status={a.status as Parameters<typeof StatusBadge>[0]["status"]} />
        </Link>
      ))}
    </div>
  );
}
```

`src/components/dashboard/views/TodaysClassesView.tsx` — same move for the gym "Today's classes" block:

```tsx
import Link from "next/link";
import type { TodayClass } from "@/lib/dashboard";
import { formatTime } from "@/lib/utils";

export function TodaysClassesView({ classes }: { classes: TodayClass[] }) {
  if (classes.length === 0) {
    return <div style={{ padding: "24px 0", color: "var(--text-tertiary)", fontSize: 14 }}>No classes scheduled today.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {classes.map((c) => {
        const full = c.booked >= c.capacity;
        const pct = c.capacity > 0 ? Math.min(100, Math.round((c.booked / c.capacity) * 100)) : 0;
        return (
          <Link
            key={c.id}
            href="/timetable"
            style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px", borderRadius: "var(--radius)", border: "1px solid var(--hairline)" }}
          >
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 16, color: "var(--text-primary)", minWidth: 62 }}>{formatTime(c.time)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>{c.name}</div>
              <div style={{ marginTop: 6, height: 5, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ width: `${pct}%`, height: "100%", background: full ? "#22c55e" : "var(--accent)" }} />
              </div>
              {c.instructor && <div style={{ fontSize: 11.5, color: "var(--text-tertiary)", marginTop: 4 }}>{c.instructor}</div>}
            </div>
            <div style={{ fontSize: 13, color: full ? "#22c55e" : "var(--text-secondary)", fontWeight: 600, whiteSpace: "nowrap" }}>
              {c.booked}/{c.capacity}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
```

(Use the import path for `TodayClass` decided in the collision check above.)

- [ ] **Step 5: Write `widgets/index.ts` cache helper first (overview imports it)**

```ts
import "server-only";

import type { WidgetKey } from "../catalog";
import type { WidgetCtx, WidgetImpl } from "../types";
import { OVERVIEW_WIDGETS } from "./overview";

/** Memoise a base query across every widget rendered in one request. */
export function cached<T>(ctx: WidgetCtx, key: string, fn: () => T | Promise<T>): Promise<T> {
  let p = ctx.cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = Promise.resolve().then(fn);
    ctx.cache.set(key, p);
  }
  return p;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const WIDGET_IMPLS = {
  ...OVERVIEW_WIDGETS,
} satisfies Record<WidgetKey, WidgetImpl<any>>;
```

To avoid a circular import (`overview.tsx` needs `cached`, `index.ts` imports `overview.tsx`), put `cached` in `src/lib/dashboard/widgets/cache.ts` instead and import it from there in both files:

```ts
// src/lib/dashboard/widgets/cache.ts
import type { WidgetCtx } from "../types";

/** Memoise a base query across every widget rendered in one request. */
export function cached<T>(ctx: WidgetCtx, key: string, fn: () => T | Promise<T>): Promise<T> {
  let p = ctx.cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = Promise.resolve().then(fn);
    ctx.cache.set(key, p);
  }
  return p;
}
```

and drop the `cached` function body from `index.ts` (keep only `WIDGET_IMPLS`).

- [ ] **Step 6: Write `widgets/overview.tsx`**

```tsx
import "server-only";

import { and, asc, eq, gte, lt, sql } from "drizzle-orm";

import { RevenueBars } from "@/components/charts/RevenueBars";
import { NeedsAttention } from "@/components/dashboard/NeedsAttention";
import { KpiTile } from "@/components/dashboard/views/KpiTile";
import { RowList } from "@/components/dashboard/views/RowList";
import { StageBars } from "@/components/dashboard/views/StageBars";
import { TodaysClassesView } from "@/components/dashboard/views/TodaysClassesView";
import { TodaysScheduleView } from "@/components/dashboard/views/TodaysScheduleView";
import { getGymDashboard, getNeedsAttention } from "@/lib/dashboard";
import { db, schema } from "@/lib/db";
import { defaultPipelineId } from "@/lib/pipeline/pipelineRepo";
import {
  dashboardKpis,
  getTherapyMap,
  listAppointmentsForDate,
  recentActivity,
  revenueSeries,
} from "@/lib/queries";
import { formatEur, relativeTime } from "@/lib/utils";
import type { OverviewKey } from "./keys";
import { cached } from "./cache";
import { deltaPct } from "../range";
import type { WidgetCtx, WidgetImpl } from "../types";

const DAY = 86_400_000;

/** Zero-fill a sparse day series across `days` days starting at `fromIso`. */
export function fillDays(rows: { day: string; total: number }[], fromIso: string, days: number) {
  const map = new Map(rows.map((r) => [r.day, Number(r.total) || 0]));
  const start = Date.parse(`${fromIso}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(start + i * DAY).toISOString().slice(0, 10);
    return { day, total: map.get(day) ?? 0 };
  });
}

const kpis = (ctx: WidgetCtx) => cached(ctx, "dashboardKpis", dashboardKpis);
const gym = (ctx: WidgetCtx) => cached(ctx, "gymDashboard", getGymDashboard);

function countLeads(fromMs: number, toMs: number): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.leads)
    .where(and(gte(schema.leads.createdAt, new Date(fromMs)), lt(schema.leads.createdAt, new Date(toMs))))
    .get();
  return Number(row?.n ?? 0);
}

type Kpi = { value: string; sub?: string; delta?: number | null; accent?: boolean };
const kpi = (d: Kpi) => <KpiTile value={d.value} sub={d.sub} delta={d.delta} accent={d.accent} />;

export const OVERVIEW_WIDGETS = {
  "overview.todaysBookings": {
    label: (ctx) => `Today's ${ctx.vocab.bookings.toLowerCase()}`,
    href: "/appointments",
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: String(k.todaysCount), sub: `${k.confirmed} confirmed, ${k.pending} pending` };
    },
    render: kpi,
  },
  "overview.todaysEarnings": {
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: formatEur(k.todaysEarnings), sub: "From sessions completed today" };
    },
    render: kpi,
  },
  "overview.cashToday": {
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: formatEur(k.todaysCash), sub: "Payments recorded today" };
    },
    render: kpi,
  },
  "overview.deferredRevenue": {
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: formatEur(k.deferredRevenue), sub: "Unused credits and open vouchers" };
    },
    render: kpi,
  },
  "overview.activeClients": {
    label: (ctx) => `Active ${ctx.vocab.members.toLowerCase()}`,
    href: "/clients",
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: String(k.activeClients), sub: "Visited in the last 90 days" };
    },
    render: kpi,
  },
  "overview.plansExpiring": {
    label: (ctx) => `${ctx.vocab.plans} expiring`,
    href: "/packages",
    async load(ctx) {
      const k = await kpis(ctx);
      return { value: String(k.expiringSoon), sub: "In the next 30 days", accent: k.expiringSoon > 0 };
    },
    render: kpi,
  },
  "overview.todaysSchedule": {
    label: (ctx) => `Today's ${ctx.vocab.bookings.toLowerCase()}`,
    href: "/appointments/new",
    async load(ctx) {
      const today = ctx.now.toISOString().slice(0, 10);
      const [todays, therapyMap] = await Promise.all([listAppointmentsForDate(today), getTherapyMap()]);
      const ids = [...new Set(todays.map((a) => a.clientId))];
      const clients = new Map(
        ids.length
          ? db
              .select({ id: schema.clients.id, firstName: schema.clients.firstName, lastName: schema.clients.lastName })
              .from(schema.clients)
              .all()
              .filter((c) => ids.includes(c.id))
              .map((c) => [c.id, `${c.firstName} ${c.lastName}`])
          : [],
      );
      return todays.map((a) => {
        const therapyIds: number[] = JSON.parse(a.therapyIds || "[]");
        return {
          id: a.id,
          startTime: a.startTime,
          status: a.status,
          clientName: clients.get(a.clientId) ?? "Unknown client",
          therapies: therapyIds
            .map((id) => therapyMap.get(id))
            .filter(Boolean)
            .map((t) => ({ id: t!.id, name: t!.name, colourHex: t!.colourHex })),
        };
      });
    },
    render: (items, ctx) => (
      <TodaysScheduleView items={items} empty={`No ${ctx.vocab.bookings.toLowerCase()} today.`} />
    ),
  },
  "overview.activeMembers": {
    href: "/memberships",
    async load(ctx) {
      const g = await gym(ctx);
      return { value: String(g.activeMembers), sub: "On active memberships" };
    },
    render: kpi,
  },
  "overview.mrr": {
    href: "/memberships",
    async load(ctx) {
      const g = await gym(ctx);
      return { value: formatEur(g.mrrCents / 100), sub: "From active memberships" };
    },
    render: kpi,
  },
  "overview.classesThisWeek": {
    href: "/timetable",
    async load(ctx) {
      const g = await gym(ctx);
      return { value: String(g.classesThisWeek), sub: "Scheduled" };
    },
    render: kpi,
  },
  "overview.attendance": {
    href: "/attendance",
    async load(ctx) {
      const g = await gym(ctx);
      return { value: g.attendanceRatePct === null ? "None yet" : `${g.attendanceRatePct}%`, sub: "Last 30 days" };
    },
    render: kpi,
  },
  "overview.todaysClasses": {
    href: "/timetable",
    async load(ctx) {
      return (await gym(ctx)).todayClasses;
    },
    render: (classes) => <TodaysClassesView classes={classes} />,
  },
  "overview.newLeads": {
    href: "/leads",
    async load(ctx) {
      const cur = countLeads(ctx.range.fromMs, ctx.range.toMs);
      const prev = countLeads(ctx.previous.fromMs, ctx.previous.toMs);
      return { value: String(cur), sub: ctx.range.label, delta: deltaPct(cur, prev), accent: cur > 0 };
    },
    render: kpi,
  },
  "overview.unreadMessages": {
    href: "/communication",
    async load() {
      const row = db
        .select({ n: sql<number>`count(*)` })
        .from(schema.emailMessages)
        .where(and(eq(schema.emailMessages.direction, "in"), eq(schema.emailMessages.isRead, false)))
        .get();
      const n = Number(row?.n ?? 0);
      return { value: String(n), sub: n === 1 ? "Unread email" : "Unread emails", accent: n > 0 };
    },
    render: kpi,
  },
  "overview.needsAttention": {
    async load() {
      return getNeedsAttention();
    },
    render: (items) =>
      items.length === 0 ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: 14 }}>Nothing needs your attention right now.</div>
      ) : (
        <NeedsAttention items={items} />
      ),
  },
  "overview.recentActivity": {
    async load() {
      const rows = await recentActivity(8);
      return rows.map((a) => ({ id: a.id, primary: a.message, meta: relativeTime(a.createdAt) }));
    },
    render: (rows) => <RowList rows={rows} empty="No activity yet." />,
  },
  "overview.revenueTrend": {
    href: "/reports",
    async load(ctx) {
      const [cur, prev] = await Promise.all([
        revenueSeries(ctx.range.fromIso, ctx.range.toIso),
        revenueSeries(ctx.previous.fromIso, ctx.previous.toIso),
      ]);
      const series = fillDays(cur, ctx.range.fromIso, ctx.range.days);
      const total = series.reduce((s, d) => s + d.total, 0);
      const prevTotal = prev.reduce((s, d) => s + Number(d.total || 0), 0);
      return { series, total, delta: deltaPct(total, prevTotal) };
    },
    render: (d, ctx) =>
      d.total === 0 ? (
        <div style={{ padding: 32, color: "var(--text-tertiary)", fontSize: 14, textAlign: "center" }}>
          No revenue recorded in this period.
        </div>
      ) : (
        <>
          <KpiTile value={formatEur(d.total)} sub={ctx.range.label} delta={d.delta} />
          <div style={{ marginTop: 12 }}>
            <RevenueBars data={d.series} />
          </div>
        </>
      ),
  },
  "overview.pipelineSnapshot": {
    href: "/leads",
    async load() {
      const pid = defaultPipelineId();
      const stages = db
        .select({ id: schema.pipelineStages.id, name: schema.pipelineStages.name })
        .from(schema.pipelineStages)
        .where(eq(schema.pipelineStages.pipelineId, pid))
        .orderBy(asc(schema.pipelineStages.position))
        .all();
      const counts = db
        .select({ stageId: schema.leads.stageId, n: sql<number>`count(*)` })
        .from(schema.leads)
        .where(eq(schema.leads.pipelineId, pid))
        .groupBy(schema.leads.stageId)
        .all();
      const byStage = new Map(counts.map((c) => [c.stageId, Number(c.n)]));
      return stages.map((s) => ({ id: s.id, name: s.name, count: byStage.get(s.id) ?? 0 }));
    },
    render: (stages) => <StageBars stages={stages} empty="No leads in the pipeline yet." />,
  },
  "overview.upcomingPosts": {
    href: "/content-studio",
    async load(ctx) {
      const rows = db
        .select({
          id: schema.scheduledPosts.id,
          when: schema.scheduledPosts.scheduledFor,
          name: schema.carouselSets.name,
        })
        .from(schema.scheduledPosts)
        .leftJoin(schema.carouselSets, eq(schema.carouselSets.id, schema.scheduledPosts.carouselSetId))
        .where(and(eq(schema.scheduledPosts.status, "scheduled"), gte(schema.scheduledPosts.scheduledFor, ctx.now)))
        .orderBy(asc(schema.scheduledPosts.scheduledFor))
        .limit(5)
        .all();
      return rows.map((r) => ({
        id: r.id,
        primary: r.name ?? "Untitled post",
        meta: r.when.toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      }));
    },
    render: (rows) => <RowList rows={rows} empty="Nothing scheduled. Plan a post in Content Studio." />,
  },
} satisfies Record<OverviewKey, WidgetImpl<any>>;
```

Create `src/lib/dashboard/widgets/keys.ts`:

```ts
import type { WidgetKey } from "../catalog";
export type OverviewKey = Extract<WidgetKey, `overview.${string}`>;
```

Notes for the implementer:
- `satisfies Record<OverviewKey, WidgetImpl<any>>` checks completeness; each entry's `render` is typed from its own `load` because TS infers per-property. If inference widens `data` to `any` and loses type safety, that is acceptable for this slice; do NOT add per-widget generic plumbing.
- If `schema.clients` has no `firstName`/`lastName` select shape issue, mirror whatever the old page did (`db.select().from(schema.clients).where(inArray(schema.clients.id, ids))`). Prefer `inArray` over the `.filter` above; it is the existing pattern.
- `relativeTime` and `formatEur` already exist in `@/lib/utils`.

- [ ] **Step 7: Run tests and typecheck**

Run: `npm test -- src/lib/dashboard/widgets/overview.test.ts` then `npm run typecheck`
Expected: test prints `ok`; typecheck passes. A missing widget implementation shows as a `satisfies` error naming the key.

- [ ] **Step 8: Commit**

```bash
git add src/lib/dashboard src/components/dashboard/views
git commit -m "feat(dashboard): overview widget implementations and shared views"
```

---

### Task 6: Server actions

**Files:**
- Create: `src/app/dashboard/actions.ts`

**Interfaces:**
- Consumes: Task 4 `tabs.ts` functions; Task 5 `setWidgetVisibility`, `setSensitivityVisibility`; `requireUser`, `getCurrentMembership` from `@/lib/auth`; `getSchedulingMode` from `@/lib/settings`.
- Produces (all `"use server"`, all return `ActionResult = { ok: true; index?: number } | { ok: false; error: string }`):
  `saveWidgetsAction(index, widgets)`, `setRangeAction(index, range)`, `addTabAction(input)`, `renameTabAction(index, name)`, `deleteTabAction(index)`, `moveTabAction(from, to)`, `resetTabAction(index)`, `makeTeamDefaultAction()`, `clearTeamDefaultAction()`, `setWidgetVisibilityAction(key, visible)`, `setFinancialVisibilityAction(visible)`

- [ ] **Step 1: Write the actions**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { getCurrentMembership } from "@/lib/auth";
import { CATALOG_BY_KEY } from "@/lib/dashboard/catalog";
import * as tabs from "@/lib/dashboard/tabs";
import type { Venue } from "@/lib/dashboard/types";
import { setSensitivityVisibility, setWidgetVisibility } from "@/lib/dashboard/visibilityStore";
import { getSchedulingMode } from "@/lib/settings";

export type ActionResult = { ok: true; index?: number } | { ok: false; error: string };

function who(): { userId: number; venue: Venue; isAdmin: boolean } {
  const m = getCurrentMembership();
  if (!m) throw new Error("Please sign in again.");
  return {
    userId: m.user.id,
    venue: getSchedulingMode() === "timetable" ? "gym" : "clinic",
    isAdmin: m.role === "admin",
  };
}

function run(fn: () => number | void, path = "/dashboard"): ActionResult {
  try {
    const index = fn();
    revalidatePath(path);
    return typeof index === "number" ? { ok: true, index } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

const int = (n: unknown) => (Number.isInteger(n) ? (n as number) : -1);

export async function saveWidgetsAction(index: number, widgets: unknown): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.saveTabWidgets(u.userId, u.venue, int(index), widgets);
  });
}

export async function setRangeAction(index: number, range: string): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.setTabRange(u.userId, u.venue, int(index), String(range));
  });
}

export async function addTabAction(
  input: { kind: "preset"; presetKey: string } | { kind: "blank" } | { kind: "duplicate"; index: number },
): Promise<ActionResult> {
  return run(() => {
    const u = who();
    if (input?.kind === "preset") return tabs.addTab(u.userId, u.venue, { kind: "preset", presetKey: String(input.presetKey) });
    if (input?.kind === "duplicate") return tabs.addTab(u.userId, u.venue, { kind: "duplicate", index: int(input.index) });
    return tabs.addTab(u.userId, u.venue, { kind: "blank" });
  });
}

export async function renameTabAction(index: number, name: string): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.renameTab(u.userId, u.venue, int(index), String(name ?? ""));
  });
}

export async function deleteTabAction(index: number): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.deleteTab(u.userId, u.venue, int(index));
  });
}

export async function moveTabAction(from: number, to: number): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.moveTab(u.userId, u.venue, int(from), int(to));
  });
}

export async function resetTabAction(index: number): Promise<ActionResult> {
  return run(() => {
    const u = who();
    tabs.resetTab(u.userId, u.venue, int(index));
  });
}

export async function makeTeamDefaultAction(): Promise<ActionResult> {
  return run(() => {
    const u = who();
    if (!u.isAdmin) throw new Error("Only admins can set the team default.");
    tabs.makeTeamDefault(u.userId, u.venue);
  });
}

export async function clearTeamDefaultAction(): Promise<ActionResult> {
  return run(() => {
    const u = who();
    if (!u.isAdmin) throw new Error("Only admins can change the team default.");
    tabs.clearTeamDefault();
  });
}

export async function setWidgetVisibilityAction(key: string, visible: boolean | null): Promise<ActionResult> {
  return run(() => {
    const u = who();
    if (!u.isAdmin) throw new Error("Only admins can change widget visibility.");
    if (!CATALOG_BY_KEY.has(key)) throw new Error("Unknown widget.");
    setWidgetVisibility(key, visible === null ? null : !!visible);
  }, "/settings/dashboard");
}

export async function setFinancialVisibilityAction(visible: boolean): Promise<ActionResult> {
  return run(() => {
    const u = who();
    if (!u.isAdmin) throw new Error("Only admins can change widget visibility.");
    setSensitivityVisibility(["financial", "spend"], !!visible);
  }, "/settings/dashboard");
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/actions.ts
git commit -m "feat(dashboard): server actions for tabs, layout and visibility"
```

---

### Task 7: Widget slot, error boundary, grid CSS, and the page

**Files:**
- Create: `src/components/dashboard/WidgetSlot.tsx`, `src/components/dashboard/WidgetErrorBoundary.tsx`
- Modify: `src/app/globals.css` (append)
- Rewrite: `src/app/dashboard/page.tsx`
- Modify: `src/app/dashboard/loading.tsx` only if it renders a layout that no longer matches (leave it otherwise)

**Interfaces:**
- Consumes: everything above. `DashboardGrid` and `TabBar` are created in Tasks 8 and 9; in THIS task create them as minimal stubs so the page compiles, then replace in 8 and 9:
  - `DashboardGrid` props: `{ tabIndex: number; items: GridItem[]; catalog: CatalogEntry[] }` where `GridItem = { ref: WidgetRef; title: string; href?: string; node: React.ReactNode }` and `CatalogEntry = Pick<WidgetMeta, "key" | "title" | "description" | "domain" | "sizes" | "defaultSize"> & { domainLabel: string }`
  - `TabBar` props: `{ tabs: { name: string; presetKey: string | null }[]; active: number; rangeKey: RangeKey; rangeLabel: string; isAdmin: boolean; source: TabSource; presets: { key: string; name: string; description: string; icon: PresetIcon; count: number }[]; custom?: { from: string; to: string } }`
- Produces: `WidgetSlot` (async server component, props `{ widgetKey: string; ctx: WidgetCtx; tenantId: number }`), `WidgetErrorBoundary` (client, props `{ children }`), CSS classes `.dash-grid`, `.dash-span-1..4`, `.dash-tile`, `.dash-wobble`.

- [ ] **Step 1: `WidgetErrorBoundary.tsx`**

```tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

function Retry({ onRetry }: { onRetry: () => void }) {
  const router = useRouter();
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, color: "var(--text-tertiary)", fontSize: 13 }}>
      <span>Couldn&rsquo;t load this widget.</span>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          onRetry();
          router.refresh();
        }}
      >
        <RotateCw size={13} /> Retry
      </Button>
    </div>
  );
}

export class WidgetErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Retry onRetry={() => this.setState({ failed: false })} /> : this.props.children;
  }
}
```

- [ ] **Step 2: `WidgetSlot.tsx`**

```tsx
import { WIDGET_IMPLS } from "@/lib/dashboard/widgets";
import type { WidgetKey } from "@/lib/dashboard/catalog";
import type { WidgetCtx, WidgetImpl } from "@/lib/dashboard/types";

/**
 * Loads and renders one widget. Runs inside its own <Suspense> and
 * <WidgetErrorBoundary> (see the dashboard page), so a slow widget streams
 * in late and a failing one only breaks its own tile.
 */
export async function WidgetSlot({ widgetKey, ctx, tenantId }: { widgetKey: string; ctx: WidgetCtx; tenantId: number }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const impl = (WIDGET_IMPLS as Record<WidgetKey, WidgetImpl<any>>)[widgetKey as WidgetKey];
  if (!impl) return null;
  try {
    const data = await impl.load(ctx);
    return <>{impl.render(data, ctx)}</>;
  } catch (err) {
    console.error(`[dashboard] widget ${widgetKey} failed for tenant ${tenantId}`, err);
    throw err;
  }
}
```

- [ ] **Step 3: Append CSS to `src/app/globals.css`**

```css
/* ── Customisable dashboard grid (lib/dashboard) ───────────────────────── */
.dash-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}
.dash-span-1 { grid-column: span 1; }
.dash-span-2 { grid-column: span 2; }
.dash-span-3 { grid-column: span 3; }
.dash-span-4 { grid-column: span 4; }
.dash-tile { min-width: 0; position: relative; }
@media (max-width: 1024px) {
  .dash-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dash-span-3, .dash-span-4 { grid-column: span 2; }
}
@media (max-width: 640px) {
  .dash-grid { grid-template-columns: minmax(0, 1fr); }
  .dash-span-2, .dash-span-3, .dash-span-4 { grid-column: span 1; }
}
@keyframes dash-wobble {
  0%, 100% { transform: rotate(-0.25deg); }
  50% { transform: rotate(0.25deg); }
}
.dash-wobble { animation: dash-wobble 0.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .dash-wobble { animation: none; }
}
.dash-tabs { display: flex; gap: 4px; overflow-x: auto; scrollbar-width: none; }
.dash-tabs::-webkit-scrollbar { display: none; }
```

- [ ] **Step 4: Stubs so the page compiles**

`src/components/dashboard/DashboardGrid.tsx`:

```tsx
"use client";
import type React from "react";
import type { WidgetMeta, WidgetRef } from "@/lib/dashboard/types";

export type GridItem = { ref: WidgetRef; title: string; href?: string; node: React.ReactNode };
export type CatalogEntry = Pick<WidgetMeta, "key" | "title" | "description" | "domain" | "sizes" | "defaultSize"> & {
  domainLabel: string;
};

export function DashboardGrid({ items }: { tabIndex: number; items: GridItem[]; catalog: CatalogEntry[] }) {
  return (
    <div className="dash-grid">
      {items.map((it, i) => (
        <div key={i} className={`dash-tile dash-span-${{ S: 1, M: 2, L: 3, XL: 4 }[it.ref.size]}`}>
          {it.node}
        </div>
      ))}
    </div>
  );
}
```

`src/components/dashboard/TabBar.tsx`:

```tsx
"use client";
import type { PresetIcon } from "@/lib/dashboard/presets";
import type { RangeKey } from "@/lib/dashboard/range";
import type { TabSource } from "@/lib/dashboard/tabs";

export type TabBarProps = {
  tabs: { name: string; presetKey: string | null }[];
  active: number;
  rangeKey: RangeKey;
  rangeLabel: string;
  isAdmin: boolean;
  source: TabSource;
  presets: { key: string; name: string; description: string; icon: PresetIcon; count: number }[];
  custom?: { from: string; to: string };
};

export function TabBar(props: TabBarProps) {
  return <div className="dash-tabs">{props.tabs.map((t, i) => <span key={i}>{t.name}</span>)}</div>;
}
```

`TabSource` is exported from `tabs.ts`, which imports `server-only`. A type-only import is erased at compile time, so this is safe in a client file; keep it `import type`.

- [ ] **Step 5: Rewrite `src/app/dashboard/page.tsx`**

```tsx
import { Suspense } from "react";
import Link from "next/link";
import { CalendarPlus, ChevronRight, Plus, Sparkles } from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Reveal } from "@/components/motion/Reveal";
import { DailyBrief } from "@/components/dashboard/DailyBrief";
import { SetupProgressCard } from "@/components/dashboard/SetupProgressCard";
import { DashboardGrid, type CatalogEntry, type GridItem } from "@/components/dashboard/DashboardGrid";
import { TabBar } from "@/components/dashboard/TabBar";
import { WidgetErrorBoundary } from "@/components/dashboard/WidgetErrorBoundary";
import { WidgetSlot } from "@/components/dashboard/WidgetSlot";
import { getCurrentMembership } from "@/lib/auth";
import { isBriefComplete } from "@/lib/businessProfile";
import { CATALOG, CATALOG_BY_KEY } from "@/lib/dashboard/catalog";
import { PRESETS } from "@/lib/dashboard/presets";
import { parseRangeKey, previousRange, resolveRange, type RangeKey } from "@/lib/dashboard/range";
import { resolveTabs } from "@/lib/dashboard/tabs";
import { DOMAIN_LABELS, type Venue, type WidgetCtx, type WidgetMeta } from "@/lib/dashboard/types";
import { appliesToVenue, canSee, visibleRefs } from "@/lib/dashboard/visibility";
import { getVisibilityOverrides } from "@/lib/dashboard/visibilityStore";
import { WIDGET_IMPLS } from "@/lib/dashboard/widgets";
import { getCurrentTenant } from "@/lib/db/tenant";
import { getSchedulingMode, getVenueType } from "@/lib/settings";
import { getSetupSummary, isSetupDismissed, setSetupDismissed } from "@/lib/setup/steps";
import { getVocab } from "@/lib/vocabulary";

export const dynamic = "force-dynamic";

const SPAN = { S: 1, M: 2, L: 3, XL: 4 } as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { tab?: string; range?: string; from?: string; to?: string };
}) {
  const membership = getCurrentMembership();
  if (!membership) return null; // the layout already redirects signed-out users
  const vocab = getVocab(getVenueType());
  const tenantId = getCurrentTenant().id;
  const venue: Venue = getSchedulingMode() === "timetable" ? "gym" : "clinic";
  const isAdmin = membership.role === "admin";
  const briefComplete = isBriefComplete();
  const setup = isAdmin && !isSetupDismissed() ? getSetupSummary() : null;
  if (setup?.allResolved) setSetupDismissed(true);

  const { tabs, source } = resolveTabs(membership.user.id, venue);
  const requested = Number.parseInt(searchParams.tab ?? "0", 10);
  const active = Number.isInteger(requested) && requested >= 0 && requested < tabs.length ? requested : 0;
  const tab = tabs[active];

  const now = new Date();
  const rangeKey: RangeKey = parseRangeKey(searchParams.range) ?? tab.range;
  const custom = { from: searchParams.from, to: searchParams.to };
  const tabRange = resolveRange(rangeKey, now, custom);
  const overrides = getVisibilityOverrides();
  const refs = visibleRefs(tab.widgets, { venue, role: membership.role, overrides });
  const cache = new Map<string, Promise<unknown>>();

  const items: GridItem[] = refs.map((ref) => {
    const meta = CATALOG_BY_KEY.get(ref.key)!;
    const range =
      meta.rangeMode === "pinned" && meta.pinnedRange
        ? resolveRange(meta.pinnedRange, now)
        : ref.range
          ? resolveRange(ref.range, now)
          : tabRange;
    const ctx: WidgetCtx = { venue, vocab, range, previous: previousRange(range), now, cache };
    const impl = (WIDGET_IMPLS as Record<string, { label?: (c: WidgetCtx) => string; href?: string }>)[ref.key];
    return {
      ref,
      title: impl?.label?.(ctx) ?? meta.title,
      href: impl?.href,
      node: (
        <WidgetErrorBoundary>
          <Suspense fallback={<Skeleton style={{ height: 48 * SPAN[ref.size] > 96 ? 96 : 48 }} />}>
            <WidgetSlot widgetKey={ref.key} ctx={ctx} tenantId={tenantId} />
          </Suspense>
        </WidgetErrorBoundary>
      ),
    };
  });

  const catalog: CatalogEntry[] = (CATALOG as readonly WidgetMeta[])
    .filter((m) => appliesToVenue(m, venue) && canSee(m, membership.role, overrides))
    .map((m) => ({
      key: m.key,
      title: m.title,
      description: m.description,
      domain: m.domain,
      sizes: m.sizes,
      defaultSize: m.defaultSize,
      domainLabel: DOMAIN_LABELS[m.domain],
    }));

  const presets = PRESETS.map((p) => ({
    key: p.key,
    name: p.name,
    description: p.description,
    icon: p.icon,
    count: visibleRefs(p.widgets[venue], { venue, role: membership.role, overrides }).length,
  }));

  return (
    <div className="app-page">
      {setup && !setup.allResolved && (
        <Reveal>
          <SetupProgressCard requiredDone={setup.requiredDone} requiredTotal={setup.requiredTotal} nextHref={setup.nextHref} />
        </Reveal>
      )}
      <PageHeader
        eyebrow="Today"
        title="Dashboard"
        subtitle={now.toLocaleDateString("en-IE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        actions={
          venue === "gym" ? (
            <Link href="/clients/new">
              <Button>
                <Plus size={15} /> Add member
              </Button>
            </Link>
          ) : (
            <Link href="/appointments/new">
              <Button>
                <CalendarPlus size={15} /> {vocab.bookCta}
              </Button>
            </Link>
          )
        }
      />

      <DailyBrief tenantId={tenantId} />

      {!briefComplete && (
        <Reveal>
          <Link href="/settings/business">
            <Card style={{ marginBottom: 16, borderColor: "var(--accent)", display: "flex", alignItems: "center", gap: 14, padding: 18 }}>
              <Sparkles size={20} color="var(--accent)" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "var(--text-primary)", fontWeight: 500, fontSize: 15 }}>Complete your business brief</div>
                <div style={{ color: "var(--text-secondary)", fontSize: 13, marginTop: 2 }}>
                  Add your overview, policies, and FAQs so the AI can triage and reply accurately.
                </div>
              </div>
              <ChevronRight size={18} color="var(--text-tertiary)" />
            </Card>
          </Link>
        </Reveal>
      )}

      <TabBar
        tabs={tabs.map((t) => ({ name: t.name, presetKey: t.presetKey }))}
        active={active}
        rangeKey={tabRange.key}
        rangeLabel={tabRange.label}
        isAdmin={isAdmin}
        source={source}
        presets={presets}
        custom={tabRange.key === "custom" ? { from: tabRange.fromIso, to: tabRange.toIso } : undefined}
      />

      <DashboardGrid key={`${active}:${tab.widgets.map((w) => w.key + w.size).join(",")}`} tabIndex={active} items={items} catalog={catalog} />
    </div>
  );
}
```

Check that `Skeleton` accepts `style` (`sed -n 1,20p src/components/ui/Skeleton.tsx`); if not, use `<div className="skeleton" style={{ height: 48 }} />` matching whatever class it uses.

- [ ] **Step 6: Run the app and look**

Run: `npm run dev`, open http://localhost:3000/dashboard signed in as an admin of a clinic tenant.
Expected: the Overview widgets render in the 4-column grid (stub chrome, no titles yet) with real numbers matching the old dashboard; `?range=7d` changes New leads and Revenue trend; the Daily Brief and business-brief nudge still sit above.

- [ ] **Step 7: Typecheck, test, commit**

Run: `npm run typecheck && npm test`
Expected: both pass.

```bash
git add src/components/dashboard src/app/dashboard/page.tsx src/app/globals.css
git commit -m "feat(dashboard): render tabs of streamed widgets from the registry"
```

---

### Task 8: The grid and edit mode

**Files:**
- Rewrite: `src/components/dashboard/DashboardGrid.tsx`

**Interfaces:**
- Consumes: `saveWidgetsAction` (Task 6); `GridItem`, `CatalogEntry` (Task 7, keep the exported type names identical); `SIZE_ORDER` (Task 2); `Sheet`, `SheetContent` from `@/components/ui/Sheet`; `Card`, `CardLabel` from `@/components/ui/Card`; `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (check `ls node_modules/@dnd-kit` — if `utilities` is absent, build the transform string by hand: `translate3d(${x}px, ${y}px, 0)`).
- Produces: the grid listens for a `dashboard:customise` window event (dispatched by the TabBar's Customise button in Task 9) to enter edit mode, and dispatches `dashboard:editing` with `{ detail: boolean }` so the TabBar can hide itself while editing.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { ChevronRight, GripVertical, Plus, Search, X } from "lucide-react";

import { saveWidgetsAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/Button";
import { Card, CardLabel } from "@/components/ui/Card";
import { Sheet, SheetContent } from "@/components/ui/Sheet";
import { SIZE_ORDER, type WidgetMeta, type WidgetRef, type WidgetSize } from "@/lib/dashboard/types";

export type GridItem = { ref: WidgetRef; title: string; href?: string; node: React.ReactNode };
export type CatalogEntry = Pick<WidgetMeta, "key" | "title" | "description" | "domain" | "sizes" | "defaultSize"> & {
  domainLabel: string;
};

type Draft = GridItem & { uid: string };

const SPAN: Record<WidgetSize, number> = { S: 1, M: 2, L: 3, XL: 4 };
let uidSeq = 0;
const nextUid = () => `w${++uidSeq}`;

export function DashboardGrid({ tabIndex, items, catalog }: { tabIndex: number; items: GridItem[]; catalog: CatalogEntry[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft[]>(() => items.map((it) => ({ ...it, uid: nextUid() })));
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = useMemo(
    () => JSON.stringify(draft.map((d) => d.ref)) !== JSON.stringify(items.map((i) => i.ref)),
    [draft, items],
  );

  // Enter edit mode from the TabBar's Customise button.
  useEffect(() => {
    const on = () => setEditing(true);
    window.addEventListener("dashboard:customise", on);
    return () => window.removeEventListener("dashboard:customise", on);
  }, []);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("dashboard:editing", { detail: editing }));
  }, [editing]);
  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!editing || !dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing, dirty]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    setDraft((d) => {
      const from = d.findIndex((x) => x.uid === e.active.id);
      const to = d.findIndex((x) => x.uid === e.over!.id);
      return arrayMove(d, from, to);
    });
  }

  function cancel() {
    setDraft(items.map((it) => ({ ...it, uid: nextUid() })));
    setEditing(false);
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await saveWidgetsAction(tabIndex, draft.map((d) => d.ref));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  function add(entry: CatalogEntry) {
    setDraft((d) => [
      ...d,
      {
        uid: nextUid(),
        ref: { key: entry.key, size: entry.defaultSize },
        title: entry.title,
        node: (
          <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>
            {entry.description} It will load when you save.
          </div>
        ),
      },
    ]);
    setAdding(false);
  }

  const sizesFor = (key: string) => catalog.find((c) => c.key === key)?.sizes ?? [];

  return (
    <>
      {editing && (
        <div
          style={{
            position: "sticky",
            top: 8,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: 10,
            justifyContent: "space-between",
            padding: "10px 14px",
            marginBottom: 16,
            borderRadius: "var(--radius)",
            border: "1px solid var(--hairline)",
            background: "var(--surface-1)",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            Drag tiles to reorder. Change a tile&rsquo;s size or remove it from its header.
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> Add widget
            </Button>
            <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              {pending ? "Saving" : "Done"}
            </Button>
          </div>
        </div>
      )}
      {error && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</div>}

      {draft.length === 0 && (
        <Card style={{ textAlign: "center", padding: 32, marginBottom: 32 }}>
          <div style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 12 }}>This tab is empty.</div>
          <Button
            size="sm"
            onClick={() => {
              setEditing(true);
              setAdding(true);
            }}
          >
            <Plus size={14} /> Add widget
          </Button>
        </Card>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={draft.map((d) => d.uid)} strategy={rectSortingStrategy}>
          <div className="dash-grid">
            {draft.map((d) => (
              <Tile
                key={d.uid}
                item={d}
                editing={editing}
                sizes={sizesFor(d.ref.key)}
                onSize={(size) => setDraft((all) => all.map((x) => (x.uid === d.uid ? { ...x, ref: { ...x.ref, size } } : x)))}
                onRemove={() => setDraft((all) => all.filter((x) => x.uid !== d.uid))}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <AddWidgetSheet open={adding} onOpenChange={setAdding} catalog={catalog} onAdd={add} />
    </>
  );
}

function Tile({
  item,
  editing,
  sizes,
  onSize,
  onRemove,
}: {
  item: Draft;
  editing: boolean;
  sizes: readonly WidgetSize[];
  onSize: (s: WidgetSize) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.uid,
    disabled: !editing,
  });
  const style: React.CSSProperties = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    zIndex: isDragging ? 30 : undefined,
    opacity: isDragging ? 0.85 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={`dash-tile dash-span-${SPAN[item.ref.size]}`}>
      <Card className={editing && !isDragging ? "dash-wobble" : undefined} style={{ height: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          {editing && (
            <button
              type="button"
              aria-label={`Move ${item.title}`}
              {...attributes}
              {...listeners}
              style={{ cursor: "grab", color: "var(--text-tertiary)", background: "none", border: 0, padding: 0, display: "flex" }}
            >
              <GripVertical size={15} />
            </button>
          )}
          <CardLabel style={{ marginBottom: 0, flex: 1, minWidth: 0 }}>{item.title}</CardLabel>
          {editing ? (
            <>
              <div role="group" aria-label="Tile size" style={{ display: "flex", gap: 2 }}>
                {SIZE_ORDER.filter((s) => sizes.includes(s)).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onSize(s)}
                    aria-pressed={item.ref.size === s}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: 6,
                      border: "1px solid var(--hairline)",
                      background: item.ref.size === s ? "var(--accent)" : "transparent",
                      color: item.ref.size === s ? "var(--bg)" : "var(--text-secondary)",
                      cursor: "pointer",
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label={`Remove ${item.title}`}
                onClick={onRemove}
                style={{ color: "var(--text-tertiary)", background: "none", border: 0, cursor: "pointer", display: "flex" }}
              >
                <X size={15} />
              </button>
            </>
          ) : (
            item.href && (
              <Link href={item.href} aria-label={`Open ${item.title}`} style={{ color: "var(--text-tertiary)", display: "flex" }}>
                <ChevronRight size={16} />
              </Link>
            )
          )}
        </div>
        <div style={editing ? { pointerEvents: "none" } : undefined}>{item.node}</div>
      </Card>
    </div>
  );
}

function AddWidgetSheet({
  open,
  onOpenChange,
  catalog,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  catalog: CatalogEntry[];
  onAdd: (e: CatalogEntry) => void;
}) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hits = catalog.filter(
      (c) => !needle || c.title.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle),
    );
    const by = new Map<string, CatalogEntry[]>();
    for (const c of hits) by.set(c.domainLabel, [...(by.get(c.domainLabel) ?? []), c]);
    return [...by.entries()];
  }, [catalog, q]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="Add a widget" width={460}>
        <div style={{ position: "relative", marginBottom: 16 }}>
          <Search size={14} style={{ position: "absolute", left: 12, top: 12, color: "var(--text-tertiary)" }} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search widgets"
            aria-label="Search widgets"
            className="input"
            style={{ paddingLeft: 32, width: "100%" }}
          />
        </div>
        {groups.length === 0 && <div style={{ color: "var(--text-tertiary)", fontSize: 13 }}>No widgets match.</div>}
        {groups.map(([label, list]) => (
          <div key={label} style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 8 }}>
              {label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => onAdd(c)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: "var(--radius)",
                    border: "1px solid var(--hairline)",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>{c.title}</div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 12.5, marginTop: 2 }}>{c.description}</div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </SheetContent>
    </Sheet>
  );
}
```

Check the input class name the app uses for text fields (`grep -rn 'className="input' src/components | head -2` or look at `src/components/ui/Input.tsx`); prefer rendering the `Input` component from `@/components/ui/Input` if it forwards `value`/`onChange`.

- [ ] **Step 2: Verify in the browser**

Run `npm run dev`. In the console, run `window.dispatchEvent(new Event("dashboard:customise"))` (the TabBar button arrives in Task 9).
Expected: tiles wobble, show a grip, size buttons and X; dragging reorders; changing size reflows; Add widget sheet lists catalog grouped by domain with search; Done saves and the page reloads with the new layout; Cancel restores; keyboard: focus a grip, Space, arrows, Space moves a tile.

- [ ] **Step 3: Typecheck, commit**

Run: `npm run typecheck`

```bash
git add src/components/dashboard/DashboardGrid.tsx
git commit -m "feat(dashboard): edit mode with drag, resize, remove and add widget"
```

---

### Task 9: Tab bar, add-tab dialog, tab menu, range picker

**Files:**
- Rewrite: `src/components/dashboard/TabBar.tsx`

**Interfaces:**
- Consumes: `addTabAction`, `renameTabAction`, `deleteTabAction`, `moveTabAction`, `resetTabAction`, `makeTeamDefaultAction`, `clearTeamDefaultAction`, `setRangeAction` (Task 6); `TabBarProps` (keep the name and shape from the Task 7 stub); `RANGE_LABELS`, `STORED_RANGE_KEYS` (Task 1); `Dialog`, `DialogContent` (`@/components/ui/Dialog`); `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator` (`@/components/ui/DropdownMenu`); `useConfirm` (`@/components/ui/ConfirmDialog`).
- Produces: dispatches `dashboard:customise`; listens for `dashboard:editing` to hide tab controls while editing.

Before writing: confirm `ConfirmProvider` wraps the app (`grep -rn "ConfirmProvider" src/app/layout.tsx src/components | head -3`). If it does not wrap `/dashboard`, use `window.confirm` replaced by a small inline `Dialog` instead of `useConfirm`.

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Binoculars,
  CalendarCheck,
  Copy,
  Cpu,
  Dumbbell,
  Globe,
  Images,
  LayoutDashboard,
  LayoutTemplate,
  Mail,
  Megaphone,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  ArrowLeft,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

import {
  addTabAction,
  clearTeamDefaultAction,
  deleteTabAction,
  makeTeamDefaultAction,
  moveTabAction,
  renameTabAction,
  resetTabAction,
  setRangeAction,
  type ActionResult,
} from "@/app/dashboard/actions";
import { Button } from "@/components/ui/Button";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { Dialog, DialogContent } from "@/components/ui/Dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/DropdownMenu";
import type { PresetIcon } from "@/lib/dashboard/presets";
import { RANGE_LABELS, STORED_RANGE_KEYS, type RangeKey } from "@/lib/dashboard/range";
import type { TabSource } from "@/lib/dashboard/tabs";

export type TabBarProps = {
  tabs: { name: string; presetKey: string | null }[];
  active: number;
  rangeKey: RangeKey;
  rangeLabel: string;
  isAdmin: boolean;
  source: TabSource;
  presets: { key: string; name: string; description: string; icon: PresetIcon; count: number }[];
  custom?: { from: string; to: string };
};

const ICONS: Record<PresetIcon, LucideIcon> = {
  LayoutDashboard,
  TrendingUp,
  Megaphone,
  Mail,
  MessagesSquare,
  CalendarCheck,
  Dumbbell,
  Wallet,
  Images,
  Globe,
  Binoculars,
  Cpu,
};

export function TabBar({ tabs, active, rangeKey, isAdmin, source, presets, custom }: TabBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<{ index: number; name: string } | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [from, setFrom] = useState(custom?.from ?? "");
  const [to, setTo] = useState(custom?.to ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const on = (e: Event) => setEditing(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener("dashboard:editing", on);
    return () => window.removeEventListener("dashboard:editing", on);
  }, []);

  function go(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === null) sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  function act(fn: () => Promise<ActionResult>, after?: (r: Extract<ActionResult, { ok: true }>) => void) {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      after?.(r);
      router.refresh();
    });
  }

  function pickRange(key: string) {
    if (key === "custom") return setCustomOpen(true);
    go({ range: null, from: null, to: null });
    act(() => setRangeAction(active, key));
  }

  async function remove(index: number) {
    const ok = await confirm({ title: `Delete "${tabs[index].name}"?`, body: "This removes the tab and its layout.", destructive: true, confirmLabel: "Delete" });
    if (!ok) return;
    act(() => deleteTabAction(index), () => go({ tab: String(Math.max(0, index - 1)) }));
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div className="dash-tabs" role="tablist" aria-label="Dashboards" style={{ flex: 1, minWidth: 0 }}>
          {tabs.map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center" }}>
              <button
                role="tab"
                aria-selected={i === active}
                onClick={() => go({ tab: String(i) })}
                disabled={editing}
                style={{
                  whiteSpace: "nowrap",
                  padding: "8px 12px",
                  borderRadius: "var(--radius)",
                  border: 0,
                  cursor: "pointer",
                  fontSize: 13.5,
                  fontWeight: 500,
                  background: i === active ? "var(--surface-2)" : "transparent",
                  color: i === active ? "var(--text-primary)" : "var(--text-secondary)",
                }}
              >
                {t.name}
              </button>
              {i === active && !editing && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button aria-label={`${t.name} options`} style={{ background: "none", border: 0, color: "var(--text-tertiary)", cursor: "pointer", display: "flex", padding: 4 }}>
                      <MoreHorizontal size={15} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => setRenaming({ index: i, name: t.name })}>
                      <Pencil size={14} /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => act(() => addTabAction({ kind: "duplicate", index: i }), (r) => go({ tab: String(r.index ?? i) }))}>
                      <Copy size={14} /> Duplicate
                    </DropdownMenuItem>
                    {i > 0 && (
                      <DropdownMenuItem onSelect={() => act(() => moveTabAction(i, i - 1), () => go({ tab: String(i - 1) }))}>
                        <ArrowLeft size={14} /> Move left
                      </DropdownMenuItem>
                    )}
                    {i < tabs.length - 1 && (
                      <DropdownMenuItem onSelect={() => act(() => moveTabAction(i, i + 1), () => go({ tab: String(i + 1) }))}>
                        <ArrowRight size={14} /> Move right
                      </DropdownMenuItem>
                    )}
                    {t.presetKey && (
                      <DropdownMenuItem onSelect={() => act(() => resetTabAction(i))}>
                        <RotateCcw size={14} /> Reset to default
                      </DropdownMenuItem>
                    )}
                    {isAdmin && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={async () => {
                            const ok = await confirm({
                              title: "Make these tabs the team default?",
                              body: "Everyone who has not customised their dashboard, and every new team member, will start from your current tabs.",
                              confirmLabel: "Make team default",
                            });
                            if (ok) act(() => makeTeamDefaultAction());
                          }}
                        >
                          <Users size={14} /> Make team default
                        </DropdownMenuItem>
                        {source !== "platform" && (
                          <DropdownMenuItem onSelect={() => act(() => clearTeamDefaultAction())}>
                            <LayoutTemplate size={14} /> Clear team default
                          </DropdownMenuItem>
                        )}
                      </>
                    )}
                    {tabs.length > 1 && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => remove(i)}>
                          <Trash2 size={14} /> Delete tab
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
          {!editing && (
            <button
              aria-label="Add a tab"
              onClick={() => setAdding(true)}
              style={{ background: "none", border: 0, color: "var(--text-tertiary)", cursor: "pointer", display: "flex", padding: "8px 10px" }}
            >
              <Plus size={16} />
            </button>
          )}
        </div>

        {!editing && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select
              aria-label="Date range"
              value={rangeKey}
              onChange={(e) => pickRange(e.target.value)}
              disabled={pending}
              className="input"
              style={{ height: 34, paddingTop: 0, paddingBottom: 0 }}
            >
              {STORED_RANGE_KEYS.map((k) => (
                <option key={k} value={k}>
                  {RANGE_LABELS[k]}
                </option>
              ))}
              <option value="custom">{rangeKey === "custom" && custom ? `${custom.from} to ${custom.to}` : "Custom..."}</option>
            </select>
            <Button variant="ghost" size="sm" onClick={() => window.dispatchEvent(new Event("dashboard:customise"))}>
              <Settings2 size={14} /> Customise
            </Button>
          </div>
        )}
      </div>
      {error && <div style={{ color: "#ef4444", fontSize: 13, marginTop: 8 }}>{error}</div>}

      {/* Add a tab */}
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent title="Add a tab" description="Start from a preset, an empty tab, or a copy of this one." width={640}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
            {presets.map((p) => {
              const Icon = ICONS[p.icon];
              return (
                <button
                  key={p.key}
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    act(() => addTabAction({ kind: "preset", presetKey: p.key }), (r) => {
                      setAdding(false);
                      go({ tab: String(r.index ?? tabs.length) });
                    })
                  }
                  style={{ textAlign: "left", padding: 14, borderRadius: "var(--radius)", border: "1px solid var(--hairline)", background: "transparent", cursor: "pointer" }}
                >
                  <Icon size={18} color="var(--accent)" />
                  <div style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 500, marginTop: 8 }}>{p.name}</div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 12.5, marginTop: 4 }}>{p.description}</div>
                  <div style={{ color: "var(--text-tertiary)", fontSize: 11.5, marginTop: 8 }}>{p.count} widgets</div>
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => act(() => addTabAction({ kind: "duplicate", index: active }), (r) => { setAdding(false); go({ tab: String(r.index ?? tabs.length) }); })}
            >
              <Copy size={14} /> Duplicate current
            </Button>
            <Button
              disabled={pending}
              onClick={() => act(() => addTabAction({ kind: "blank" }), (r) => { setAdding(false); go({ tab: String(r.index ?? tabs.length) }); })}
            >
              <Plus size={14} /> Blank tab
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename */}
      <Dialog open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)}>
        <DialogContent title="Rename tab" width={420}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!renaming) return;
              act(() => renameTabAction(renaming.index, renaming.name), () => setRenaming(null));
            }}
          >
            <input
              autoFocus
              aria-label="Tab name"
              className="input"
              maxLength={40}
              value={renaming?.name ?? ""}
              onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
              style={{ width: "100%" }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <Button type="submit" disabled={pending}>Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Custom range */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent title="Custom range" width={420}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!from || !to) return;
              setCustomOpen(false);
              go({ range: "custom", from, to });
            }}
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              From
              <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "100%", marginTop: 4 }} />
            </label>
            <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              To
              <input type="date" className="input" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={{ width: "100%", marginTop: 4 }} />
            </label>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <Button type="submit">Apply</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

Notes:
- Lucide 1.x may not export every name above (`Binoculars` in particular). Run `node -e "const l=require('lucide-react');console.log(['Binoculars','LayoutTemplate','Settings2','MessagesSquare','CalendarCheck'].map(n=>n+':'+!!l[n]))"`. For any missing name, use the nearest existing icon (e.g. `Eye` for `Binoculars`) and keep the `PresetIcon` string, mapping it in `ICONS`.
- A custom range is URL-only by design (spec); the stored tab range is unchanged.
- `useSearchParams` in a client component under a dynamic page needs no Suspense wrapper because the page is `force-dynamic`.

- [ ] **Step 2: Verify in the browser**

Run `npm run dev`, open `/dashboard`.
Expected:
- One "Overview" tab; range select shows "Last 30 days"; switching to 7 days updates New leads and Revenue trend and persists after reload.
- "+" opens the dialog with the Overview preset card (10 widgets), Duplicate current and Blank tab; each adds a tab and switches to it.
- Tab menu: rename, duplicate, move left/right, reset, delete (confirm), and for admins Make team default / Clear team default.
- Customise enters edit mode; tab controls hide while editing.
- Custom range dialog sets `?range=custom&from=..&to=..`.
- On a phone-width window, tabs scroll sideways and the grid is one column.

- [ ] **Step 3: Typecheck, commit**

Run: `npm run typecheck`

```bash
git add src/components/dashboard/TabBar.tsx
git commit -m "feat(dashboard): tab bar with presets, tab menu and range picker"
```

---

### Task 10: Widget visibility settings

**Files:**
- Create: `src/app/settings/dashboard/page.tsx`, `src/app/settings/dashboard/VisibilityTable.tsx`
- Modify: `src/app/settings/page.tsx` (add a section card in `buildSections`, after "Venue type")

**Interfaces:**
- Consumes: `requireAdminPage` (`@/lib/auth`); `CATALOG`, `DOMAIN_LABELS`, `staffCanSeeByDefault`, `getVisibilityOverrides`; `setWidgetVisibilityAction`, `setFinancialVisibilityAction` (Task 6); `PageHeader`.

- [ ] **Step 1: Page**

```tsx
import { PageHeader } from "@/components/layout/PageHeader";
import { requireAdminPage } from "@/lib/auth";
import { CATALOG } from "@/lib/dashboard/catalog";
import { DOMAIN_LABELS, type WidgetMeta } from "@/lib/dashboard/types";
import { staffCanSeeByDefault } from "@/lib/dashboard/visibility";
import { getVisibilityOverrides } from "@/lib/dashboard/visibilityStore";
import { VisibilityTable, type VisibilityRow } from "./VisibilityTable";

export const dynamic = "force-dynamic";

export default async function DashboardSettingsPage() {
  await requireAdminPage();
  const overrides = getVisibilityOverrides();
  const rows: VisibilityRow[] = (CATALOG as readonly WidgetMeta[]).map((m) => ({
    key: m.key,
    title: m.title,
    description: m.description,
    domainLabel: DOMAIN_LABELS[m.domain],
    sensitivity: m.sensitivity,
    visible: typeof overrides[m.key] === "boolean" ? overrides[m.key] : staffCanSeeByDefault(m),
    overridden: typeof overrides[m.key] === "boolean",
  }));
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Settings"
        title="Dashboard widgets"
        subtitle="Choose which dashboard widgets staff can see. Admins always see everything."
      />
      <VisibilityTable rows={rows} />
    </div>
  );
}
```

- [ ] **Step 2: Client table**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";

import { setFinancialVisibilityAction, setWidgetVisibilityAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import type { Sensitivity } from "@/lib/dashboard/types";

export type VisibilityRow = {
  key: string;
  title: string;
  description: string;
  domainLabel: string;
  sensitivity: Sensitivity;
  visible: boolean;
  overridden: boolean;
};

export function VisibilityTable({ rows }: { rows: VisibilityRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => ReturnType<typeof setWidgetVisibilityAction>) =>
    startTransition(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error);
      router.refresh();
    });

  const groups = new Map<string, VisibilityRow[]>();
  for (const r of rows) groups.set(r.domainLabel, [...(groups.get(r.domainLabel) ?? []), r]);

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setFinancialVisibilityAction(true))}>
          Show all financial to staff
        </Button>
        <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setFinancialVisibilityAction(false))}>
          Hide all financial from staff
        </Button>
      </div>
      {error && <div style={{ color: "#ef4444", fontSize: 13, marginBottom: 12 }}>{error}</div>}
      {[...groups.entries()].map(([label, list]) => (
        <Card key={label} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--text-tertiary)", marginBottom: 10 }}>{label}</div>
          {list.map((r) => (
            <div key={r.key} style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 0", borderTop: "1px solid var(--hairline)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-primary)", fontSize: 14, fontWeight: 500 }}>
                  {r.title}
                  {r.sensitivity !== "general" && <Lock size={12} color="var(--text-tertiary)" aria-label="Financial" />}
                </div>
                <div style={{ color: "var(--text-tertiary)", fontSize: 12.5, marginTop: 2 }}>{r.description}</div>
              </div>
              {r.overridden && (
                <button
                  type="button"
                  onClick={() => run(() => setWidgetVisibilityAction(r.key, null))}
                  disabled={pending}
                  style={{ background: "none", border: 0, color: "var(--text-tertiary)", fontSize: 12, cursor: "pointer" }}
                >
                  Use default
                </button>
              )}
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  role="switch"
                  checked={r.visible}
                  disabled={pending}
                  onChange={(e) => run(() => setWidgetVisibilityAction(r.key, e.target.checked))}
                />
                Staff can see
              </label>
            </div>
          ))}
        </Card>
      ))}
    </>
  );
}
```

If the app has an existing toggle/switch component (`grep -rln 'role="switch"' src/components | head -3`), use it instead of the bare checkbox.

- [ ] **Step 3: Settings index card**

In `src/app/settings/page.tsx`, add to the array returned by `buildSections`, right after the `/settings/venue` entry, and add `LayoutDashboard` to the lucide import:

```tsx
  {
    href: "/settings/dashboard",
    icon: LayoutDashboard,
    title: "Dashboard widgets",
    desc: "Choose which dashboard widgets your staff can see, such as revenue and spend.",
  },
```

If `buildSections` entries carry an admin-only flag, set it the way sibling admin pages do.

- [ ] **Step 4: Verify**

`npm run dev`. As admin open `/settings/dashboard`: toggle "Revenue trend" on for staff. Sign in as a staff user (or temporarily flip the role) and confirm Revenue trend appears on their Overview; toggle it off and confirm it disappears and is not in their Add-widget sheet. A staff user visiting `/settings/dashboard` is redirected.

- [ ] **Step 5: Typecheck, commit**

```bash
git add src/app/settings/dashboard src/app/settings/page.tsx
git commit -m "feat(dashboard): admin screen for staff widget visibility"
```

---

### Task 11: Full verification and deploy

**Files:** none new.

- [ ] **Step 1: Full checks**

Run: `npm run typecheck && npm test && npx next build`
Expected: all three succeed. Fix anything that fails before continuing.

- [ ] **Step 2: Manual pass, both venues**

With `npm run dev`:
- Clinic tenant (admin): Overview matches the old dashboard's numbers; edit, add, resize, remove, save; add blank and duplicate tabs; rename; move; delete; reset; custom range; make team default.
- Switch the tenant to the timetable scheduling mode (Settings, Schedule) and confirm the gym Overview renders (active members, MRR, attendance, today's classes).
- Staff user: no financial tiles by default; no Make team default option.
- Phone width (375px): one column, tabs scroll, edit mode usable by touch.
- Force a widget failure (temporarily `throw` in one `load`) and confirm only that tile shows Retry; revert.

- [ ] **Step 3: Push and deploy**

```bash
git push origin main
cd /Users/truep/Desktop/Clients/Renova/app && railway up
```

Then hit `/api/health` on production and open `/dashboard` on the live tenant to confirm it renders. Report the deploy result.

---

## Self-review notes

- Spec coverage for slice 1: registry (Tasks 2, 5), shared views (5), presets shape (3), storage + resolution + team default + reset (4), URL tab/range + Suspense per widget (7), server-side visibility (3, 7, 10), edit mode incl. unsaved-changes guard and keyboard reorder (8), tab bar + preset gallery + Blank/Duplicate + tab menu (9), visibility screen + bulk toggles (10), per-widget error boundary + logging (7), layout validation + limits (2, 4), tests (1-5), deploy (11).
- Deferred to later slices by design: `requires` on widgets (first needed by Website/Email presets in slice 3), recorders and "Collecting since" state (slice 2), the ten domain presets and their widgets (slices 3 and 4), per-request cache use by multiple domain widgets, extra indexes.
- Viewing never writes: `resolveTabs` is read-only; `setRangeAction` is only called on an explicit range change.
