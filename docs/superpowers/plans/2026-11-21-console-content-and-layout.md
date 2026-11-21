# Console Content and Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The platform console (`admin/`) gets these changes:
- a dashboard that leads with problems per business and a "This week" activity table;
- a Businesses list whose filters and columns say what they mean;
- Platform switches on their own page, plus a banner;
- a Feature flags table with descriptions;
- grouped Settings;
- a wider 1440px layout.

**Architecture:**
- **Data:** `app/` gains one platform endpoint (`/api/platform/activity`) and small additions to existing responses (the stage rules, risk reason, last login, failed-queue reason, module blurbs).
- **Pages:** `admin/` rebuilds five pages on its existing components and CSS tokens.
- **Deploys:** the two apps deploy separately.

**Tech Stack:**
- Next.js 15 App Router in both apps.
- `app/`: better-sqlite3 + drizzle, one DB per tenant (`getTenantDbById`), control-plane `controlSqlite`.
- `admin/`: a server-component console that calls `app/` with `api<T>(path, { revalidate, tags })` from `admin/src/lib/api.ts`.

**Spec:** `docs/superpowers/specs/2026-11-21-console-content-and-layout-design.md`. Read it; it is the source of truth for copy and columns.

**Visual reference (open in a browser):**
- `.superpowers/brainstorm/40528-1795274299/content/console-dashboard.html`, option C;
- `.superpowers/brainstorm/40528-1795274299/content/console-pages.html`.

**Note on code in this plan:**
- **Logic tasks** carry exact code and tests.
- **UI tasks** carry exact structure, copy, classes and behaviour, but not every JSX line. Implementers must read the named existing component first and follow its patterns:
  - `.card`, `.card-title`, `.chip` (inline chip colours via `backgroundColor`, never `background`), `.toolbar`, `.biz-mark`;
  - `PageHeader`, `DataTable`, `useConfirm`, toasts.
- Memory note `console-design-system` lists these.

## Global Constraints

- **No emojis** anywhere (UI, code, comments, commits).
- **Copy:** sentence case. "program", not "programme". Statuses in plain words.
- **Colours:** existing CSS tokens in `admin/src/app/globals.css` only, with no new colours: `--green #3fb950`, `--amber #f2c14e`, `--red #f0809a`, the text and surface tokens.
- **Controls:** at least 36px high. Selects keep the existing 36px right padding for the chevron.
- **Widths:** pages work at 1280px and 1600px. Below 1100px tables scroll inside their card, never the page.
- **Fail-soft:** a missing field or failed fetch shows "-" or hides a section. It never crashes a page.
- **Next 15 trap:** a server component cannot pass a function prop to a client component.
- **Two apps, two test commands:**
  - `app/`: `cd app && npx tsc --noEmit -p . 2>&1 | grep -v "^.next/"` (no output), `npm test -- <file>` for one test, `npm test` for all.
  - `admin/`: `cd admin && npm run typecheck`, `npm test`.
- **Git:** never `git add -A`. Add only the files you changed. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1 (app): Stage rules, risk reason and last login on fleet rows

**Files:**
- Modify: `app/src/lib/platform/tenantMeta.ts` (`Stage`, `STAGES`, `StageFacts`, `defaultStage`)
- Modify: `app/src/lib/platform/fleet.ts` (the enrichment around lines 150-170, and the fleet row type and serialiser)
- Modify: `admin/src/lib/types.ts` (the fleet row type gains the new fields; the type only)
- Test: `app/src/lib/platform/stage.test.ts` (new, pure)

**Interfaces:**
- Produces:
  - `type Stage = "trial" | "onboarding" | "active" | "at_risk" | "churned" | "not_launched" | "internal"`.
  - `StageFacts` gains `members: number`.
  - Each `/fleet` business row gains:
    - `riskReason: string | null`, the first of `churnRisk(...).reasons`;
    - `lastLoginAt: number | null`, ms, the latest staff `last_login_at`;
    - `members: number`.

- [ ] **Step 1: Write the failing test**

