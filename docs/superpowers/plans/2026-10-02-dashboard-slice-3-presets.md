# Customisable Dashboard — Slice 3 (Sales, Marketing, Email, Communication presets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four in-depth dashboard presets — Sales (15 widgets), Marketing (12), Email (14), Communication (13) — each addable as a tab, built on the slice-1 widget registry and the slice-2 recorders.

**Architecture:** Shared infrastructure first (generic chart/list/table/heatmap/funnel views, a requirement gate with call-to-action, a "Collecting since" note for recorder-backed widgets, `tenantId` and `recorderStart` on the widget context, and pure statistics helpers). Then one task per domain: a `data/<domain>.ts` module (pure functions tested + query functions), `widgets/<domain>.tsx` implementations, catalog entries and the preset. Every widget follows the slice-1 contract: metadata in `catalog.ts`, `load(ctx)` + `render(data, ctx)` in `widgets/*.tsx`, completeness enforced by `satisfies Record<Key, WidgetImpl>`.

**Tech Stack:** Next.js 14 server components, drizzle-orm over better-sqlite3 (ambient tenant `db`), recharts 3 (client components only), lucide-react, `node:assert` test scripts via `npm test -- <path>`.

Spec: `docs/superpowers/specs/2026-10-02-customisable-dashboard-design.md` section 3. Slices 1 and 2 are live.

## Global Constraints

