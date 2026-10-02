# Customisable Dashboard — Slice 4 (Front desk, Classes, Finance, Content, Website, Competitors, AI presets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the last presets — Front desk (clinic only), Classes (gym only), Finance, Content & Social, Website, Competitors, AI & Usage — on the slice-1 registry, slice-2 recorders and slice-3 shared views.

**Architecture:** Same as slice 3: per domain, pure helpers in `src/lib/dashboard/metrics/<domain>.ts` (unit-tested), queries in `metrics/<domain>Queries.ts` (scratch-tenant smoke test calling every loader once), implementations in `widgets/<domain>.tsx`, catalog entries, a preset. Presets may reference existing widget keys (e.g. `overview.todaysSchedule`). A preset gains an optional `venues` list so Front desk and Classes appear only for their venue.

**Tech Stack:** as slice 3 (Next.js 14 server components, drizzle/better-sqlite3, recharts client views, `node:assert` tests).

Spec: `docs/superpowers/specs/2026-10-02-customisable-dashboard-design.md` section 3, presets 5-10. Reference implementations: `metrics/salesQueries.ts`, `metrics/marketingQueries.ts`, `widgets/sales.tsx`, `widgets/marketing.tsx` and their tests.

## Global Constraints

- NO EMOJIS anywhere.
- All work in `app/`. NEVER name a source folder `data` (the Railway upload drops it); dashboard modules live in `src/lib/dashboard/metrics/`.
- Widget keys `domain.camelName`, prefixed by their domain; every catalog key implemented (`satisfies`); presets validate (`presets.test.ts`).
- Sensitivity: every `finance.*` widget `financial`; every `ai.*` widget and `competitors.researchSpend` `spend`; everything else `general`.
- Money: clinic tables are euros (`amountEur`, `totalPriceEur`, `pricePaidEur`, `valueEur`, `balanceEur`); gym/membership tables and all control-plane spend are cents (divide by 100 before `formatEur`). AI `cost_cents` is a REAL (fractional cents): round only for display.
- Times shown to people use `timeZone: "Europe/Dublin"`; weekday/hour grids via `weekdayHourGrid(..., "Europe/Dublin")`.
- Use `ctx.now`, not `new Date()`, inside loaders. Loaders read only; no AI calls.
- Recorder-backed widgets declare `recorder`; site/competitor-backed widgets declare `requires` (`site`, `competitors`).
- Select only needed columns; no per-row N+1 loops over unbounded sets; share repeated base queries with `cached(ctx, key, fn)` (include the range in the key when the data depends on it).
- Empty states are specific sentences ("No payments in this period."), never "No data".
- Before deploy: `npm run typecheck`, `npm test`, `npx next build`; merge to `main`; `railway up` from `app/`.

---

### Task 1: Venue-specific presets, Front desk (clinic) and Classes (gym)

**Files:** `presets.ts` (+ `presets.test.ts`), `src/app/dashboard/page.tsx` (preset list filter), `metrics/frontdesk.ts`, `metrics/frontdeskQueries.ts`, `metrics/classes.ts`, `metrics/classesQueries.ts` (+ tests), `widgets/frontdesk.tsx`, `widgets/classes.tsx`, `catalog.ts`, `widgets/keys.ts`, `widgets/index.ts`.

**Preset venue gating:** add `venues?: readonly Venue[]` to `Preset`. `presets.test.ts`: for each preset, check only the venues it applies to (`p.venues ?? ["clinic","gym"]`); a preset must have widgets for each venue it applies to; for a venue it does not apply to, its list must be empty. `page.tsx`: pass to `TabBar` only presets whose `venues` (default both) include the current venue. `addTab` with a preset for the wrong venue must fail cleanly: in `tabs.ts` `addTab`, if the preset's venues exclude the venue, throw "That preset is not available for this venue." (add a test in `tabs.test.ts`).

**Front desk catalog** (`domain: "frontdesk"`, `venues: ["clinic"]`, `general`):