```ts
// Run: cd app && npx tsx src/lib/platform/stage.test.ts
import assert from "node:assert/strict";

import { defaultStage, STAGES, type StageFacts } from "./tenantMeta";

const base: StageFacts = { archived: false, billingStatus: null, exempt: true, setupRequiredDone: 6, setupRequiredTotal: 7, riskScore: 20, members: 48 };

// A business in real use reads Live even with a setup step open.
assert.equal(defaultStage(base), "active");
// New, incomplete and nobody using it: setting up.
assert.equal(defaultStage({ ...base, members: 0, setupRequiredDone: 3 }), "onboarding");
// Complete setup and no members is still live (an agency business before launch is set by hand).
assert.equal(defaultStage({ ...base, members: 0, setupRequiredDone: 7 }), "active");
// Existing rules keep their order.
assert.equal(defaultStage({ ...base, archived: true }), "churned");
assert.equal(defaultStage({ ...base, exempt: false, billingStatus: "pending_payment" }), "trial");
assert.equal(defaultStage({ ...base, riskScore: 70 }), "at_risk");
// The two hand-set stages exist but are never chosen automatically.
assert.ok(STAGES.includes("not_launched") && STAGES.includes("internal"));
for (const f of [base, { ...base, members: 0 }, { ...base, exempt: false, billingStatus: "active" }]) {
  assert.ok(!["not_launched", "internal"].includes(defaultStage(f)));
}
console.log("stage: ok");
```

- [ ] **Step 2: Run the test.** `cd app && npx tsx src/lib/platform/stage.test.ts`. Expected: FAIL (a type error on `members`, or wrong stages).

- [ ] **Step 3: Implement in `tenantMeta.ts`**

```ts
export type Stage = "trial" | "onboarding" | "active" | "at_risk" | "churned" | "not_launched" | "internal";
export const STAGES: Stage[] = ["trial", "onboarding", "active", "at_risk", "churned", "not_launched", "internal"];
```

Add `members: number;` to `StageFacts`, with the doc comment `/** Clients on the business's books: a business with any is in real use. */`. Change the onboarding line in `defaultStage` to:

```ts
  // Setting up only while setup is incomplete AND nobody is using it yet: a
  // business with members is live even with a step still open.
  if (f.setupRequiredDone < f.setupRequiredTotal && f.members === 0) return "onboarding";
```

Check the `tenant_meta.stage` column accepts the new values. If there is a CHECK constraint or validation (a grep for `STAGES` usage in the PATCH route that sets stage), make sure it uses `STAGES`.

- [ ] **Step 4: Implement in `fleet.ts`**

In the enrichment:
- Compute `members`, the count of clients in that tenant's DB. Reuse `tenantUsage(id).clients` from `app/src/lib/platform/queries.ts:135` if it reads by id; otherwise run `SELECT COUNT(*) FROM clients` via `getTenantDbById(id)`. Wrap it in the existing try.
- Pass `members` into `getTenantMeta(...)`.
- Keep `rk.reasons[0] ?? null` as `riskReason`.

Then:
- Compute `lastLoginAt` as `SELECT MAX(u.last_login_at) FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.tenant_id = ?` against `controlSqlite`. Confirm the column names in `app/src/lib/db/control.ts`. `churnRisk.ts:53` already does the same MAX, so reuse it if it is exported.
- Add `members`, `riskReason` and `lastLoginAt` to the cached enrichment value and to the business row the `/fleet` route returns.
- Mirror the three fields as optional in `admin/src/lib/types.ts`, so an older app deploy doesn't break the console.

- [ ] **Step 5: Run the tests.** `npx tsx src/lib/platform/stage.test.ts` should print `stage: ok`. Run `npm test -- src/lib/platform/fleet.test.ts` if it exists, and the app typecheck.

- [ ] **Step 6: Commit** `feat(platform): stage reads Live for businesses in use; fleet rows carry risk reason, last login, members`.

---

### Task 2 (app): Failed-queue alerts say why

**Files:**
- Modify: `app/src/lib/platform/health.ts` (the queue reading, and the alert loop near line 180)
- Modify: `app/src/lib/platform/alertSources.ts:105-111`, to pass `detail`
- Test: `app/src/lib/platform/queueReason.test.ts` (new, pure)

**Interfaces:**
- Produces:
  - `export function queueReason(raw: string | null | undefined): string | null`. It trims and collapses whitespace, cuts to 120 characters with an ellipsis, and returns null for empty input.
  - `HealthAlert` gains `detail?: string | null`.
  - `buildFleetCandidates` passes `detail: a.detail ?? null`. Check that `AlertCandidate` and `syncPlatformAlerts` already store `detail`; `PlatformAlert` has a `detail` field.