- NO EMOJIS anywhere.
- All work in `app/`. Run commands from `/Users/truep/Desktop/Clients/Renova/app`.
- Widget keys are `domain.camelName` (`/^[a-z]+\.[a-zA-Z]+$/`) and prefixed by their domain; every catalog entry has an implementation (enforced by `satisfies`), and every preset validates (`presets.test.ts`).
- "Won" means the lead's stage role is in `WON_ROLES` (`won`, `repeat`) from `src/lib/pipeline/roles.ts`. "Lost" means role `lost`. Open = any other role or no role, excluding `lapsed`.
- Money: cents fields are divided by 100 before `formatEur`; euro fields are passed as is.
- Times shown to people (hours, weekdays, dates) use `timeZone: "Europe/Dublin"`. Range windows remain UTC days (slice-1 `resolveRange`).
- Widgets backed by a recorder (`stage_history`, `email_events`, `page_views`) render a "Collecting since <d MMM>" note when the recorder started after the range start, and still show whatever data exists.
- Unmet requirement (`site`, `sendingDomain`, `competitors`) renders one call-to-action instead of loading the widget.
- Sensitivity: `financial` for Marketing `blendedCac`, `roas`, `scoreboard`; `spend` for Email `credits`; everything else `general`.
- Loaders only read; no widget writes. No AI calls from any widget.
- Before deploy: `npm run typecheck`, `npm test`, `npx next build` pass; deploy with `railway up` from `app/` after merging to `main`.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/dashboard/types.ts` | Add `Requirement`, `requires` on `WidgetMeta`, `tenantId` + `recorderStart` on `WidgetCtx` |
| `src/lib/dashboard/requirements.ts` | `checkRequirements(tenantId)` + CTA copy |
| `src/lib/dashboard/data/stats.ts` | Pure: `median`, `pct`, `seriesBuckets`, `weekdayHourGrid`, `firstResponseTimes`, `timeInStage`, `velocityDays` |
| `src/lib/dashboard/data/{sales,marketing,email,communication}.ts` | Queries per domain (server) |
| `src/lib/dashboard/widgets/{sales,marketing,email,communication}.tsx` | Implementations |
| `src/components/dashboard/views/` | `BarListView`, `SeriesChart` (client), `DonutView` (client), `FunnelView`, `HeatmapView`, `TableView`, `CollectingNote`, `RequirementCta`; export `kpi` helper |
| `src/app/dashboard/page.tsx` | Build `tenantId`, `recorderStart`, requirement gate |
| `catalog.ts`, `presets.ts`, `widgets/keys.ts`, `widgets/index.ts` | Register |

---

### Task 1: Shared infrastructure

**Files:**
- Modify: `src/lib/dashboard/types.ts`, `src/app/dashboard/page.tsx`, `src/lib/dashboard/widgets/overview.tsx` (export `kpi` from a shared place)
- Create: `src/lib/dashboard/requirements.ts`, `src/lib/dashboard/data/stats.ts`, test `src/lib/dashboard/data/stats.test.ts`
- Create views: `src/components/dashboard/views/BarListView.tsx`, `SeriesChart.tsx`, `DonutView.tsx`, `FunnelView.tsx`, `HeatmapView.tsx`, `TableView.tsx`, `CollectingNote.tsx`, `RequirementCta.tsx`, `kpi.tsx`

**Interfaces (produced, used by Tasks 2-5 verbatim):**

```ts
// types.ts additions
export type Requirement = "site" | "sendingDomain" | "competitors";
export type RecorderKey = "stage_history" | "page_views" | "email_events" | "status_dates";
// WidgetMeta gains:   requires?: readonly Requirement[];  recorder?: RecorderKey;
// WidgetCtx gains:    tenantId: number;  recorderStart: (key: RecorderKey) => Date | null;
```

```ts
// requirements.ts (server)
export const REQUIREMENT_CTA: Record<Requirement, { title: string; body: string; href: string; action: string }>;
//  site:          "Add your website",       "This widget reads your website's data.",            "/cms",               "Open websites"
//  sendingDomain: "Connect a sending domain", "Email results appear once a verified domain sends.", "/campaigns/domains", "Connect domain"
//  competitors:   "Add competitors",        "Track local competitors to compare ratings.",        "/marketing/research","Open research"
export function checkRequirements(tenantId: number): Promise<Record<Requirement, boolean>>;
//  site:          (await getSiteAvailability()).siteCount > 0         (src/lib/campaigns/store.ts)
//  sendingDomain: getSendingDomain(tenantId)?.state === "verified"   (src/lib/marketing/domains.ts)
//  competitors:   listCompetitors({ trackedOnly: true, excludeSelf: true }).length > 0  (src/lib/research/store.ts)
// Each check in its own try/catch -> false on error.
```

```ts
// data/stats.ts (pure; no imports beyond types)
export function median(xs: number[]): number | null;                 // null for []
export function pct(part: number, whole: number): number | null;      // whole 0 -> null; rounded to 1 decimal
export type Bucket = { key: string; label: string; startMs: number; endMs: number };
export function seriesBuckets(fromMs: number, toMs: number): Bucket[];
//   days <= 31 -> one bucket per UTC day, key "YYYY-MM-DD", label "2 Oct"
//   else       -> one bucket per 7 days starting at fromMs, key = start ISO date, label "w/c 2 Oct"
export function bucketIndex(buckets: Bucket[], ms: number): number;   // -1 when outside
export function weekdayHourGrid(timestampsMs: number[], timeZone: string): number[][];
//   7 rows (Mon..Sun) x 24 cols counts in the given IANA zone (use Intl.DateTimeFormat parts)
export type Msg = { convo: string; direction: "inbound" | "outbound"; atMs: number; channel: string };
export function firstResponseTimes(msgs: Msg[]): { channel: string; minutes: number; inboundAtMs: number }[];
//   per conversation, time-ordered: an inbound message that starts an inbound run (previous message in that
//   conversation is not inbound, or none) is answered by the next outbound in the same conversation;
//   unanswered runs are omitted.
export type StageEv = { leadId: number; fromStageId: number | null; toStageId: number; atMs: number };
export function timeInStage(events: StageEv[]): Map<number, number[]>;
//   for each lead, consecutive events (sorted by atMs): duration of stage X = (event leaving X).atMs - (event entering X).atMs;
//   returns stageId -> durations in ms; stays still open are not counted.
export function velocityDays(events: StageEv[], wonStageIds: Set<number>, fromMs: number, toMs: number): number[];
//   for each lead whose FIRST move into a won stage falls in [fromMs, toMs): days from the lead's first event
//   (fromStageId null) to that won move; leads with no creation event in the log are skipped.
```

Views (props are the contract):
- `BarListView({ rows: { label: string; value: number; display?: string; sub?: string; href?: string }[]; empty: string; max?: number })` — server; horizontal bars like `StageBars`, `display` overrides the number shown.
- `SeriesChart({ data: Record<string, string | number>[]; xKey: string; series: { key: string; label: string; color?: string; dashed?: boolean }[]; kind?: "line" | "bar"; stacked?: boolean; height?: number })` — `"use client"`, recharts; colours default to `var(--accent)` then `var(--text-tertiary)`; tooltip; responsive container.
- `DonutView({ data: { label: string; value: number; color?: string }[]; height?: number; empty: string })` — `"use client"`; legend list beside the donut with value and percentage.
- `FunnelView({ steps: { label: string; value: number }[]; empty: string })` — server; each step a bar whose width is `value / first`; shows value and "% of first" and step-to-step conversion.
- `HeatmapView({ grid: number[][]; empty: string })` — server; 7x24 CSS grid, cell opacity `value / max`, weekday labels Mon..Sun, hour labels 0, 6, 12, 18; title attribute "Tue 14:00 - 5".
- `TableView({ columns: { key: string; label: string; align?: "left" | "right" }[]; rows: Record<string, string | number | null>[]; empty: string })` — server; horizontal scroll on narrow screens; `null` renders as a dash.
- `CollectingNote({ since: Date })` — server; one muted line "Collecting since 2 Oct" with a lucide `Clock` icon.
- `RequirementCta({ requirement: Requirement })` — server; title, body and a link button from `REQUIREMENT_CTA`.
- `kpi.tsx`: `export const kpi = (d: { value: string; sub?: string; delta?: number | null; accent?: boolean }) => <KpiTile ... />`; overview.tsx imports it instead of its local copy.

- [ ] **Step 1: Failing tests** `src/lib/dashboard/data/stats.test.ts`

```ts
// Run: npm test -- src/lib/dashboard/data/stats.test.ts
import assert from "node:assert/strict";
import { bucketIndex, firstResponseTimes, median, pct, seriesBuckets, timeInStage, velocityDays, weekdayHourGrid } from "./stats";