| key | title | sizes / default | rangeMode | recorder |
|---|---|---|---|---|
| `frontdesk.weekBookings` | This week | S,M / S | none | |
| `frontdesk.noShowRate` | No-show rate | S,M / S | tab | |
| `frontdesk.cancellationRate` | Cancellation rate | S,M / S | tab | |
| `frontdesk.birthdays` | Birthdays this week | S,M / S | none | |
| `frontdesk.utilisation` | Diary utilisation | M,L / M | tab | |
| `frontdesk.busiestTimes` | Busiest times | M,L / M | tab | |
| `frontdesk.sessionsByService` | Sessions by service | M,L / M | tab | |
| `frontdesk.newVsReturning` | New and returning clients | M,L / M | tab | |
| `frontdesk.cancelLeadTime` | How far ahead people cancel | M,L / M | tab | status_dates |
| `frontdesk.creditsExpiring` | Package credits expiring | M,L / M | none | |

Semantics (appointments `date` is ISO text: compare with `fromIso`/`toIso` inclusive):
- `weekBookings`: appointments Mon-Sun of the current Dublin week, excluding cancelled; sub "N confirmed".
- `noShowRate` / `cancellationRate`: over appointments dated in range with status in (completed, no_show, cancelled): `no_show / total`, `cancelled / total` as pct; delta vs previous with `goodWhen: "down"`; sub "n of N". Reuse `attendanceStats(fromIso, toIso)` from `src/lib/queries.ts` if its definitions match; otherwise query directly.
- `birthdays`: clients whose `dateOfBirth` (text `YYYY-MM-DD`) month-day falls in the next 7 Dublin days (handle year wrap; 29 Feb shows on 28 Feb in non-leap years); `RowList` name + "Tue 6 Oct". Pure helper `upcomingBirthdays(clients, todayIso, days)` tested.
- `utilisation`: per day in range (cap at 31 days: if the range is longer, use its last 31 days and say so in the sub), booked minutes (non-cancelled appointments: `endTime - startTime`) / open minutes (from `getSettings().openingHours` by weekday, closed days 0). `BarListView` per weekday aggregated across the range ("Mon 62%"), plus a KPI-style sub with the overall percentage. Pure `openMinutesFor(dow, openingHours)` and `utilisationByWeekday(...)` tested.
- `busiestTimes`: `HeatmapView` of non-cancelled appointment start times in range (build epoch ms from `date` + `startTime` as Dublin local time; pure helper `dublinLocalToMs(dateIso, hhmm)` tested across a DST change).
- `sessionsByService`: `sessionsByTherapy(fromIso, toIso)`; `DonutView` with therapy colours.
- `newVsReturning`: clients with a completed appointment in range, split into first-ever completed appointment in range (new) vs earlier ones (returning); `BarListView` two rows with pct.
- `cancelLeadTime`: appointments with `cancelledAt` in range and status `cancelled` (exclude no_show), `cancelledAtApprox = false`; lead time = appointment start (Dublin local) - `cancelledAt`; buckets "Under 24 hours", "1 to 3 days", "3 to 7 days", "Over a week", "After the start"; `BarListView`. Pure `leadTimeBucket(ms)` tested.
- `creditsExpiring`: `listPackages("expiring")` (active, expiring within 30 days) with remaining sessions > 0; `RowList` client, package, "N left, expires 12 Oct".

**Front desk preset** `frontdesk` — name "Front desk", icon `CalendarCheck`, `venues: ["clinic"]`, description "Today's diary, no-shows, busy times and what needs a nudge.": clinic `overview.todaysBookings S, frontdesk.weekBookings S, frontdesk.noShowRate S, frontdesk.cancellationRate S, overview.todaysSchedule L, frontdesk.birthdays S, frontdesk.utilisation M, frontdesk.busiestTimes M, frontdesk.sessionsByService M, frontdesk.newVsReturning M, frontdesk.cancelLeadTime M, frontdesk.creditsExpiring M`; gym `[]`.

**Classes catalog** (`domain: "classes"`, `venues: ["gym"]`, `general`):

| key | title | sizes / default | rangeMode |
|---|---|---|---|
| `classes.avgFill` | Average fill | S,M / S | tab |
| `classes.attendanceRate` | Attendance | S,M / S | tab |
| `classes.noShows` | No-shows | S,M / S | tab |
| `classes.newBookings` | Bookings made | S,M / S | tab |
| `classes.fillByType` | Fill by class | M,L / M | tab |
| `classes.fillBySlot` | Fill by time slot | M,L / M | tab |
| `classes.instructors` | Instructors | M,L,XL / M | tab |
| `classes.fullClasses` | Full classes coming up | M,L / M | none |
| `classes.inactiveMembers` | Members gone quiet | M,L / M | none |