- [ ] **Step 1: Write the failing test**

```ts
// Run: cd app && npx tsx src/lib/platform/queueReason.test.ts
import assert from "node:assert/strict";

import { queueReason } from "./queueReason";

assert.equal(queueReason(null), null);
assert.equal(queueReason("   "), null);
assert.equal(queueReason("  WhatsApp\n  not connected "), "WhatsApp not connected");
const long = "x".repeat(200);
assert.equal(queueReason(long)!.length, 120);
assert.ok(queueReason(long)!.endsWith("..."));
console.log("queueReason: ok");
```

- [ ] **Step 2: Run it.** It should FAIL because the module is missing.

- [ ] **Step 3: Implement** `app/src/lib/platform/queueReason.ts`:

```ts
/** The reason shown under a failed-queue alert: the latest failure's error, tidied. */
export function queueReason(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}
```

- [ ] **Step 4: Wire it**
- In `health.ts`, find where each queue's `failed` count is read; the `queues` array has key, label and failed.
- For each queue whose table has an error column on failed rows, also read the most recent failed row's error. Look up the queue's table in the same function, and check the schema for a column like `error`, `last_error` or `failure_reason`.
- Pass it through `queueReason` and set it as the alert's `detail`. Queues without an error column get `detail: null`.
- In `alertSources.ts`, add `detail: a.detail ?? null` to the candidate.

- [ ] **Step 5:** Run the test, the existing alert/health tests (`ls app/src/lib/platform/*.test.ts`; run the ones about health and alerts), and the typecheck.

- [ ] **Step 6: Commit** `feat(platform): failed-queue alerts carry the latest error as their reason`.

---

### Task 3 (app): `/api/platform/activity`

**Files:**
- Create: `app/src/lib/platform/activity.ts`
- Create: `app/src/app/api/platform/activity/route.ts` (copy the shape of `app/src/app/api/platform/analytics/route.ts`: `guardPlatform(req)`, then JSON)
- Modify: `admin/src/lib/types.ts` (add the `ActivityRow` and `ActivityResponse` types)
- Test: `app/src/lib/platform/activityWindows.test.ts` (pure) and `app/src/lib/platform/activity.test.ts` (DB, `npm test --`)

**Interfaces:**
- Produces, in `activity.ts`:

```ts
export interface ActivityRow {
  tenantId: number;
  name: string;
  slug: string;
  setup: { done: number; total: number } | null;
  lastLoginAt: number | null;
  membersActive7d: number | null;
  bookings7d: number | null;
  bookingsPrev7d: number | null;
  leads7d: number | null;
  salesCents7d: number | null;
  aiCentsThisMonth: number | null;
}
export interface ActivityResponse { rows: ActivityRow[]; generatedAt: number }
/** Pure: the two 7-day windows ending at `now` (ms). */
export function weekWindows(now: number): { thisStart: number; prevStart: number; end: number };
export function getFleetActivity(now?: number): ActivityResponse;
```

- [ ] **Step 1: Pure test** (`activityWindows.test.ts`):

```ts
import assert from "node:assert/strict";

import { weekWindows } from "./activity";

const now = Date.UTC(2026, 10, 21, 12, 0, 0);
const w = weekWindows(now);
assert.equal(w.end, now);
assert.equal(w.thisStart, now - 7 * 86400000);
assert.equal(w.prevStart, now - 14 * 86400000);
console.log("activityWindows: ok");
```

- [ ] **Step 2: Implement `activity.ts`**