const H = 3_600_000, D = 86_400_000;

assert.equal(median([]), null);
assert.equal(median([5]), 5);
assert.equal(median([1, 9, 3]), 3);
assert.equal(median([1, 2, 3, 4]), 2.5);
assert.equal(pct(1, 3), 33.3);
assert.equal(pct(0, 0), null);

const from = Date.UTC(2026, 8, 26), to = Date.UTC(2026, 9, 3);
const days = seriesBuckets(from, to);
assert.equal(days.length, 7);
assert.equal(days[0].key, "2026-09-26");
assert.equal(days[6].label, "2 Oct");
assert.equal(bucketIndex(days, Date.UTC(2026, 8, 28, 13)), 2);
assert.equal(bucketIndex(days, to), -1);
const weeks = seriesBuckets(Date.UTC(2026, 6, 5), Date.UTC(2026, 9, 3));
assert.equal(weeks.length, 13);
assert.match(weeks[0].label, /^w\/c /);

// 2026-10-05 is a Monday. 09:30 UTC = 10:30 Dublin (IST).
const grid = weekdayHourGrid([Date.UTC(2026, 9, 5, 9, 30), Date.UTC(2026, 9, 5, 9, 45), Date.UTC(2026, 9, 11, 23, 0)], "Europe/Dublin");
assert.equal(grid.length, 7);
assert.equal(grid[0][10], 2, "Monday 10:00 Dublin");
assert.equal(grid[0][0], 1, "Sunday 23:00 UTC is Monday 00:00 Dublin");

const t0 = Date.UTC(2026, 9, 1, 9);
const fr = firstResponseTimes([
  { convo: "a", direction: "inbound", atMs: t0, channel: "whatsapp" },
  { convo: "a", direction: "inbound", atMs: t0 + 5 * 60_000, channel: "whatsapp" },
  { convo: "a", direction: "outbound", atMs: t0 + 30 * 60_000, channel: "whatsapp" },
  { convo: "b", direction: "inbound", atMs: t0, channel: "email" },
  { convo: "c", direction: "outbound", atMs: t0, channel: "sms" },
  { convo: "c", direction: "inbound", atMs: t0 + H, channel: "sms" },
  { convo: "c", direction: "outbound", atMs: t0 + 3 * H, channel: "sms" },
]);
assert.deepEqual(fr.map((r) => [r.channel, r.minutes]), [["whatsapp", 30], ["sms", 120]], "run start answered; b unanswered omitted");

