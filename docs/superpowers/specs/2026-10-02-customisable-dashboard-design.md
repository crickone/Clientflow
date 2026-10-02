# Customisable dashboard — design

Date: 2026-10-02
Status: approved in brainstorming, awaiting spec review

## Goal

Turn `/dashboard` from a fixed, venue-switched page into a tabbed, customisable
dashboard. Everyone starts from a default; each user can then add tabs from
in-depth presets (Sales, Marketing, Email, Communication, Front desk/Classes,
Finance, Content & Social, Website, Competitors, AI & Usage), drag widgets
around, resize them, and add or remove widgets from a catalog.

"In depth" includes metrics the platform does not record today, so this
project also adds four event recorders (lead stage history, first-party
website page views, an email event log, cancellation/end dates).

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| Scope | Dashboard + presets + the four recorders in one project, shipped in four slices |
| Presets | Tabs. Each preset added becomes a tab the user owns and can edit |
| Default | Venue-aware platform Overview; an admin can override with a team default; "Reset" restores team default, else platform default |
| Staff visibility | Per-widget, set by an admin on a settings screen; sensitive widgets default to admin-only |
| Date range | One range picker per tab (saved on the tab); a widget may pin its own range; deltas vs previous period |
| Layout | 4-column flowing grid, drag to reorder, size menu per widget (S/M/L/XL = 1/2/3/4 columns); 2 columns tablet, 1 column phone |
| Data loading | Server-rendered; tab + range in the URL; one Suspense boundary per widget (streaming) |
| Preset list | Overview + all ten presets listed below |

## 1. Architecture and data model

### Widget registry — `src/lib/dashboard/widgets/`

One definition per widget, split into files by domain
(`widgets.overview.ts`, `widgets.sales.ts`, `widgets.marketing.ts`,
`widgets.email.ts`, `widgets.communication.ts`, `widgets.frontdesk.ts`,
`widgets.classes.ts`, `widgets.finance.ts`, `widgets.content.ts`,
`widgets.website.ts`, `widgets.competitors.ts`, `widgets.ai.ts`), assembled
into one `WIDGETS` map in `index.ts`.

```ts
type WidgetSize = "S" | "M" | "L" | "XL";
type Sensitivity = "general" | "financial" | "spend";
type RangeMode = "tab" | "pinned" | "none";

interface WidgetDef<T> {
  key: string;                 // stable, e.g. "sales.leadsBySource"
  title: string;
  description: string;         // shown in the Add-widget catalog
  domain: Domain;
  sizes: WidgetSize[];
  defaultSize: WidgetSize;
  venues: ("clinic" | "gym")[];
  sensitivity: Sensitivity;
  rangeMode: RangeMode;
  pinnedRange?: RangeKey;      // when rangeMode === "pinned"
  requires?: Requirement[];    // "site" | "sendingDomain" | "competitors" | { recorder: RecorderKey }
  href?: (ctx) => string;      // click-through to the owning module
  load(ctx: WidgetCtx): Promise<T> | T;
  view: ViewSpec<T>;           // which shared view renders it, and how
}

interface WidgetCtx {
  tenantId: number;
  venue: "clinic" | "gym";
  range: { from: Date; to: Date; key: RangeKey };
  previous: { from: Date; to: Date };   // same-length window immediately before
  cache: RequestCache;                  // per-request memo for shared base queries
}
```

Shared views (`src/components/dashboard/views/`): `KpiTile` (value, delta,
optional sparkline), `BarView`, `LineView` (with optional comparison series),
`DonutView`, `FunnelView`, `ListView`, `TableView`, `HeatmapView`
(day x hour), `GaugeView`, `CalendarStripView`, `ThumbGridView`. Recharts as
today. Widgets never ship bespoke components unless no view fits.

### Presets — `src/lib/dashboard/presets.ts`

Plain data: `{ key, name, icon (lucide), description, widgets: { clinic:
WidgetRef[], gym: WidgetRef[] } }` where `WidgetRef = { key, size, range? }`.
A preset with no venue difference uses the same list for both.

### Storage — tenant DB (new migration)

```
dashboards
  id            integer pk
  user_id       integer null      -- control-plane users.id; NULL = team default row
  name          text not null
  preset_key    text null         -- which preset it was created from (for Reset)
  position      integer not null
  range         text not null default '30d'
  widgets       text not null     -- JSON WidgetRef[]
  created_at    integer not null
  updated_at    integer not null
  index (user_id, position)
```