`weekWindows` is exact per the test. `getFleetActivity` works as follows:
- Each non-archived tenant from the control-plane registry is handled the same way `getPlatformAnalytics` (`app/src/lib/platform/analytics.ts:371-418`) iterates `activeTenants`. Reuse that list function.
- Per tenant, inside `try { ... } catch { leave that row's tenant-DB fields null }`, read with `getTenantDbById(t.id)` (never `runWithTenant` plus request helpers; see the memory trap: `getCurrentTenant()` ignores `runWithTenant`):
  - **bookings7d / bookingsPrev7d:** count class bookings (`sessionBookings`, schema ~line 2143) whose session starts in the window, plus `appointments` (schema line 167) whose start is in the window and whose status is not cancelled. Read the schema for the exact column names, and state them in your report.
  - **leads7d:** `leads.created_at` (schema line 339) in [thisStart, end).
  - **salesCents7d:** the sum of `offer_orders.amount_cents` (schema ~3596) with status `paid` and paid/created time in the window.
  - **membersActive7d:** clients active in the member app in the window. Use `client_credentials.last_login_at` or whatever last-seen the client app records (grep `lastSeen`/`last_login_at` for client sessions). If no such data exists, return null and say so in your report.
- Control-plane reads per tenant, also in a try:
  - `lastLoginAt`, the same query as Task 1 (import that helper);
  - `aiCentsThisMonth` from `getMonthlyUsageCents(tenantId, yyyymm)` (`app/src/lib/ai/usage.ts:77`);
  - `setup` from `getSetupSummaryForTenant(id)`.
- The rows are returned in registry order. The console sorts them.

- [ ] **Step 3: DB test** (`activity.test.ts`). Model it on `app/src/lib/social/fillLead.test.ts`: the `Module._load` stubs for `react` and `next/navigation`, then create a throwaway tenant in `controlSqlite`.
  - Inside `runWithTenant(tid, ...)`, insert two leads: one 2 days ago, one 10 days ago.
  - Insert one paid `offer_orders` row of 6400 cents 1 day ago, using the existing store function if there is one.
  - Assert that `getFleetActivity().rows` holds a row for the tenant with `leads7d === 1` and `salesCents7d === 6400`.
  - Also register a second tenant whose `db_file` points at a directory path that can't open. Assert that its row exists with null tenant-DB fields, not a throw.
  - Clean up both tenants in `finally`.

- [ ] **Step 4: Route.** `app/src/app/api/platform/activity/route.ts` returns `NextResponse.json(getFleetActivity())` after `guardPlatform`.

- [ ] **Step 5:** Run both tests and the typecheck.

- [ ] **Step 6: Commit** `feat(platform): weekly activity per business for the console`.

---

### Task 4 (app): Module blurbs in `/flags`

**Files:**
- Modify: `app/src/lib/platform/flags.ts` (line ~17) and its route, if the shape is built there
- Modify: `admin/src/lib/types.ts`

**Interfaces:**
- Produces: the `/flags` response gains `modules: { key: string; label: string; blurb: string }[]`, built from `MODULE_CATALOG` in `app/src/lib/features.ts:32+`. Read its fields: `key`, `label` or `name`, `blurb`. Include only the keys that appear in `flags`.

- [ ] **Step 1:** Add the field. Extend an existing flags test if there is one (`ls app/src/lib/platform/flags*.test.ts`) with an assertion that `modules` has one entry per flag and each entry has a non-empty blurb. Otherwise add a 10-line pure test that maps `MODULE_CATALOG` the same way.
- [ ] **Step 2:** Run the typecheck and the test.
- [ ] **Step 3: Commit** `feat(platform): flags response carries each module's label and description`.

---

### Task 5 (admin): Wider shell, Platform switches page, banner

**Files:**
- Modify: `admin/src/app/globals.css`: `.app-page` `max-width: 1160px` becomes `1440px` (at ~line 474). Also tighten table cell padding to `11px 12px` where the console table class sets it; grep `td {` and `.dt td`.
- Create: `admin/src/app/(console)/switches/page.tsx`
- Create: `admin/src/components/fleet/SwitchesBanner.tsx` (server component)
- Modify: `admin/src/app/(console)/layout.tsx` (render the banner above the page content)
- Modify: `admin/src/components/Shell.tsx` (nav item "Platform switches", href `/switches`, under Console after Feature flags; use a `lucide-react` icon such as `Power`)
- Modify: `admin/src/app/(console)/gyms/page.tsx` (remove `<KillSwitches>` and its import)
- Modify or reuse: `admin/src/components/fleet/KillSwitches.tsx`. Read it first; it has the toggle action and copy.