const ev = [
  { leadId: 1, fromStageId: null, toStageId: 10, atMs: t0 },
  { leadId: 1, fromStageId: 10, toStageId: 11, atMs: t0 + 2 * D },
  { leadId: 1, fromStageId: 11, toStageId: 12, atMs: t0 + 5 * D },
  { leadId: 2, fromStageId: null, toStageId: 10, atMs: t0 },
  { leadId: 2, fromStageId: 10, toStageId: 12, atMs: t0 + 1 * D },
  { leadId: 3, fromStageId: 10, toStageId: 12, atMs: t0 + D },
];
const tis = timeInStage(ev);
assert.deepEqual(tis.get(10), [2 * D, 1 * D]);
assert.deepEqual(tis.get(11), [3 * D]);
assert.equal(tis.get(12), undefined, "still in stage 12: not counted");
assert.deepEqual(velocityDays(ev, new Set([12]), t0, t0 + 10 * D).sort(), [1, 5], "lead 3 has no creation event");
assert.deepEqual(velocityDays(ev, new Set([12]), t0 + 2 * D, t0 + 10 * D), [5], "won move must fall in range");

console.log("stats.test.ts: ok");
```

- [ ] **Step 2: Run, expect FAIL. Step 3: implement `stats.ts`** to the interface above (pure; `weekdayHourGrid` via `new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts`; map `Mon..Sun` to 0..6). Round `velocityDays` to one decimal. Test green.

- [ ] **Step 4: Types + context + gate.**
  - `types.ts`: add the types/fields above (`requires` and `recorder` optional on `WidgetMeta`).
  - `page.tsx`: set `tenantId` on every ctx; `recorderStart` = a memoised wrapper over `getRecorderStart` (`src/lib/recorders/startedStore.ts`); compute `const reqs = await checkRequirements(tenantId)` once; for a widget whose `meta.requires` has an unmet entry, render `<RequirementCta requirement={firstUnmet} />` as the tile node instead of the `WidgetSlot` (no `load` runs).
  - In `WidgetSlot` (or a small wrapper), when `meta.recorder` is set and `ctx.recorderStart(meta.recorder)` is null or after `ctx.range.fromMs`, render `<CollectingNote since={...} />` above the widget body (null start: "Collecting since today").
  - Export `kpi` from `views/kpi.tsx` and use it in `overview.tsx`.
- [ ] **Step 5: Views.** Implement the eight view components to the props above, matching the existing tile style (CSS variables `--accent`, `--text-*`, `--surface-2`, `--hairline`; no hardcoded palette beyond the existing green/red used in KpiTile). Charts are client components; everything else server-safe.
- [ ] **Step 6:** typecheck, full suite, build. Commit `feat(dashboard): shared views, requirement gate and collecting-since note for presets`.

---

### Task 2: Sales preset

**Files:** Create `src/lib/dashboard/data/sales.ts`, `src/lib/dashboard/widgets/sales.tsx`, test `src/lib/dashboard/data/sales.test.ts`; modify `catalog.ts`, `widgets/keys.ts` (`SalesKey`), `widgets/index.ts`, `presets.ts`, `presets.test.ts`.

**Catalog** (all `domain: "sales"`, `venues: ["clinic","gym"]`, `sensitivity: "general"`):

| key | title | sizes / default | rangeMode | recorder |
|---|---|---|---|---|
| `sales.newLeads` | New leads | S,M / S | tab | |
| `sales.conversionRate` | Conversion rate | S,M / S | tab | |
| `sales.wonThisPeriod` | Won this period | S,M / S | tab | stage_history |
| `sales.openPipeline` | Open pipeline | S,M / S | none | |
| `sales.funnel` | Funnel by stage | L,XL / XL | tab | stage_history |
| `sales.stageDistribution` | Leads by stage now | M,L / M | none | |
| `sales.timeInStage` | Average time in stage | M,L / M | tab | stage_history |
| `sales.leadsBySource` | Leads by source | M,L / M | tab | |
| `sales.conversionBySource` | Conversion by source | M,L / M | tab | |
| `sales.conversionByService` | Conversion by service | M,L / M | tab | |
| `sales.staleLeads` | Stale leads | M,L,XL / L | none | |
| `sales.velocity` | Lead to won | S,M / S | tab | stage_history |
| `sales.wonLostTrend` | Won and lost | L,XL / L | tab | stage_history |
| `sales.leadsByCampaign` | Leads by campaign | M,L / M | tab | |
| `sales.slaBreaches` | Waiting over an hour | S,M / S | none | |

Write a one-sentence `description` for each that states its definition (e.g. "Share of leads created in the period that are now in a won stage.").

**Data semantics** (`data/sales.ts`; all leads across all pipelines unless stated; "in range" = `createdAt >= fromMs && < toMs`):
- `newLeads`: count in range vs previous; KPI with `deltaPct`.
- `conversionRate`: of leads created in range, % whose current stage role is won; delta vs previous cohort (percentage points shown as delta of the two pcts via `deltaPct`). Sub: "`x` of `y` leads".
- `wonThisPeriod`: distinct leads with a `lead_stage_events` row in range whose `toStageId` has a won role and `fromStageId` is null or not won. Delta vs previous.
- `openPipeline`: leads whose current stage role is not won/repeat/lost/lapsed (null role counts as open). Sub: "across N pipelines".
- `funnel`: default pipeline stages in position order excluding `lost` and `lapsed`; value = distinct leads with an event INTO that stage in range. `FunnelView`.
- `stageDistribution`: current counts per stage of the default pipeline (`BarListView`, `display` "n (p%)").
- `timeInStage`: `timeInStage()` over the default pipeline's events with `atMs < toMs` whose leaving event falls in range; per stage average in days (1 decimal), `BarListView` ordered by stage position; stages with no completed stays omitted.
- `leadsBySource`: group in-range leads by `source` (top 8 + "Other"); `BarListView`.
- `conversionBySource` / `conversionByService`: group in-range leads by `source` / `therapyInterest` (null -> "Not stated"); show groups with at least 3 leads, `display` "p% (won/total)", sorted by pct desc. Service title uses vocab via `label: (ctx) => \`Conversion by ${ctx.vocab.services.toLowerCase().replace(/s$/, "")}\`` (check vocab field names).
- `staleLeads`: leads not in won/repeat/lost stages with `now - updatedAt > 7 days` (mirror `isStale` semantics from `boardMetrics.ts`), oldest first, top 10; `RowList` rows: name, stage name, "N days".
- `velocity`: `median(velocityDays(...))` in days for the default + all pipelines' won stage ids; KPI "n days", sub "median, lead to won"; null -> "No wins yet".
- `wonLostTrend`: `seriesBuckets` over range; per bucket count events into won roles and into lost; `SeriesChart` bars, two series "Won", "Lost".
- `leadsByCampaign`: in-range leads with non-null `campaign`, grouped; `BarListView`; empty "No campaign leads in this period."
- `slaBreaches`: entry-stage leads with no first outbound (use `listLeadsForBoard()` `firstOutboundAt === null`) waiting more than 1 hour (`slaTone(waitingMs) === "red"`); KPI with `accent` when > 0; href `/leads`.