Semantics (class session `date` ISO text; `status` scheduled only; bookings count when status booked/attended/no_show):
- `avgFill`: over scheduled sessions dated in range: sum booked / sum capacity; delta vs previous.
- `attendanceRate`: attended / (attended + no_show) for sessions dated in range up to today; delta.
- `noShows`: no_show count in range; delta `goodWhen: "down"`.
- `newBookings`: bookings with `createdAt` in range (any status but cancelled); delta.
- `fillByType`: group by session `name` (or schedule category when present): fill pct, top 8; `BarListView` "72% (36/50)".
- `fillBySlot`: `HeatmapView` where each cell is the average fill pct (0-100) of sessions at that weekday/hour (Dublin, from `date`+`startTime`); pure helper tested.
- `instructors`: per `instructor` name in range: classes taught, average fill, attendance rate; `TableView`; null instructor -> "Unassigned".
- `fullClasses`: scheduled sessions in the next 7 days with booked >= capacity; `RowList` "Tue 7 Oct 18:00, HIIT", meta "20/20". One grouped query for booked counts (no per-session loop).
- `inactiveMembers`: clients with an active membership and no attended booking in the last 30 days (relative to `ctx.now`); oldest last-visit first, top 10; `RowList` name, "last visit 12 Aug" or "never".

**Classes preset** `classes` — "Classes", icon `Dumbbell`, `venues: ["gym"]`, "Fill, attendance and who has gone quiet.": gym `overview.classesThisWeek S, classes.avgFill S, classes.attendanceRate S, classes.noShows S, overview.todaysClasses L, classes.newBookings S, classes.fillByType M, classes.fillBySlot M, classes.instructors M, classes.fullClasses M, classes.inactiveMembers M`; clinic `[]`.

- [ ] Steps: pure-helper tests RED then GREEN; preset gating change + tests; queries + smoke tests (scratch tenant seeded with a few appointments/therapies/clients for Front desk and class schedules/sessions/bookings/memberships for Classes; call every loader once); widgets; catalog; registration; typecheck, full suite, build; commit `feat(dashboard): venue-specific presets, Front desk and Classes`.

---

### Task 2: Finance preset

**Files:** `metrics/finance.ts`, `metrics/financeQueries.ts` (+ tests), `widgets/finance.tsx`, registry files.

**Catalog** (`domain: "finance"`, `sensitivity: "financial"`):

| key | title | venues | sizes / default | rangeMode | recorder |
|---|---|---|---|---|---|
| `finance.revenue` | Payments received | both | S,M / S | tab | |
| `finance.avgSpend` | Average spend per client | both | S,M / S | tab | |
| `finance.revenueTrend` | Payments over time | both | L,XL / XL | tab | |
| `finance.byMethod` | Payments by method | both | M,L / M | tab | |
| `finance.topClients` | Top clients by spend | both | M,L / M | tab | |
| `finance.vouchers` | Gift vouchers | both | M,L / M | tab | |
| `finance.byService` | Revenue by service | clinic | M,L / M | tab | |
| `finance.packages` | Package use | clinic | M,L / M | none | |
| `finance.churn` | Membership churn | gym | S,M / S | tab | status_dates |
| `finance.membersGainedLost` | Members gained and lost | gym | L,XL / XL | tab | status_dates |
| `finance.renewals` | Renewals in the next 14 days | gym | M,L / M | none | |

Semantics ("payments" = `payments.amountEur` euros, `createdAt` in range, `paymentMethod` excluding `voucher` and `package` for revenue so redemptions are not double counted: revenue = cash|card|bank_transfer):
- `revenue`: sum revenue payments in range; delta; sub "N payments".
- `avgSpend`: revenue / distinct paying clients in range; delta.
- `revenueTrend`: revenue per bucket (`seriesBuckets`) with a dashed previous-period series aligned by index; `SeriesChart` bars.
- `byMethod`: all payments in range grouped by method (include voucher and package, labelled "Voucher redeemed", "Package credit"); `DonutView`.
- `topClients`: `topClientsBySpend(fromIso, toIso, 8)` from `src/lib/queries.ts` (check it uses the same revenue methods; if it counts all methods, compute directly with the revenue methods); `BarListView` euros.
- `vouchers`: outstanding = sum `balanceEur` of unredeemed, unexpired vouchers; sold in range (createdAt) count and value; redeemed in range (`redeemedAt`); `BarListView` three rows with euro displays.
- `byService`: completed appointments dated in range; split each `totalPriceEur` evenly across its `therapyIds`; group by therapy name; top 8; `BarListView` euros. Pure `splitAcrossTherapies` tested.
- `packages`: `packageUtilization()` from queries.ts: average utilisation pct, sessions sold vs used, stalled count; small body (`BarListView` rows).
- `churn`: memberships with `endedAt` in range / memberships active at range start (active at start = `createdAt < fromMs` and (`endedAt` null or `endedAt >= fromMs`)); pct; delta `goodWhen: "down"`.
- `membersGainedLost`: per bucket memberships created (gained) vs ended (lost); `SeriesChart` bars.
- `renewals`: active memberships with `nextBillingDate` in the next 14 Dublin days; `RowList` client, plan, amount (cents/100), date.

