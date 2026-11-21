# Console: content fixes and a wider, denser layout

Date: 2026-11-21
Status: approved in brainstorm (visual companion: `console-dashboard.html` option C, `console-pages.html`)
App: `admin/` (admin.adonisagent.ie), reading `app/` through `/api/platform/*`

## Problem

The user says the console UI "is still not great". The screenshots show seven problems:

1. **Platform switches on the Businesses page.** The block with three red Stop buttons sits on top of the Businesses list and every saved view.
2. **Saved views show the wrong filter.** "Awaiting payment" and "Archived" show "Past due" in the status select. The select is uncontrolled (`defaultValue`, `admin/app/(console)/gyms/page.tsx:72`), so it keeps its old value on a client-side navigation. The search and venue inputs have the same bug.
3. **The dashboard says little.**
   - MRR, Paying and GMV are all 0, because every business is exempt.
   - The GMV share bars are empty.
   - "Needs you" lines carry no business name, so "1 failed in nurture messages" and "121 failed in nurture messages" look like duplicates.
4. **The Businesses table says little.**
   - Every row shows a grey "Agency" chip and "Onboarding".
   - Risk is a bare number.
5. **Feature flags** is a tall stack of identical dropdowns, with no word on what each module is.
6. **Settings** is one long single-column form.
7. **The content column is narrow.** It is capped at 1160px, so on a wide screen half the page is empty.

## Decisions

- **Scope:** fix the content, then the look.
  - Keep today's tokens and fonts: `admin/app/globals.css` colours, Hanken Grotesk body, Space Grotesk headings, Space Mono numbers.
  - Make the layout wider and denser.
- **Dashboard:** layout C. A "Needs you" strip first, then one wide, sortable "This week" table, then money.
- **Platform switches:** move to their own page. A red banner shows on every console page while any switch is stopped.

## Design

### 1. Layout shell

- `.app-page` max-width goes from 1160px to 1440px, with the same padding.
- Table cells are a little denser (padding around 11px 12px).
- Nothing else in the shell changes.

### 2. Dashboard (`admin/app/(console)/page.tsx`)

**Header:** the eyebrow "Fleet · <weekday day month>" and the title "Dashboard".

**Needs you:** a card listing the open, unsnoozed alerts, worst first, up to 8, with "Open the inbox" at the top right. Each row has four parts:
- a dot (red for bad, amber for warn);
- the business name, from `alert.tenantName`, or "Platform" when there is no tenant;
- the title, plus its reason in muted text where one exists;
- a button. It is labelled "Reconnect" when the alert concerns a lapsed connection, otherwise "Open", and it goes to `alert.href` or the business page.

When nothing is open, the card shows one quiet line: "Nothing needs you."

**Failed-queue reason:** the failed-queue alert title stays "N failed in <queue>", and the business is shown beside it. In `app/src/lib/platform/health.ts`, where the queue's table stores an error on failed rows, the most recent error's text becomes the alert's `detail`, trimmed to 120 characters. Otherwise there is no reason.

**This week:** a full-width table, one row per active (non-archived) business, sorted by open problems and then by name. Clicking a column header re-sorts it, with the sort held in the URL (`?sort=`), like the existing DataTable. The columns are:

| Column | What it shows | Source |
|---|---|---|
| Business | `.biz-mark` monogram, name | existing |
| Setup | done / total | `getSetupSummaryForTenant` |
| Last login | relative time | max `users.last_login_at` for the business's staff |
| Members active | members active in the last 7 days | existing `activeMembers` where it means that, else the client app's last-seen data |
| Bookings | count, with a +/- delta against the 7 days before | class bookings + appointments with a start in the last 7 days |
| Leads | new leads, last 7 days | tenant `leads.created_at` |
| Sales | paid `offer_orders` total, last 7 days, in EUR | tenant `offer_orders` |
| AI spend | this month, in EUR | `ai_usage` via `getMonthlyUsageCents` |
| Open problems | count of the business's open alerts, coloured by the worst | alerts |

**Data endpoint:** a new platform endpoint `GET /api/platform/activity` (same auth as the other platform routes) returns `{ rows: ActivityRow[] }`, one row per non-archived business. Each tenant is read inside its own `runWithTenant` / `getTenantDbById`. A failure for one tenant gives that row nulls (shown as "-"), never a failed page.

**Money:** a section after the table.
- While no business is paying, it is one line: "All N businesses are exempt. Platform MRR starts when the first business pays." That is followed by the client sales through Stripe this month.
- Once one business pays, today's MRR / Paying / GMV readouts and charts move here as they are.

**Removed from the top of the dashboard:** the hero sentence, the readout row, and the fleet list with GMV share bars.

### 3. Businesses (`admin/app/(console)/gyms/page.tsx`, `BusinessesTable.tsx`)

**Removed:** the `KillSwitches` block.