Pure helpers to put in `data/sales.ts` (exported, tested in `sales.test.ts` with fixture rows, no DB): `conversionByGroup(leads: { group: string | null; won: boolean }[], minSize = 3)`, `topNWithOther(rows: { label: string; value: number }[], n)`.

**Preset** `sales` — name "Sales", icon `TrendingUp`, description "Pipeline health, conversion and where your best leads come from.", same layout both venues:
`newLeads S, conversionRate S, wonThisPeriod S, openPipeline S, funnel XL, stageDistribution M, timeInStage M, leadsBySource M, conversionBySource M, conversionByService M, leadsByCampaign M, staleLeads L, slaBreaches S, wonLostTrend L, velocity S`.

- [ ] Steps: tests for the pure helpers (RED, then GREEN), data queries, widgets, catalog, keys/index, preset + `presets.test.ts` addition (preset exists, validates, 15 widgets), typecheck, full suite, build, commit `feat(dashboard): Sales preset`.

---

### Task 3: Marketing preset

**Files:** `data/marketing.ts`, `widgets/marketing.tsx`, test `data/marketing.test.ts`; registry files as in Task 2.

**Catalog** (`domain: "marketing"`, both venues):

| key | title | sizes / default | rangeMode | sensitivity | requires / recorder |
|---|---|---|---|---|---|
| `marketing.activeCampaigns` | Active campaigns | S,M / S | none | general | |
| `marketing.campaignLeads` | Leads from campaigns | S,M / S | tab | general | |
| `marketing.blendedCac` | Cost per customer | S,M / S | none | financial | |
| `marketing.roas` | Return on ad spend | S,M / S | none | financial | |
| `marketing.scoreboard` | Campaign scoreboard | L,XL / XL | none | financial | |
| `marketing.landingFunnel` | Landing page views to leads | M,L,XL / L | tab | general | site; page_views |
| `marketing.visitorsTrend` | Website visitors | L,XL / L | tab | general | site; page_views |
| `marketing.trafficSources` | Traffic sources | M,L / M | tab | general | site; page_views |
| `marketing.formSubmissions` | Form submissions | S,M / S | tab | general | |
| `marketing.upcomingSends` | Coming up | M,L / M | none | general | |
| `marketing.seasonalDates` | Seasonal dates | M,L / M | none | general | |
| `marketing.ratingGap` | Rating vs competitors | S,M / S | none | general | competitors |