**Behaviour** (copy from the spec, section 4; visual from `console-pages.html` panel 3):
- **The page:** `PageHeader` with eyebrow "Console", title "Platform switches", and sub "Emergency stops for every business at once. Nothing is lost while one is stopped; work waits and resumes." Below it, three cards in a `repeat(auto-fit, minmax(280px, 1fr))` grid. Each card has:
  - the title (AI generation / Email sending / Social posting);
  - a chip, "Running" with a green dot or "Stopped" with a red dot;
  - "Stops: ..." and "Keeps working: ..." lines, from KillSwitches' existing descriptions;
  - a button. Running shows a red-outline "Stop <noun>" (Stop AI / Stop email / Stop posting) that asks `useConfirm` first: "Stop <thing> for every business?", confirm label "Stop". Stopped shows a primary "Start <noun>" with no confirm.
  - When stopped, a muted line "Stopped <date time> by <name>", if the `/fleet` killSwitches data carries who and when. Otherwise just "Stopped".
- Reuse KillSwitches' client logic. Either restyle that component into this card grid and use it only on this page, or move its action call into a new client component. Do not duplicate the API call code.
- **The banner:** a server component that fetches `/fleet` (`api` with `revalidate: 15, tags: ["fleet"]`), wrapped in try/catch so it returns null on failure. If any switch is stopped, it renders a full-width strip:
  - background `rgba(240,128,154,.12)`, bottom border `rgba(240,128,154,.35)`, colour `var(--red)`, padding `9px 48px`;
  - the text "<Thing> is stopped for every business." (join several with "and");
  - a link "Open platform switches" to `/switches`.
  - Put the class in globals.css as `.switch-banner`.

- [ ] **Steps:** implement, run `cd admin && npm run typecheck && npm test`, then commit `feat(console): platform switches get their own page and a banner while stopped; wider layout`.

---

### Task 6 (admin): Businesses page

**Files:**
- Modify: `admin/src/app/(console)/gyms/page.tsx`
- Modify: `admin/src/components/BusinessesTable.tsx`
- Modify: `admin/src/components/StatusChip.tsx` (billing words)
- Modify: the business detail page's stage editor, wherever stage is set (grep `STAGES` or `stage` in `admin/src/components/business` / `gyms/[id]`), so it offers "Not launched" and "Internal"
- Test: `admin/src/lib/labels.test.ts` (new) for a pure `stageLabel` / `billingLabel` in `admin/src/lib/labels.ts` (new)

**Interfaces:**
- Consumes: the Task 1 fields `riskReason`, `lastLoginAt` and `members` (optional) on fleet rows.
- Produces, in `admin/src/lib/labels.ts`:

```ts
export function stageLabel(stage: string | null | undefined): string; // active->"Live", onboarding->"Setting up", trial->"Trial", at_risk->"At risk", churned->"Churned", not_launched->"Not launched", internal->"Internal", else "-"
export function billingLabel(row: { exempt: boolean; status: string | null; stage?: string | null }): string; // stage internal->"Internal"; exempt->"Free · agency client"; active->"Paying"; past_due->"Past due"; pending_payment->"Awaiting payment"; cancelled->"Cancelled"; suspended->"Suspended"; else "No billing"
export function riskShown(stage: string | null | undefined): boolean; // false for not_launched and internal
export function relTime(ms: number | null | undefined, now?: number): string; // "-", "just now", "5m", "2h", "1d", "3w"
```

- [ ] **Step 1:** Write `labels.test.ts` with an assertion for every mapping above, plus `relTime` at 30s / 5m / 2h / 26h / 9d / 21d. Run `cd admin && npm test -- src/lib/labels.test.ts`; it should FAIL. Check `admin/scripts/test.mjs` for how a single file is run.
- [ ] **Step 2:** Implement `labels.ts` and make the test pass.
- [ ] **Step 3: Filters follow the URL.** In `gyms/page.tsx`, give the toolbar `<form>` (or each control) `key={JSON.stringify(searchParams)}`, so a navigation between saved views remounts the controls with the right `defaultValue`. Verify the status select's option values match `admin/src/lib/views.ts`. The subtitle becomes "N businesses · P paying · E exempt", computed from the rows.
- [ ] **Step 4: Columns** in `BusinessesTable.tsx`, per spec section 3 and `console-pages.html` panel 1:
  - **Business:** `.biz-mark` plus the bold name, with the venue in muted text.
  - **Billing:** a chip with `billingLabel`.
  - **Stage:** `stageLabel`.
  - **Risk:** `riskShown`? Then a dot plus Low/Medium/High (green/amber/red) plus the muted `riskReason`. Otherwise a grey dot plus "Not tracked".
  - **Setup:** a 70px bar plus a mono `done/total`.
  - **Last login:** mono `relTime`.
  - **Staff, Members, Joined.**
  - An **Open** button.
  - Keep DataTable's sorting, column picker and CSV, and drop columns that no longer exist (Next renewal can stay hidden by default in the picker if DataTable supports defaults; otherwise keep it last).