Widget visibility overrides: tenant settings key `dashboard_widget_visibility`
= `{ [widgetKey]: boolean }` (staff can see). Keys not present fall back to
the default for the widget's sensitivity (`general` → visible,
`financial`/`spend` → hidden).

### Tab resolution — `src/lib/dashboard/tabs.ts`

`resolveTabs(userId, venue)`:
1. the user's own rows, if any;
2. else the team default rows (`user_id IS NULL`);
3. else the platform Overview preset for the venue (in memory).

Viewing never writes. The first edit (any save, add tab, reorder) copies the
resolved set into rows owned by the user, then applies the change.
"Make team default" (admin) replaces all `user_id IS NULL` rows with copies of
the admin's current tabs. "Reset tab" restores the tab's `preset_key` list;
for an Overview tab it restores the team default Overview if one exists, else
the platform one.

### Rendering — `src/app/dashboard/page.tsx`

- Reads `?tab=<id|preset>` and `?range=<key>` from the URL (defaults: first
  tab, the tab's saved range).
- Filters the tab's widgets on the server: drop unknown keys, wrong venue,
  and widgets hidden from this user (non-admin + visibility false). Only then
  calls `load`.
- Renders each widget in its own `<Suspense>` + error boundary inside a CSS
  grid (`grid-template-columns: repeat(4, 1fr)`, span by size; 2 / 1 columns
  at the tablet / phone breakpoints).
- The Daily Brief and the setup progress card stay pinned above the tab bar
  and are not widgets.

## 2. Event recorders

Common rules: append-only, never change existing behaviour, a recorder
failure is logged and swallowed (never fails the user's action). Each
recorder stores its start date in settings (`recorder_started:<key>`) so a
dependent widget can render "Collecting since <date>" plus any partial data.

### 2a. Lead stage history

- Table `lead_stage_events(id, lead_id, pipeline_id, from_stage_id null,
  to_stage_id, actor text, at)`; index `(pipeline_id, at)`, `(lead_id, at)`.
- Written inside `setStage` (`src/lib/pipeline/stage.ts`) in the same
  transaction, so the board, agent tools, auto-advance and the lapse job are
  all captured. Lead creation writes a row with `from_stage_id = NULL`.
- `actor`: `user` | `agent` | `automation` | `system`, passed by callers
  (default `system`).
- Unlocks: time in stage, stage-to-stage conversion, velocity, period funnel,
  won/lost trend.

### 2b. Website page views (first-party, cookieless)

- Public site pages (`src/app/site/[siteSlug]/…`, including campaign landing
  pages) get a small inline beacon that POSTs `{path, referrer, utm}` to
  `/api/site-events` via `navigator.sendBeacon`.
- The endpoint resolves tenant + site from the request host with the same
  resolver as public rendering (`src/lib/cms/resolveHost.ts`), never the
  cookie `db` proxy; unknown hosts are rejected with 204 and nothing stored.
  Dev preview (`/site/<slug>`) is not counted.
- Table `site_page_views_daily(site_id, day, path, views, uniques,
  top_referrer, utm_source)` aggregated per (site, day, path, referrer
  domain, utm source); plus `site_visitor_hashes(day, hash)` holding the
  daily unique hashes, purged each day after the day closes.
- No IP stored, no cookie. Unique = hash(IP + user agent + daily-rotating
  salt). Known bot user agents are dropped. Rate-limited per hash.
- Campaign landing views also increment `campaigns.landingViews` as today, so
  existing scoreboard code keeps working; new widgets read the daily table.

### 2c. Email event log

- Table `email_events(id, campaign_id, send_id, contact_id, event, url null,
  at)`; index `(campaign_id, at)`, `(event, at)`.
- `applyEvent` (`src/lib/marketing/events.ts`) inserts a row for every
  Mailgun webhook event *and* continues to update `campaign_sends.status`
  and the campaign stats exactly as now.
- Unlocks: opens/clicks over time, unique vs total opens, top clicked links,
  time-to-open, engagement heatmap.

### 2d. Cancellation and end dates

- `appointments.cancelled_at` (nullable), set when status becomes
  `cancelled` or `no_show`, cleared if reinstated.
- `client_memberships.ended_at` (nullable), set when status leaves `active`.
- One helper per module (`setAppointmentStatus`, `setMembershipStatus`); all
  existing status writes are routed through it (the plan enumerates every
  write path).
- Backfill: existing cancelled/no-show/ended rows get `updated_at` with an
  `*_at_approx = 1` flag; widgets mark approximate data.
- Unlocks: cancellation lead time, churn trend, members gained vs lost.

## 3. Preset contents

Legend: `[R]` depends on a new recorder; `[$]` sensitive (admin-only by
default); sizes S/M/L/XL.

### Overview (default tab)

- Clinic: Today's bookings (S), Today's earnings `[$]` (S), New leads (S),
  Unread messages (S), Needs attention (XL), Today's schedule (L), Recent
  activity (S), Revenue trend `[$]` (XL), Pipeline snapshot (M), Upcoming
  posts (M).
- Gym: Active members (S), MRR `[$]` (S), Attendance % (S), New leads (S),
  Needs attention (XL), Today's classes (L), Recent activity (S), Revenue
  trend `[$]` (XL), Pipeline snapshot (M), Upcoming posts (M).

### 1. Sales

New leads with delta (S); Conversion rate (S); Won this period (S); Open
pipeline count (S); Funnel by stage for the period `[R]` (XL); Current stage
distribution (M); Average time in stage `[R]` (M); Leads by source (M);
Conversion by source (M); Conversion by therapy/service (M); Stale leads 7d+
(L list); Pipeline velocity, days lead to won `[R]` (S); Won/lost trend `[R]`
(L); Leads by campaign (M); SLA breaches (S).

### 2. Marketing

Active campaigns (S); Leads from campaigns (S); Blended CAC `[$]` (S); ROAS
`[$]` (S); Campaign scoreboard table `[$]` (XL); Landing funnel views to leads
`[R]` (L); Website visitors trend `[R]` (L); Top traffic sources/UTMs `[R]`
(M); Form submissions (S); Upcoming posts and email sends (M); Seasonal
calendar next 60 days (M); Competitor rating gap (S).

### 3. Email

Subscribers with net growth (S); Average open rate (S); Average click rate
(S); Credits balance `[$]` (S); List growth trend, adds vs unsubscribes (L);
Contact status mix (M); Campaign performance table (XL); Opens and clicks over
time `[R]` (L); Top clicked links `[R]` (M); Best send time heatmap `[R]` (M);
Deliverability, bounce + complaint rate vs thresholds (M); Suppressions by
reason (M); Sends this month vs included allowance (S); Contacts by source (M).

### 4. Communication

Unread (S); Inbound this period (S); Median first response time (S); AI
auto-reply rate (S); Volume by channel (M); Inbound vs outbound trend (L);
Response time by channel (M); AI triage categories (M); Priority mix (S);
Busiest hours heatmap (M); Awaiting reply, oldest first (L list); Top
conversation tags (M); Automation messages sent/queued (M).

First response time = for each inbound message, the gap to the next outbound
message in the same conversation; median over the period. Documented as an
approximation in the widget description.

### 5. Front desk (clinic)

Today's bookings (S); This week's bookings (S); No-show rate (S);
Cancellation rate (S); Today's schedule (L); Utilisation, booked vs open hours
(M); Busiest days/hours heatmap (M); Sessions by therapy (M donut); New vs
returning clients (M); Cancellation lead time `[R]` (M); Upcoming gaps this
week (M); Birthdays this week (S list); Package credits expiring (M).

### 5. Classes (gym)

Classes this week (S); Average fill % (S); Attendance % (S); No-shows (S);
Today's classes with fill (L); Fill rate by class type (M); Fill by time slot
heatmap (M); Instructor performance (M); Waitlisted/full classes (M); Member
check-in streaks / inactive members (M list); New member bookings (S).

### 6. Finance (all `[$]`)

Revenue this period (S); Cash today (S); Deferred revenue (S); Average spend
per client (S); Revenue trend with comparison (XL); Revenue by payment method
(M); Revenue by therapy/service (M); Top clients by spend (M); Package
utilisation (M); Vouchers outstanding/redeemed (M); MRR (S); Members gained vs
lost `[R]` (L); Churn rate `[R]` (S); Upcoming renewals 14d (M).

### 7. Content & Social

Posts published this period (S); Scheduled (S); Failed (S); Blog posts
published (S); Content calendar next 14 days (XL); Posts by platform (M);
Failed posts needing action (M list); Blog pipeline drafts/scheduled/published
(M); Recent designs (L thumbnails); Library size and recent uploads (S).

No social engagement metrics: the platform does not receive them from Meta.

### 8. Website

Visitors `[R]` (S); Page views `[R]` (S); Form submissions (S);
Visitor-to-enquiry rate `[R]` (S); Traffic trend `[R]` (XL); Top pages `[R]`
(M); Referrers and UTM sources `[R]` (M); Entry pages `[R]` (M); Submissions
by form (M); Recent blog posts with views `[R]` (M); Open site requests (S);
Pages edited recently (M list). Requires the tenant to have a site.

### 9. Competitors

Your rating vs competitor average (S); Review count gap (S); New competitor
ads this period (S); Rating trend, you vs competitors (XL); Review velocity
(M); Competitor activity feed (L); Active competitor ads (L); Recent
competitor reviews (M); Research spend `[$]` (S). Requires competitors to be
set up under Marketing → Research.

### 10. AI & Usage (all `[$]`)

Spend this month vs cap (M gauge); Projected month-end spend (S); Agent runs
(S); Spend by agent/feature (M); Spend by model (M); Daily spend trend (L);
Top cost drivers (M); Image/video generation spend (M).

### All widgets

- Click-through to the owning module, filtered where possible (e.g. Stale
  leads → `/leads` filtered to stale).
- Unmet requirement → one call to action ("Connect a sending domain", "Add
  your website", "Add competitors") instead of empty charts.
- Copy uses the tenant vocabulary (`getVocab`) where the label names a
  booking/member/plan.

## 4. Interaction, visibility, errors, testing

### Tab bar

Tabs across the top of `/dashboard` (horizontal scroll on phone), range
picker and Customise button on the right. "+" opens: From a preset (gallery:
icon, one-line description, widget count), Blank, Duplicate current. Tab
menu: rename, duplicate, delete, drag to reorder; admins also get "Make team
default". Deleting the last tab is not allowed.

### Edit mode

- Customise toggles edit mode: tiles show a drag handle, a size menu (only
  allowed sizes) and remove.
- Reordering uses `@dnd-kit/sortable` (pattern from
  `src/components/settings/PipelineStagesManager.tsx`) with keyboard
  sensors.
- "+ Add widget" opens a side sheet: catalog grouped by domain, search, each
  entry with description and a static preview of its view. Hidden and
  wrong-venue widgets are not listed.
- Done saves via a server action then `router.refresh()`; Cancel discards;
  leaving with unsaved changes asks to confirm. "Reset tab" as defined in 1.

### Visibility settings — `/settings/dashboard` (admin only)

Table of every widget grouped by domain with a "Staff can see" toggle,
defaulted from sensitivity; bulk "Show all financial to staff" / "Hide all
financial from staff". Enforced server-side before `load` runs. A hidden
widget in a staff user's saved tab is skipped, and returns if re-enabled.

### Errors

- Per-widget error boundary: a failing loader shows "Couldn't load" + retry
  on that tile only; logged with widget key + tenant.
- Unknown widget keys in saved layouts are skipped and dropped on next save.
- Server action validates layouts against the registry (known keys, allowed
  sizes, valid range keys, max 40 widgets per tab, max 20 tabs per user).

### Performance

Loaders run in-process against SQLite. A per-request memo (`ctx.cache`)
shares base queries across widgets on the same tab. Migration adds indexes
the loaders need (e.g. `leads(created_at)`, `leads(source)`,
`email_events(campaign_id, at)`, `site_page_views_daily(site_id, day)`,
`appointments(date, status)`).

### Testing

- Registry integrity: every preset references existing keys with allowed
  sizes; every widget declares venue, sensitivity, sizes, range mode.
- Tab resolution: own > team default > platform; viewing does not write;
  first edit copies; Make team default; Reset.
- Visibility: a staff session never invokes a hidden widget's `load`.
- Loaders: each against a fixture tenant DB, including the empty state and
  the "Collecting since" state.
- Recorders: a stage move writes exactly one event; beacon resolves by host,
  rejects unknown hosts, drops bots; Mailgun webhook writes an event and still
  updates send status; cancelling sets `cancelled_at`, reinstating clears it.
- Before each deploy: `npm run typecheck`, `npm test`, `npx next build`, then
  a manual browser pass on a clinic and a gym tenant.

## Delivery slices

Each slice lands on `main` and is deployed on its own.

1. Foundation: registry, shared views, `dashboards` table, tab resolution,
   tab bar, edit mode, visibility settings, and the Overview preset (today's
   dashboard rebuilt from widgets, so nothing regresses).
2. The four recorders, shipped early so data starts accumulating.
3. Presets: Sales, Marketing, Email, Communication.
4. Presets: Front desk / Classes, Finance, Content & Social, Website,
   Competitors, AI & Usage; polish pass.

## Out of scope

- Social engagement metrics (no Meta insights ingestion).
- Ad-platform spend sync (ad spend stays manually entered).
- SEO rankings / Search Console.
- Refunds, invoices, outstanding balances (payments layer is a stub).
- Free-form resizing or per-widget height control.
- Sharing a tab with a specific colleague (only team default).