**Filters follow the URL:** the search input and the status and venue selects take their value from `searchParams` on every navigation. Either key them on the query string (`key={searchParams.toString()}`) or make them controlled, so the saved views always show the right filter.

**Subtitle:** "N businesses · P paying · E exempt".

**Columns:**
- **Business:** the monogram, the name, and the venue in muted text.
- **Billing:** a sentence-case chip.
  - "Free · agency client" for exempt businesses.
  - Otherwise the billing status in words: Paying, Past due, Awaiting payment, Cancelled.
  - "Internal" for the stage `internal`.
- **Stage:** in words. `active` reads "Live", `onboarding` "Setting up", `trial` "Trial", `at_risk` "At risk", `churned` "Churned", `not_launched` "Not launched", `internal` "Internal".
- **Risk:**
  - a dot plus Low / Medium / High, with the top reason from `churnRisk().reasons[0]` in muted text;
  - "Not tracked" for the stages `not_launched` and `internal`.
- **Setup:** a thin bar plus `done/total`.
- **Last login:** relative time.
- **Staff, Members, Joined.**
- An **Open** button.

**Stage rules** (`app/src/lib/platform/tenantMeta.ts`):
- Add `not_launched` and `internal` to `Stage` and `STAGES`. Both are set by hand only, on the business detail page where the stage is already editable.
- `StageFacts` gains `members: number`.
- `defaultStage` returns `onboarding` only when setup is incomplete AND the business has no members. Otherwise it keeps its current rules. So a business in real use, such as Optimal Health or Inspire, reads Live even with one setup step open.

**After deploy:** set Renova (tenant 1) to `not_launched` and AdonisAgent to `internal` on their detail pages. This is a production write, so it goes through the console UI and needs the user's go-ahead.

### 4. Platform switches page (new: `admin/app/(console)/switches/page.tsx`)

**Navigation:** a "Platform switches" item under Console, after Feature flags.

**Cards:** three cards side by side (they stack on narrow screens) for AI generation, Email sending and Social posting. Each card shows:
- a status chip: Running (green) or Stopped (red);
- what stops, and what keeps working (today's copy);
- the stop button.

**Stopping:** opens the existing `useConfirm` dialog, then calls the existing kill-switch action.

**A stopped card** shows:
- who stopped it and when, if the API returns that (else just "Stopped");
- a filled "Start <thing>" button.

**Banner:**
- A server component in the console layout reads the switches from `/fleet`.
- While any switch is stopped, it renders a red strip above every page: "<Thing> is stopped for every business." plus a link to the switches page.
- A fetch failure renders nothing.

### 5. Feature flags (`admin/app/(console)/flags/page.tsx`, `FlagEditor`)

The page becomes one table, with a row per module:

- **Module:** the name.
- **What it does:** the module's `blurb` from `MODULE_CATALOG` (`app/src/lib/features.ts`). Add it to the `/flags` response, so the page no longer borrows labels from the first business.
- **Who has it:** "All N", "Nobody", or chips with the business names.
- **Rollout:** a segmented control: Everyone / Some / Nobody.
  - "Some" opens the business checklist that exists today (the allow list).
  - The percent mode stays reachable, as a "Percentage" item in Some's panel, so no existing setting is lost.

Saving uses the existing flag action.

### 6. Settings (`admin/app/(console)/settings/page.tsx`)

The fields are grouped into cards in a two-column grid that stacks on narrow screens:

- **Plan:** monthly price, VAT.
- **Email:** included emails, credit price.
- **AI:** margin.
- **Voice agent add-on:** price per minute, included minutes, free trial minutes.
- Any other existing fields go into the closest group. None are removed.

Each card saves only its own fields with its own button, through the existing settings action, and toasts "Saved".

## Rules

- No emojis.
- Sentence case; plain words for statuses.
- Theme tokens only; no new colours.
- Controls are at least 36px high, and selects use the existing 36px right padding.
- Every page works at 1280px and 1440px+. Tables scroll inside their card below 1100px, never the page.
- Fail-soft: a missing field or failed fetch shows "-", never a crashed page.

## Testing

- **app/ unit tests:**
  - `defaultStage` with the new `members` fact: a business in use is `active`; a new one with no members is `onboarding`; `not_launched` / `internal` are never auto-chosen.
  - The activity row builder (pure part): the 7-day windows and the bookings delta.
  - The failed-queue `detail` trimming.
- **app/ route test:** `/api/platform/activity` returns one row per non-archived tenant, and nulls for a tenant whose DB fails.
- **admin/:** typecheck and build.
- **Browser check (local, dev data, restored afterwards):**
  - dashboard, Businesses (each saved view shows its own filter), Platform switches (stop and start, banner shown), Feature flags (Some opens the list), Settings (one card saves alone);
  - at 1280px and 1600px.
