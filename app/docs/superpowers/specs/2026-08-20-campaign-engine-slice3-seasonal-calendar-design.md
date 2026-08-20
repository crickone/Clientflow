# Campaign Engine — Slice 3: Seasonal Calendar + Campaign Radar — Design

**Date:** 2026-08-20 · **Status:** APPROVED (design)
**Builds on:** Slice 1 (Campaign Kit) + Slice 2 (the Funnel) — both live.
**Decision locked (brainstorm):** approach **(c) + A** — a year-map of *real marketing hooks* (Irish public holidays + awareness/marketing days + the four seasons) overlaid with the tenant's actual campaigns, plus an **AI campaign radar** that surfaces "what's coming up + a suggested campaign" in **both** the calendar page **and** the daily dashboard brief. The radar uses **curated dates + AI framing** (not per-date pre-generation): one cached, metered pass per tenant per day.

## Goal

Give each client a **rough plan for the year** at a glance — the notable dates worth marketing around, the seasons, and their own campaigns laid on top — and have the AI proactively point at what's coming and pitch a campaign for it, in both the calendar and the daily brief. "Build campaign" on any suggestion launches the existing Campaign Kit pre-seeded with that date's name/season/dates/hook.

## Non-goals (separate slices / later)

- **Campaign AI cost estimator** (est. €X to build a kit on the selected model, shown at plan time + launch) — **Slice 4**, its own spec. Not here.
- **CFA / ROAS scoreboard** (per-campaign performance) — a later slice.
- **Per-campaign spend attribution** in metering (`ai_usage` is per-tenant, not per-campaign today) — not needed here.
- **Auto-posting / auto-scheduling** campaigns off the calendar (still the approve-each-asset flow via the Kit).
- **Multi-region holiday sets** — region defaults to **Ireland**; the catalog is structured so a second region is a later drop-in, but only IE ships now.
- **Editable/custom per-tenant dates** — the catalog is curated in code this slice; user-added dates are a later enhancement.

## Architecture (assembles existing rails)

### 1. The date catalog — `src/lib/marketing/seasonalCalendar.ts` (curated, no external API)

A pure module that, given a **year**, returns the marketing-relevant dates + season bands. Three entry kinds:

- **`public-holiday`** (Ireland): New Year's Day (Jan 1), St Brigid's Day (first Mon Feb, since 2023), St Patrick's Day (Mar 17), Easter Monday (*computed* — Gauss/Anonymous Gregorian algorithm → Easter Sunday + 1), May Day (first Mon May), June Bank Holiday (first Mon Jun), August Bank Holiday (first Mon Aug), October Bank Holiday (last Mon Oct), Christmas Day (Dec 25), St Stephen's Day (Dec 26).
- **`awareness-day`** (marketing hooks): Valentine's Day (Feb 14), Mother's Day IE (*computed* — 4th Sun of Lent = Easter − 21 days), Father's Day (3rd Sun Jun), International Women's Day (Mar 8), International Men's Day (Nov 19), Back-to-school (~Sep 1), Black Friday (day after 4th Thu Nov), plus a small curated fitness/wellness set (e.g. "New Year — resolutions", "Summer countdown"). Extensible list.
- **`season`** (bands, **Irish/Celtic convention**): Spring = Feb–Apr, Summer = May–Jul, Autumn = Aug–Oct, Winter = Nov–Jan. Each season also emits a "season begins" marker (Feb 1 / May 1 / Aug 1 / Nov 1) for the coming-up rail.