**Finance preset** `finance` — "Finance", icon `Wallet`, "Money in, how people pay, and what is owed or coming up.":
- clinic: `finance.revenue S, overview.cashToday S, overview.deferredRevenue S, finance.avgSpend S, finance.revenueTrend XL, finance.byMethod M, finance.byService M, finance.topClients M, finance.packages M, finance.vouchers M`
- gym: `finance.revenue S, overview.mrr S, finance.churn S, finance.avgSpend S, finance.revenueTrend XL, finance.byMethod M, finance.topClients M, finance.membersGainedLost XL, finance.renewals M, finance.vouchers M`

- [ ] Steps as Task 1 (pure tests, smoke test seeding payments/vouchers/appointments/memberships, widgets, registration, gates). Commit `feat(dashboard): Finance preset`.

---

### Task 3: Content & Social and Website presets

**Files:** `metrics/content.ts`, `metrics/contentQueries.ts`, `metrics/website.ts`, `metrics/websiteQueries.ts` (+ tests), `widgets/content.tsx`, `widgets/website.tsx`, registry files. Export `dayRange` and the visitor/traffic helpers from `marketingQueries.ts` for reuse rather than copying.

**Content catalog** (`domain: "content"`, both venues, `general`):

| key | title | sizes / default | rangeMode |
|---|---|---|---|
| `content.published` | Posts published | S,M / S | tab |
| `content.scheduled` | Posts scheduled | S,M / S | none |
| `content.failed` | Posts that failed | S,M / S | tab |
| `content.blogPublished` | Blog posts published | S,M / S | tab |
| `content.calendar` | Next 14 days | L,XL / XL | none |
| `content.byPlatform` | Posts by platform | M,L / M | tab |
| `content.failedList` | Needs attention | M,L / M | none |
| `content.recentDesigns` | Recent designs | M,L / L | none |
| `content.library` | Library | S,M / S | tab |
| `content.blogPipeline` | Blog pipeline | M,L / M | none |

Semantics: `published` = scheduled_posts `postedAt` in range (delta); `scheduled` = status `scheduled` and `scheduledFor >= now`; `failed` = status `failed` with `lastAttemptAt` (or `scheduledFor`) in range, accent when > 0, delta `goodWhen: "down"`; `blogPublished` = blog_posts `publishState = 'published'` and `publishedAt` in range; `calendar` = scheduled posts (with carousel name) and blog posts scheduled (`publishState = 'scheduled'`, `scheduledFor`) in the next 14 days, merged by time; `RowList` primary title, secondary "Social post, Instagram and Facebook" / "Blog post", meta Dublin date-time; `byPlatform` = posted in range, count per channel from the `channels` JSON (a post on both counts once per channel); `failedList` = latest 8 failed posts with `error` truncated 90, href to Content Studio; `recentDesigns` = latest 8 carousel sets by `updatedAt` with slide count (one grouped count query) and generation status label; `library` = image library assets total, sub "+N this period"; `blogPipeline` = counts drafts (publishState draft, status ready), scheduled, published (all time); `BarListView`.

**Content preset** `content` — "Content & Social", icon `Images`, "What went out, what is coming, and what failed.": both venues `content.published S, content.scheduled S, content.failed S, content.blogPublished S, content.calendar XL, content.byPlatform M, content.failedList M, content.recentDesigns L, content.library S, content.blogPipeline M`.

**Website catalog** (`domain: "website"`, both venues, `general`, all `requires: ["site"]`):