- [ ] **Step 5: Stage editor.** It offers all `STAGES` with their `stageLabel`.
- [ ] **Step 6:** Run the typecheck and tests, then commit `feat(console): businesses list says what its columns mean; saved views show their own filter`.

---

### Task 7 (admin): Dashboard

**Files:**
- Modify: `admin/src/app/(console)/page.tsx` (rewrite the page body; keep the imports that are still used)
- Create: `admin/src/components/fleet/ActivityTable.tsx` (client, for sorting)
- Modify: `admin/src/app/globals.css` (only if new classes are needed; reuse `.card`, `.inbox-*` and the table classes where possible)
- Test: `admin/src/lib/activitySort.test.ts` plus `admin/src/lib/activitySort.ts` (pure)

**Interfaces:**
- Consumes: `/api/platform/activity` (`ActivityResponse`, Task 3), `/alerts` (existing `AlertsResponse`, with `tenantId`, `tenantName`, `detail`, `href` and `level` on each alert), and `/analytics` (for the money section).
- Produces, in `activitySort.ts`:

```ts
export type ActivitySortKey = "problems" | "name" | "lastLogin" | "membersActive" | "bookings" | "leads" | "sales" | "ai" | "setup";
export interface ActivityView { row: ActivityRow; problems: number; worst: "bad" | "warn" | null }
export function joinProblems(rows: ActivityRow[], alerts: { tenantId: number | null; level: string; snoozedUntil?: number | null }[], now: number): ActivityView[];
export function sortActivity(views: ActivityView[], key: ActivitySortKey, dir: "asc" | "desc"): ActivityView[]; // nulls last always; ties by name
export function bookingsDelta(row: ActivityRow): number | null; // bookings7d - bookingsPrev7d, null if either is null
```