Each entry: `{ id, name, kind, date (resolved ISO for the year) | monthRange (for season bands), angle }` where **`angle`** is a short, vertical-aware hint used to seed the Kit and prime the radar (e.g. New Year → "transformation challenge", Paddy's Day → "7-day Lucky kickstart", Sep → "back-to-routine reset"). Angles are generic/wellness-leaning defaults, NOT client-specific claims (the Marketing Brain personalises at generation time; house rules still apply downstream).

**Purity + tests:** date computations (Easter, "first/last Monday of", Mother's Day) are pure and unit-tested against known 2025/2026/2027 values. `upcomingDates(from, days)` (the next-N-days selection, wrapping year-end) is pure + tested. No AI, no DB, no I/O.

### 2. The calendar page — `/marketing/calendar` (operator/staff-facing, per-tenant)

A new route beside `/marketing/campaigns`. **Deliberately distinct from the existing `/calendar` meetings/events module** — this one is the *marketing* year-map. `export const dynamic = "force-dynamic"`. Layout (top-down — action first):

- **"Coming up" rail** (top): the radar output — the next ~60 days of catalog dates, each with its date + days-away + the AI's one-line campaign suggestion + a **Build campaign** button. (When the radar cache is empty/first-load, show the dates with their static `angle` hint until the day's radar pass has run.)
- **The year** (below): 12 months, **season-tinted**, with holiday/awareness **markers** on their days and the tenant's **real campaigns** drawn on their `startsOn`→`endsOn` span (falling back to the `season` band when dates are absent). Year switcher (◀ ▶). Clicking a campaign → its hub (`/marketing/campaigns/[id]`); clicking an empty date → **Build campaign** seeded from that date.

Branded with the app chrome (this is an internal admin surface, not the public site). Mobile-responsive (the year grid collapses to a scrollable month list on narrow screens).

### 3. The campaign radar — `src/lib/marketing/campaignRadar.ts`

`getCampaignRadar(tenantId): RadarSuggestion[]` — **cached once per tenant per day**:

- Reads today's cached result from the tenant **settings KV** keyed `marketing.radar.<yyyymmdd>` (same KV `getBusinessProfile` uses — **no new table, no migration**). If present → return it.
- If absent → compute: take the **next up to 5** dates from `upcomingDates(today, 60)` (the notable ones nearest now) + the tenant's **Marketing Brain** (business context) and make **one metered AI call** (via the sanctioned `meteredCreate` chokepoint, agentKey `marketing`, gated by `assertAiAllowed` / recorded by the meter — same posture as every other paid call, house rules applied) that returns, for those dates, a one-line campaign suggestion each `{ dateId, name, hook }`. Write to the KV, return. (Dates in the 60-day window beyond the framed 5 still render in the rail with their static catalog `angle`.)
- Fail-soft: if the AI call is unavailable/capped, fall back to the catalog's static `angle` per date (no crash, still useful) and do **not** cache the fallback (so it retries next view).

`RadarSuggestion = { dateId, dateName, dateIso, daysAway, suggestionName, suggestionHook }`.

**Both surfaces read the same `getCampaignRadar`:** the calendar's Coming-up rail renders it directly; the **daily dashboard brief** (`/api/assistant/brief`) includes the top 2–3 upcoming suggestions in its output. One cached pass → both places, ≤1 AI call/tenant/day.

### 4. "Build campaign" → the existing Kit (Slice 1)

Each suggestion / date's **Build campaign** control opens the campaign builder **pre-seeded** with `{ name, season, startsOn, endsOn, offerHint }` derived from the date (+ the radar's suggested name/hook when present). It hands straight into the existing plan → approve-each-asset flow — the calendar is a **launchpad**, not a second builder. Concretely: the control links to the campaigns hub's "new campaign" entry point with the seed encoded as **query params** (`?seedName=…&season=…&startsOn=…&endsOn=…&angle=…`), which pre-fill the `plan_campaign` inputs — no new generation path is introduced.

### 5. Daily brief integration

Extend the existing dashboard brief to surface the radar's top suggestions ("📣 Paddy's Day's 18 days out — a 'Lucky 7' kickstart would fit. Build it?"), each linking to the same Build-campaign seed. Reuses the brief's existing render; the suggestions come from `getCampaignRadar` (cached), so this adds **no** extra AI call beyond the one daily radar pass.

## Data model

- **No schema change.** Campaigns already carry `season`, `startsOn`, `endsOn` (used for placement on the year). The radar cache lives in the existing tenant settings KV (`marketing.radar.<yyyymmdd>`), self-expiring by virtue of the date key (old keys are simply never read; a tiny opportunistic cleanup of prior-day keys is optional, not required).

## Security, tenancy, metering, testing, rollout

- **Tenancy:** `/marketing/calendar` and `getCampaignRadar` run under the normal authenticated tenant context (the ambient `db` proxy / `runWithTenant`); the radar reads only this tenant's Brain + writes only this tenant's KV. Admin/staff-gated like the rest of `/marketing`.
- **Metering:** the radar is one metered AI call per tenant per day through `meteredCreate` (agentKey `marketing`), behind `assertAiAllowed` and recorded by the usage meter — no new uncapped surface. The catalog + calendar render are pure/DB-only (free).
- **House rules:** the radar's suggestion copy is generated from the Marketing Brain through the same guarded path as every other asset (no price, no guarantees, no fabricated results). The catalog's static `angle` fallbacks are generic and carry no client claims.
- **Tests (pure, DB-free):** the date catalog computations (Easter 2025/26/27, first/last-Monday holidays, Mother's Day, Black Friday), `upcomingDates` window selection incl. year-end wrap, season-band assignment for a given month, and the radar's cache-hit/fallback decision logic (pure helper, AI call stubbed). Gate: typecheck + `npm test` + build.
- **Rollout:** additive — one lib module (catalog), one lib module (radar), one page, one brief extension, KV-cached (no migration, no env). Existing campaigns place onto the year immediately from their dates. Deploy `railway up` from `app/`.

## Tasks (for the plan)

1. **Date catalog** (`lib/marketing/seasonalCalendar.ts`) — the curated IE catalog + computed-date helpers + `upcomingDates` + season bands. TDD the pure date math.
2. **Campaign radar** (`lib/marketing/campaignRadar.ts`) — `getCampaignRadar` (KV cache + one metered AI framing call + static fallback). TDD the cache/fallback decision (AI stubbed).
3. **Calendar page** (`/marketing/calendar`) — Coming-up rail (radar) + year grid (season tints, date markers, campaign spans) + year switcher + Build-campaign seeding. Nav entry under Marketing.
4. **Daily brief integration** — surface the top radar suggestions in the dashboard brief, linking to the Build-campaign seed.
5. **Final whole-branch review.**