| key | title | sizes / default | rangeMode | recorder |
|---|---|---|---|---|
| `website.visitors` | Visitors | S,M / S | tab | page_views |
| `website.pageViews` | Page views | S,M / S | tab | page_views |
| `website.submissions` | Form submissions | S,M / S | tab | |
| `website.enquiryRate` | Visitors who enquire | S,M / S | tab | page_views |
| `website.trafficTrend` | Traffic | L,XL / XL | tab | page_views |
| `website.topPages` | Top pages | M,L / M | tab | page_views |
| `website.sources` | Where visitors come from | M,L / M | tab | page_views |
| `website.submissionsByForm` | Submissions by form | M,L / M | tab | |
| `website.blogViews` | Blog post views | M,L / M | tab | page_views |
| `website.recentEdits` | Recent page edits | M,L / L | none | |
| `website.requests` | Open site requests | S,M / S | none | |

Semantics: visitors = sum `site_visitors_daily.uniques` in range (delta); pageViews = sum `site_page_views_daily.views` (delta); submissions = `form_submissions` in range (delta); enquiryRate = submissions / visitors pct (null when no visitors); trafficTrend = per bucket views and uniques (`SeriesChart` lines); topPages = views by path, top 8 (path "/" labelled "Home"); sources = reuse slice-3 `sourceLabel` grouping; submissionsByForm = join `forms.title`; blogViews = views on paths `/blog/<slug>` joined to blog post titles by slug (check the blog route path), top 6; recentEdits = latest 8 `page_revisions` joined to page title, with `source` label (studio "Studio", agent "Adonis", deploy "Deploy", restore "Restored") and Dublin date; requests = `site_requests` status `new` count, href `/cms`.

**Website preset** `website` — "Website", icon `Globe`, "Visitors, top pages, sources and enquiries.": both venues `website.visitors S, website.pageViews S, website.submissions S, website.enquiryRate S, website.trafficTrend XL, website.topPages M, website.sources M, website.submissionsByForm M, website.blogViews M, website.recentEdits L, website.requests S`.

- [ ] Steps as Task 1. Two commits: `feat(dashboard): Content & Social preset`, `feat(dashboard): Website preset`.

---

### Task 4: Competitors and AI & Usage presets

**Files:** `metrics/competitors.ts`, `metrics/competitorsQueries.ts`, `metrics/ai.ts`, `metrics/aiQueries.ts` (+ tests), `widgets/competitors.tsx`, `widgets/ai.tsx`, registry files.

**Competitors catalog** (`domain: "competitors"`, both venues, `requires: ["competitors"]`):

| key | title | sizes / default | rangeMode | sensitivity |
|---|---|---|---|---|
| `competitors.reviewGap` | Reviews vs competitors | S,M / S | none | general |
| `competitors.newAds` | New competitor ads | S,M / S | tab | general |
| `competitors.researchSpend` | Research spend | S,M / S | none | spend |
| `competitors.ratingTrend` | Rating over time | L,XL / XL | none | general |
| `competitors.reviewVelocity` | Reviews gained | M,L / M | tab | general |
| `competitors.recentReviews` | Latest competitor reviews | M,L / M | none | general |
| `competitors.activity` | Competitor activity | L,XL / XL | none | general |
| `competitors.activeAds` | Ads running now | L,XL / XL | none | general |

Semantics (`src/lib/research/store.ts`): reviewGap = self `reviewCount` vs average of tracked non-self latest `reviewCount`; newAds = `listEvents` type `new_ad` with `occurredAt` (ISO) in range; researchSpend = `researchSpentCents(tenantId)` vs `getResearchCapCents(tenantId)` (`src/lib/research/spend.ts`), "€1.20 of €5.00 this month"; ratingTrend = `metricHistory(id, 26)` for self + the 4 nearest tracked competitors, merged by `capturedAt` week into `SeriesChart` lines (self accent, others muted, rating = `ratingMilli/1000`); reviewVelocity = per competitor (incl. self, labelled "You") reviews gained in range = latest `reviewCount` at or before range end minus the latest at or before range start (from `metricHistory`), `BarListView`; recentReviews = `getReviews` across tracked competitors, newest 6 by `publishedAt`, `RowList` author + competitor name, secondary text truncated 100, meta "4 stars"; activity = `listEvents({ limit: 10 })` with competitor names, `RowList` summary + Dublin date; activeAds = `listAds(id, { activeOnly: true })` across tracked competitors, newest 8, `RowList` page name, first body truncated 100, "running since 12 Sep". Use `hydrateCompetitors` if it avoids per-competitor queries; keep per-competitor loops bounded to tracked competitors.