- [ ] **Step 1:** Tests for `joinProblems` (counts per tenant, ignores snoozed-until-future, worst = bad over warn), `sortActivity` (each key, nulls last in both directions, name tie-break) and `bookingsDelta`. Run them; they should fail. Implement, run again; they should pass.
- [ ] **Step 2: Page.** Per spec section 2 and `console-dashboard.html` option C. It is a server component that fetches all three with `Promise.all`. Each is wrapped so a failure gives `null` for that section only; the activity fetch uses `revalidate: 60, tags: ["fleet"]`.
  - **Header:** `PageHeader`, eyebrow "Fleet · <weekday day month>" (Europe/Dublin), title "Dashboard".
  - **Needs you card:** a header row with "Needs you · N" and "Open the inbox". Then up to 8 open, unsnoozed alerts, sorted bad first and then by `openedAt` desc. Each row is a 4-column grid:
    - a dot;
    - the bold `tenantName`, or "Platform";
    - the title, plus " · " and the muted `detail` when present;
    - a button. It reads "Reconnect" when the alert key contains `reconnect`, `token`, `integration` or `expired` (check what alert keys exist in alertSources and pick the matching ones), otherwise "Open". It links to `href ?? /gyms/<tenantId>`.

    With no alerts, the card shows "Nothing needs you.".
  - **This week:** a section heading "This week", then `<ActivityTable views=... />`, which sorts on the client with the sort in the URL (`?sort=key&dir=asc|desc`, via `useRouter`/`useSearchParams`, the same way DataTable keeps state; read DataTable and reuse its URL helper if it exports one). The columns, in order:
    - Business (`.biz-mark` + name, links to `/gyms/<id>`);
    - Setup (`done / total`);
    - Last login (`relTime` from Task 6's labels.ts);
    - Members active;
    - Bookings (number, plus a green "+n" or red "−n" delta when non-zero);
    - Leads;
    - Sales (EUR via `fmtCents`);
    - AI spend (`fmtCents`);
    - Open problems (a number coloured by worst, muted 0).

    Nulls show "-". The default sort is problems desc. If Task 6 hasn't landed when you start, create `labels.ts` with `relTime` only and note it.
  - **Money:**
    - If `platform.gyms.paying === 0`: one paragraph, "All N businesses are exempt. Platform MRR starts when the first business pays.", followed by "Client sales through Stripe this week: €X", the sum of `salesCents7d`.
    - Else: keep the existing readouts and charts block from the old page, below the table.
  - **Delete:** the hero sentence, the meters row and the old fleet list with ShareBar.
- [ ] **Step 3:** Typecheck, tests, then commit `feat(console): dashboard leads with what needs you and each business's week`.

---

### Task 8 (admin): Feature flags table

**Files:**
- Modify: `admin/src/app/(console)/flags/page.tsx` (stop borrowing labels from the first business; use `modules` from Task 4)
- Modify: `admin/src/components/flags/FlagEditor.tsx`, or the component that renders each flag (read it first)

**Behaviour** (spec section 5, `console-pages.html` panel 2):
- One `.card` holding a table, with the columns Module (bold label), What it does (muted blurb, "-" if missing), Who has it, and Rollout.
- **Who has it:** "All N" for mode all; "Nobody" for none; for allow, up to 4 chips of business names, then "+k more"; for percent, "N% of businesses".
- **Rollout** is a segmented control: Everyone / Some / Nobody.
  - Everyone and Nobody save at once through the existing flag action, with a toast.
  - Some opens an inline panel under the row: the existing allow-list checklist of businesses, plus a "Percentage instead" option revealing the existing percent input. It has its own Save.
- Keep every existing mode reachable.
- **Steps:** implement, typecheck, test, commit `feat(console): feature flags as one table with what each module does`.

---

### Task 9 (admin): Settings grouped

**Files:**
- Modify: `admin/src/app/(console)/settings/page.tsx` and its form component (read them first)

**Behaviour** (spec section 6, `console-pages.html` panel 4):
- Cards in `repeat(auto-fit, minmax(380px, 1fr))`:
  - **Plan:** monthly price, VAT;
  - **Email:** emails included, credit price, with the existing hint;
  - **AI:** margin, with its hint;
  - **Voice agent add-on:** price per minute, included minutes, free trial minutes.
  - Every other existing field goes into the closest card, or an "Other" card. None are removed.
- Each card has its own Save button ("Save plan", "Save email", "Save AI", "Save voice") that submits only that card's fields, through the existing settings action. If the action needs every field, send the unchanged values of the others from the loaded settings.
- Toast "Saved" on success, and show the error text on failure.
- **Steps:** implement, typecheck, test, commit `feat(console): settings grouped into cards that save on their own`.

---

### Task 10 (controller): Browser check, deploy both apps, set two stages

- [ ] **Run both apps locally.** Run `app` on :3000 and `admin` on :3100 against dev data. Back up `app/data/control.db` first. Mint a `platform_sessions` row (token `"h1:"+sha256(raw)`, user 1) and set the cookie `cf_admin_session=raw`, as in the memory note `console-design-system`.
- [ ] **Screenshot at 1280px and 1600px:**
  - the dashboard;
  - Businesses, plus each saved view showing its own filter;
  - Platform switches: stop social posting, check the banner on another page, start it again;
  - Feature flags: Some opens the list;
  - Settings: one card saves alone.

  Check there is no page-level horizontal scroll.
- [ ] **Restore** the control.db backup and delete the session row.
- [ ] **Deploy `app` first,** since the console tolerates missing fields:
  - full `npm test`, `rm -rf .next && npx next build`, push `main`, `cd app && railway up --detach`;
  - wait for SUCCESS and `/api/health` 200.
- [ ] **Deploy `admin`:** `cd admin && npm run typecheck && npm test && npm run build`, then `cd admin && railway up --detach`, and wait for SUCCESS.
- [ ] **Ask the user** before setting Renova (tenant 1) to "Not launched" and AdonisAgent to "Internal" on their detail pages. These are production writes.
- [ ] **Memory:** update `console-design-system.md` with the new labels.ts, the switches page and banner, the activity endpoint, and the stage values.