**Data semantics:**
- `activeCampaigns`: `listCampaigns()` with status `active`; sub "N ready to launch" (status `ready`).
- `campaignLeads`: leads in range with non-null `campaign`; delta.
- Scoreboard set: campaigns with status `active` or `complete`; for each `getCampaignScoreboard(campaign, aiBuildCents)` (read how existing callers get `aiBuildCents`; if it needs a query per campaign, reuse that helper; memoise via `cached(ctx, "marketing.scoreboards", ...)` so the four money widgets share one computation).
  - `blendedCac`: total ad spend cents / total converts across the set; KPI `formatEur(cents/100)`; sub "All time, N campaigns"; null when no converts -> "No customers yet".
  - `roas`: (sum upfrontCash + sum mrr) / total ad spend, shown "3.2x"; null when no spend -> "No ad spend recorded".
  - `scoreboard`: `TableView` columns Campaign, Status, Leads, Customers, Conversion, Cost per customer, ROAS; sub-header "All time".
- `landingFunnel`: for each `active`/`complete` campaign with a landing page (find how the landing URL path is built: `/c/<slug>` on the site, see `src/app/site/[siteSlug]/c/[campaignSlug]/page.tsx`), views in range = sum of `site_page_views_daily.views` where `path = '/c/<slug>'`; leads in range for that campaign name; `TableView` Campaign, Views, Leads, View to lead %.
- `visitorsTrend`: `site_visitors_daily` summed across the tenant's sites per bucket (`seriesBuckets`), with a dashed previous-period series aligned by bucket index; sub total uniques and delta.
- `trafficSources`: `site_page_views_daily` in range grouped by `utm_source` if non-empty else `referrer_domain` if non-empty else "Direct"; sum views; top 8 + Other; `BarListView`.
- `formSubmissions`: `form_submissions` rows in range (all forms; scope by tenant if the table has `tenant_id`), delta; href `/forms`.
- `upcomingSends`: next 14 days: `scheduled_posts` (status `scheduled`) and `email_campaigns` (status `scheduled`, `scheduledAt >= now`), merged by time, top 8; `RowList` primary = name, secondary = "Social post" / "Email", meta = Dublin date-time.
- `seasonalDates`: `upcomingDates(todayIso, 60)` from `src/lib/marketing/seasonalCalendar.ts`, top 6; `RowList` primary name, secondary angle, meta "in N days".
- `ratingGap`: `getSelfCompetitor()` latest rating vs average latest rating of tracked non-self competitors (`ratingMilli / 1000`); KPI "4.6 vs 4.3"; delta field unused; sub "Google rating, N competitors"; no self row -> "Add your own business in Research".

Pure helpers (tested): `cacCents(spendCents, converts)`, `roasRatio(revenueCents, spendCents)`, `sourceLabel(utm, referrer)`, `mergeUpcoming(posts, emails, limit)`.

**Preset** `marketing` — "Marketing", icon `Megaphone`, "Campaign returns, website traffic and what is coming up.":
`activeCampaigns S, campaignLeads S, blendedCac S, roas S, scoreboard XL, landingFunnel L, formSubmissions S, visitorsTrend L, ratingGap S, trafficSources M, upcomingSends M, seasonalDates M`.

- [ ] Steps as Task 2. Commit `feat(dashboard): Marketing preset`.

---

### Task 4: Email preset

**Files:** `data/email.ts`, `widgets/email.tsx`, test `data/email.test.ts`; registry files.

**Catalog** (`domain: "email"`, both venues):