**Competitors preset** `competitors` — "Competitors", icon `Binoculars`, "How you compare locally, and what competitors are doing.": both venues `marketing.ratingGap S, competitors.reviewGap S, competitors.newAds S, competitors.researchSpend S, competitors.ratingTrend XL, competitors.reviewVelocity M, competitors.recentReviews M, competitors.activity XL, competitors.activeAds XL`.

**AI catalog** (`domain: "ai"`, both venues, `sensitivity: "spend"`, `rangeMode: "none"` unless stated; all month figures are the current calendar month):

| key | title | sizes / default |
|---|---|---|
| `ai.spendVsCap` | AI spend this month | M,L / M |
| `ai.projected` | Projected month end | S,M / S |
| `ai.agentRuns` | Adonis runs | S,M / S (rangeMode tab) |
| `ai.byAgent` | Spend by feature | M,L / M |
| `ai.byModel` | Spend by model | M,L / M |
| `ai.dailySpend` | Daily spend | L,XL / XL |
| `ai.topDrivers` | Biggest costs | M,L / M |
| `ai.mediaSpend` | Images, video and audio | M,L / M |

Semantics (`src/lib/ai/usage.ts`, control plane, `ctx.tenantId`; `cost_cents` REAL): spendVsCap = `getMonthlyUsageCents` vs `getTenantCapCents`, `BarListView` single row with `max` = cap and `display` "€4.20 of €25.00", plus a line "Over the free allowance" when `isOverFreeTranche`; projected = spent / elapsed Dublin days * days in month, accent when over cap; agentRuns = tenant `agent_runs` created in range, sub "N errors"; byAgent = `getMonthlyUsageByAgent` with human labels (orchestrator "Adonis", carousel "Post design", blog "Blog", triage "Inbox triage", brief "Daily brief", video "Video", transcribe "Transcription", others title-cased); byModel = `getMonthlyUsageByModel`, model ids shortened for display; dailySpend = per Dublin day this month from `ai_usage` (`controlSqlite` raw SQL: `WHERE tenant_id = ? AND yyyymm = ?`, group in JS by Dublin day), `SeriesChart` bars; topDrivers = top 5 (agent_key, model) pairs this month; mediaSpend = classify rows: model starting `fal:` (not kling) or `openai:gpt-image` -> "Images", model containing `kling`/`runway` or agent `video` -> "Video", agent `transcribe` -> "Transcription"; `BarListView`. Put the classifier and label maps in `metrics/ai.ts` as pure tested functions. Add read-only query functions in `aiQueries.ts`; do not modify `usage.ts`.

**AI preset** `ai` — "AI & Usage", icon `Cpu`, "What AI costs this month and where it goes.": both venues `ai.spendVsCap M, ai.projected S, ai.agentRuns S, ai.byAgent M, ai.byModel M, ai.dailySpend XL, ai.topDrivers M, ai.mediaSpend M`.

- [ ] Steps as Task 1. Two commits: `feat(dashboard): Competitors preset`, `feat(dashboard): AI & Usage preset`.

---

### Task 5: Verify, merge, deploy

- [ ] `npm run typecheck && npm test && npx next build`.
- [ ] Local visual pass (Playwright, local QA sessions, removed afterwards): clinic admin adds Front desk, Finance, Content, Website, Competitors, AI; the gallery shows no Classes preset for a clinic; switch the test tenant's scheduling mode to timetable (or use a gym tenant) and add Classes and Finance (gym list); no tile errors; staff hides Finance, AI and research spend; phone width no overflow. Fix anything visibly broken.
- [ ] Merge to `main` (`--no-ff`), push, `railway up` from `app/`, poll to SUCCESS, health check.

## Self-review notes

- Spec presets 5-10 covered. Substitutions, recorded: no waitlist -> "Full classes coming up"; no entry-page tracking -> "Submissions by form"; carousel thumbnails are client-painted -> "Recent designs" list; research and AI spend are monthly -> month figures.
- Finance revenue is payments received (works for gyms); Overview "Revenue trend" stays completed sessions; titles differ ("Payments received" vs "Revenue trend").