| key | title | sizes / default | rangeMode | sensitivity | requires / recorder |
|---|---|---|---|---|---|
| `email.subscribers` | Subscribers | S,M / S | tab | general | |
| `email.openRate` | Open rate | S,M / S | tab | general | sendingDomain |
| `email.clickRate` | Click rate | S,M / S | tab | general | sendingDomain |
| `email.credits` | Email credits | S,M / S | none | spend | |
| `email.listGrowth` | List growth | L,XL / L | tab | general | |
| `email.statusMix` | Contact status | M,L / M | none | general | |
| `email.campaignTable` | Campaign performance | L,XL / XL | tab | general | sendingDomain |
| `email.engagementTrend` | Opens and clicks | L,XL / XL | tab | general | sendingDomain; email_events |
| `email.topLinks` | Top clicked links | M,L / M | tab | general | sendingDomain; email_events |
| `email.sendTimeHeatmap` | When people open | M,L / M | tab | general | sendingDomain; email_events |
| `email.deliverability` | Deliverability | M,L / M | tab | general | sendingDomain |
| `email.suppressions` | Suppressions | M,L / M | none | general | |
| `email.sendsThisMonth` | Sends this month | S,M / S | pinned month | general | |
| `email.contactSources` | Contacts by source | M,L / M | none | general | |

**Data semantics:**
- Rates from a campaign's `stats.counts` (statuses are exclusive and forward-only): `reached = delivered + opened + clicked + unsubscribed + complained`; `opens = opened + clicked`; `openRate = opens / reached`; `clickRate = clicked / reached`; `bounceRate = bounced / (reached + bounced)`; `complaintRate = complained / (reached + bounced)`. Pure `campaignRates(counts)` tested.
- Campaigns "in range" = `email_campaigns` with `sentAt` in range.
- `subscribers`: contacts with status `subscribed` now; sub "+a / -u this period" where a = contacts with `subscribedAt ?? createdAt` in range and status ever subscribed, u = `unsubscribedAt` in range; delta = net vs previous net.
- `openRate` / `clickRate`: recipient-weighted over in-range campaigns (sum the counts, then the formula); delta vs previous period.
- `credits`: `getEmailBalanceCents(ctx.tenantId)`; sub "Sending paused" if `isMarketingSuspended`.
- `listGrowth`: per bucket adds vs unsubscribes (`SeriesChart` bars, two series).
- `statusMix`: contacts grouped by status (`DonutView`, fixed colours: subscribed accent, others muted).
- `campaignTable`: in-range campaigns newest first, max 12: Campaign, Sent (Dublin date), Recipients (sum counts), Delivered %, Open %, Click %, Bounce %, Unsubscribe %.
- `engagementTrend`: `email_events` in range, events `opened` and `clicked`, per bucket total and unique-by-`send_id`; four series (opens, unique opens dashed, clicks, unique clicks dashed).
- `topLinks`: `clicked` events in range grouped by `url` (strip query string for grouping), count and unique sends, top 8; `BarListView` label = host + path truncated.
- `sendTimeHeatmap`: `weekdayHourGrid(opened event times, "Europe/Dublin")`.
- `deliverability`: in-range bounce and complaint rates with thresholds 2% and 0.1%; two rows "Bounce rate 0.8% (healthy under 2%)" with a red tone when over; `BarListView` or a small custom body.
- `suppressions`: `suppressions` grouped by reason; `BarListView`; sub "N total".
- `sendsThisMonth`: `getSentThisMonth(tenantId)` vs `getTenantIncludedSends(tenantId)` (check the exact name/shape in `src/lib/email/included.ts`): KPI "1,240 of 5,000", accent when over.
- `contactSources`: contacts grouped by `source` (null -> "Unknown"), top 8 + Other.

**Preset** `email` — "Email", icon `Mail`, "List health, campaign results and deliverability.":
`subscribers S, openRate S, clickRate S, credits S, listGrowth L, sendsThisMonth S, campaignTable XL, engagementTrend XL, topLinks M, sendTimeHeatmap M, deliverability M, statusMix M, suppressions M, contactSources M`.

- [ ] Steps as Task 2. Commit `feat(dashboard): Email preset`.

---

### Task 5: Communication preset

**Files:** `data/communication.ts`, `widgets/communication.tsx`, test `data/communication.test.ts`; registry files.

**Catalog** (`domain: "communication"`, both venues, all `general`):

| key | title | sizes / default | rangeMode |
|---|---|---|---|
| `communication.unread` | Unread emails | S,M / S | none |
| `communication.inbound` | Messages in | S,M / S | tab |
| `communication.firstResponse` | First response time | S,M / S | tab |
| `communication.autoReplyRate` | AI auto-replies | S,M / S | tab |
| `communication.byChannel` | Volume by channel | M,L / M | tab |
| `communication.inOutTrend` | In and out | L,XL / L | tab |
| `communication.responseByChannel` | Response time by channel | M,L / M | tab |
| `communication.triageCategories` | What people write about | M,L / M | tab |
| `communication.priorityMix` | Priority | S,M / S | tab |
| `communication.busiestHours` | Busiest hours | M,L / M | tab |
| `communication.awaitingReply` | Awaiting reply | L,XL / XL | none |
| `communication.topTags` | Top tags | M,L / M | tab |
| `communication.automations` | Automated messages | M,L / M | tab |

**Data semantics** ("messages" = `lead_messages` + `client_messages`, excluding `direction = 'note'` and channels `manual`/`system`; time = `sentAt ?? createdAt`; plus Gmail `email_messages` with `direction in/out` as channel "email", time = `internalDate`):
- `unread`: `email_messages` `direction = 'in'` and `isRead = false`; accent when > 0; href `/communication`.
- `inbound`: inbound messages in range; delta.
- `firstResponse`: `median(firstResponseTimes(msgs).minutes)` over messages whose inbound time is in range (load from `fromMs - 7 days` so replies near the start pair correctly); shown "42 min" / "3.5 h" / "2.1 days"; delta vs previous; sub "median, N conversations". Conversation key: `lead:<id>`, `client:<id>`, Gmail `thread:<gmailThreadId>`.
- `autoReplyRate`: of inbound lead/client messages triaged in range (`aiTriagedAt` in range), share with `autoReplyStatus = 'auto_sent'`; sub "N drafted for review" (`drafted` + `held`).
- `byChannel`: in + out counts per channel in range; `BarListView` `display` "in / out".
- `inOutTrend`: per bucket inbound vs outbound (`SeriesChart` lines).
- `responseByChannel`: median minutes per channel from `firstResponseTimes`; `BarListView` with formatted `display`.
- `triageCategories`: inbound in range grouped by `aiCategory` (null -> "Not triaged"), human labels (`new_lead` "New enquiry", `booking` "Booking", `existing_client` "Existing client", `faq` "Question", `sensitive` "Sensitive", `spam` "Spam", `other` "Other"); `DonutView`.
- `priorityMix`: inbound in range by `aiPriority`; KPI value = high count, sub "high priority, N normal, N low", accent when high > 0.
- `busiestHours`: `weekdayHourGrid(inbound times in range, "Europe/Dublin")`.
- `awaitingReply`: `listConversations()` where `lastDirection` is inbound, oldest `lastAt` first, top 10; `RowList` primary name, secondary channel + AI summary (truncate 80), meta "waiting 3 h"; href each row's `href`. Note: `listConversations()` loads all messages; wrap in `cached`.
- `topTags`: `conversation_tags` added in range grouped by tag label; `BarListView` with tag colour ignored (keep theme).
- `automations`: `automation_queue` in range by status: sent (`sentAt` in range), failed, still queued (`dueAt` in range and status queued); `BarListView`.

Pure helpers (tested): `formatDuration(minutes)`, `channelOf(row)`, `categoryLabel(cat)`, plus `firstResponseTimes` reuse.

**Preset** `communication` — "Communication", icon `MessagesSquare`, "Inbox volume, how fast you reply and what people ask about.":
`unread S, inbound S, firstResponse S, autoReplyRate S, inOutTrend L, priorityMix S, byChannel M, responseByChannel M, triageCategories M, busiestHours M, awaitingReply XL, topTags M, automations M`.

- [ ] Steps as Task 2. Commit `feat(dashboard): Communication preset`.

---

### Task 6: Verify, merge, deploy

- [ ] `npm run typecheck && npm test && npx next build`.
- [ ] Local visual pass (Playwright script as in slice 1, local QA sessions on the dev DB, removed afterwards): add each of the four presets as a tab on a clinic tenant, screenshot each, confirm no tile errors, the requirement CTAs show where expected, charts render, staff session hides the three financial Marketing widgets and Email credits, phone width has no horizontal scroll. Fix anything visibly broken.
- [ ] Merge to `main` (`--no-ff`), push, `railway up` from `app/`, poll to SUCCESS (redeploy once on a transient `next/font` fetch failure), health check.

## Self-review notes

- Spec section 3 presets 1-4 covered widget-for-widget; renamed keys where clearer. "Best send time" is the opens heatmap. Spec's "conversion by therapy" is `conversionByService` (vocab-aware).
- Deferred to slice 4: Front desk/Classes, Finance, Content, Website, Competitors, AI presets.
- Known approximations surfaced in widget descriptions: first response pairs inbound runs with the next outbound; campaign money is all time.
