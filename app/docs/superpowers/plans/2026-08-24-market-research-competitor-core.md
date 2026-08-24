# Market Research — Competitor Living Core (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A living competitor dashboard under Marketing — auto-discover nearby gyms (Google Places), snapshot their rating/review trends weekly, detect changes, AI-theme reviews, feed the campaign engine. Fail-soft with no API key.

**Architecture:** New `lib/research/*` layer (typed Places client → discovery → weekly refresh → pure change-detection → store) on 4 additive per-tenant tables; a weekly job on the existing daily scheduler; metered external spend; an admin-gated `/marketing/research` UI. Spec: `docs/superpowers/specs/2026-08-24-market-research-competitor-core-design.md`.

**Tech Stack:** Next.js 14 App Router, drizzle + better-sqlite3 (per-tenant), raw `fetch` for Google (no SDK), existing AI metering (`meteredCreate`), existing daily scheduler.

## Global Constraints

- **Money/ratings integer-safe:** cents for spend, `ratingMilli` = rating×1000. Never floats in the DB.
- **Fail-soft:** no `GOOGLE_PLACES_API_KEY` → `placesConfigured()` false → UI shows a "Connect Google Places" state, jobs no-op. Never throw to the request.
- **Every Places/Geocoding method returns a typed result** (`{ok:true,...}` | `{ok:false,error}`) — never throws (MailgunSender pattern).
- **Admin-gated:** page `requireAdminPage()` first line; every server action `await requireAdmin()` first line.
- **Tenancy:** all tenant-DB access via the ambient `db` proxy; never leak across tenants. Additive migrations via the `TENANT_MIGRATIONS` + `PRAGMA table_info` guard pattern (see `lib/db/tenant.ts` — mirror the `leads.stage_id` addition).
- **Metered:** external calls recorded to a per-tenant research spend ledger + cap check before spend; AI calls go through the existing `meteredCreate`/`assertUnderCap`.
- **No new heavy deps.** Raw `fetch`. No Google SDK, no map lib (P1 has no map).
- **House rule (Inspire):** any AI copy must not fabricate; landscape/theme summaries describe only what the data shows.
- **Gate each task:** `npm run typecheck` + `node scripts/test.mjs` + `npx next build`.

## File Structure

```
lib/research/
  places.ts        — typed Google client: geocode, nearby, details (New APIs) + placesConfigured()
  distance.ts      — haversine (pure)
  spend.ts         — per-tenant research spend ledger + cap (control-plane)
  store.ts         — tenant-DB reads/writes: competitors, metrics, reviews, events, curation
  discovery.ts     — geocode tenant → nearby → upsert competitors
  changeDetect.ts  — pure snapshot-diff → events
  refresh.ts       — per-tenant weekly runner (details → metrics/reviews → diff → events), metered
  summary.ts       — AI landscape + per-competitor themes (metered, static fallback)
lib/db/schema.ts   — 4 new tables (+ control-plane research_spend if that route chosen)
lib/db/tenant.ts   — TENANT_MIGRATIONS entries (PRAGMA-guarded)
app/marketing/research/
  page.tsx         — admin page (list + feed + states)
  actions.ts       — curation + rescan + campaign-seed (admin-gated)
  ResearchView.tsx, CompetitorRow.tsx, ChangedFeed.tsx, CompetitorDetail.tsx
components/layout/Sidebar.tsx — add "Market research" to the Marketing group
lib/automations/scheduler.ts  — register the weekly refresh task
```

---

### Task 1: Google Places/Geocoding client (`lib/research/places.ts`)

**Files:** Create `lib/research/places.ts`, `lib/research/__tests__/places.test.ts` (or repo test convention).

**Interfaces — Produces:**
- `placesConfigured(): boolean` — `!!process.env.GOOGLE_PLACES_API_KEY`
- `geocodeAddress(address: string): Promise<{ok:true,lat:number,lng:number} | {ok:false,error:string}>`
- `nearbyGyms(lat:number,lng:number,radiusKm:number): Promise<{ok:true,places:PlaceLite[]} | {ok:false,error:string}>` where `PlaceLite = {placeId,name,address,lat,lng,rating?:number,reviewCount?:number}`
- `placeDetails(placeId:string): Promise<{ok:true,detail:PlaceDetail} | {ok:false,error:string}>` where `PlaceDetail = {placeId,name,address,rating?:number,reviewCount?:number,reviews:ReviewLite[]}`, `ReviewLite = {externalId,author,rating?:number,text,publishedAt?:string}`

**Notes for implementer:** New Places API is POST `https://places.googleapis.com/v1/places:searchNearby` and GET `https://places.googleapis.com/v1/places/{id}` with header `X-Goog-Api-Key` + `X-Goog-FieldMask` (request only `id,displayName,formattedAddress,location,rating,userRatingCount` for nearby; add `reviews` for details). Geocoding is `https://maps.googleapis.com/maps/api/geocode/json?address=&key=`. `includedTypes:["gym"]` + `maxResultCount` + `locationRestriction.circle`. Parse defensively (fields optional). Never throw — wrap fetch in try/catch → `{ok:false}`.

- [ ] Step 1: Write failing tests for parsers with New-API fixture JSON (nearby → PlaceLite[], details → reviews[], geocode → lat/lng; missing rating tolerated; HTTP-error → `{ok:false}`).
- [ ] Step 2: Run tests → fail.
- [ ] Step 3: Implement with raw `fetch`, field masks, defensive parse, typed results, `placesConfigured()`.
- [ ] Step 4: Tests pass (mock `fetch`; no live calls).
- [ ] Step 5: Commit.

### Task 2: Distance (`lib/research/distance.ts`)

**Files:** Create `lib/research/distance.ts` + test.

**Interfaces — Produces:** `haversineKm(a:{lat,lng}, b:{lat,lng}): number`

- [ ] Step 1: Failing tests (known city pairs ±1km; identical point = 0).
- [ ] Step 2: Fail.
- [ ] Step 3: Implement haversine.
- [ ] Step 4: Pass.
- [ ] Step 5: Commit.

### Task 3: Research spend ledger + cap (`lib/research/spend.ts`)

**Files:** Create `lib/research/spend.ts` + test; add control-plane `research_spend` + `research_spend_ledger` (mirror `email/credits.ts` ledger pattern — one row per mutation, single transaction) OR a monthly-usage row keyed (tenantId, yyyymm). **Decision: reuse the metered-usage pattern** — a `research_usage` row per (tenantId, yyyymm) with `spentCents`; a per-tenant `capCents` default 1000 (€10), admin-adjustable later.

**Interfaces — Produces:**
- `getResearchCapCents(tenantId:number): number` (default 1000)
- `researchSpentCents(tenantId:number, yyyymm:string): number`
- `assertUnderResearchCap(tenantId:number): void` — throws `ResearchCapError` if at/over cap
- `recordResearchSpend(tenantId:number, cents:number, kind:string): void`
- `UNIT_COST_CENTS = { geocode: ~0.5, nearby: ~3.2, details: ~1.7 }` (approx Google list price; document source)

- [ ] Step 1: Failing tests (record accumulates; over-cap → assert throws; new month resets).
- [ ] Step 2: Fail.
- [ ] Step 3: Implement (control-plane table + PRAGMA-guarded create; integer cents).
- [ ] Step 4: Pass.
- [ ] Step 5: Commit.

### Task 4: Schema + tenant store (`lib/db` + `lib/research/store.ts`)

**Files:** Modify `lib/db/schema.ts` (4 tables per the spec: `competitors`, `competitor_metrics`, `competitor_reviews`, `competitor_events`), `lib/db/tenant.ts` (TENANT_MIGRATIONS PRAGMA-guarded creates), create `lib/research/store.ts` + test.

**Interfaces — Produces (store):**
- `upsertCompetitor(c: NewCompetitor): number` (by placeId; keep firstSeenAt)
- `listCompetitors(opts?:{trackedOnly?:boolean}): CompetitorRow[]`
- `setCompetitorFlags(id:number, {tracked?,muted?}): void`
- `appendMetric(competitorId:number, ratingMilli:number|null, reviewCount:number|null, capturedAt:string): void`
- `latestMetric(competitorId:number): Metric | null` / `metricHistory(competitorId:number): Metric[]`
- `replaceReviews(competitorId:number, reviews:StoredReview[], capturedAt:string): void`
- `addEvent(e:NewEvent): void` / `listEvents(opts?:{unseenOnly?:boolean,limit?}): EventRow[]` / `markEventsSeen(ids:number[]): void`
- `setCompetitorThemes(id:number, themesJson:string, at:string): void`

- [ ] Step 1: Failing store round-trip tests (use the established test DB shim — see `store.test.ts`/`forms.test.ts` for the `Module._load` pattern that avoids the react-server `cache()` crash).
- [ ] Step 2: Fail.
- [ ] Step 3: schema.ts tables + tenant.ts migrations (PRAGMA-guarded, idempotent — build twice) + store.ts.
- [ ] Step 4: Pass; `npx next build` twice (migration idempotent).
- [ ] Step 5: Commit.

### Task 5: Discovery (`lib/research/discovery.ts`)

**Files:** Create `lib/research/discovery.ts` + test.

**Interfaces:** Consumes Task 1 (`geocodeAddress`,`nearbyGyms`), Task 2 (`haversineKm`), Task 3 (metering), Task 4 (`upsertCompetitor`), `getBusinessProfile()` (address), a cached tenant lat/lng (store a `research_center` KV in tenant settings). **Produces:** `discoverCompetitors(radiusKm=20): Promise<{ok:true,count:number} | {ok:false,error}>` — geocode (once, cache) → nearby → filter to radius via haversine → upsert; meter each call; fail-soft.

- [ ] Step 1: Failing test (mock places + profile → N competitors upserted with distance; no-key → `{ok:false,'not_configured'}`; over-cap → skip).
- [ ] Steps 2-4: Fail → implement → pass.
- [ ] Step 5: Commit.

### Task 6: Change detection (`lib/research/changeDetect.ts`) — PURE, TDD-heavy

**Files:** Create `lib/research/changeDetect.ts` + test.

**Interfaces — Produces:** `detectChanges(prev: Metric|null, next: Metric, opts?:{spikeThreshold?:number}): NewEvent[]` — rating up/down (threshold e.g. ±0.1), review-velocity spike (reviewCount delta ≥ threshold), first snapshot (prev null) → `[]`.

- [ ] Step 1: Failing tests (table: first snapshot→none; rating +0.2→rating_up; −0.2→rating_down; +0.05→none; reviewCount +15→review_spike; no change→none).
- [ ] Steps 2-4.
- [ ] Step 5: Commit.

### Task 7: Refresh runner (`lib/research/refresh.ts`)

**Files:** Create `lib/research/refresh.ts` + test.

**Interfaces:** Consumes Tasks 1,3,4,6. **Produces:** `refreshTenant(): Promise<{ok:true,refreshed:number,events:number} | {ok:false,error}>` — for each tracked+un-muted competitor: `assertUnderResearchCap` → `placeDetails` → `appendMetric` + `replaceReviews` → `detectChanges(latest, new)` → `addEvent` each → `recordResearchSpend`; set `lastRefreshedAt`. Partial-failure resilient (one competitor's error → continue). Also opportunistically re-`discoverCompetitors` if center stale.

- [ ] Step 1: Failing test (2 competitors, mocked details → metrics appended + events written; one details error → other still processed; over-cap mid-loop → stop cleanly).
- [ ] Steps 2-4.
- [ ] Step 5: Commit.

### Task 8: AI summary + themes (`lib/research/summary.ts`)

**Files:** Create `lib/research/summary.ts` + test.

**Interfaces:** Consumes `meteredCreate` + `assertUnderCap` (AI), Task 4 (reviews, metrics). **Produces:** `competitorThemes(competitorId): Promise<string>` (AI over the review sample → 2-3 theme bullets; static fallback if over-cap/no-AI; cache via `setCompetitorThemes`), `landscapeSummary(): Promise<string>` (where this gym sits vs the set — rating percentile, review volume; NO fabrication). Use `CONTENT_MODEL`.

- [ ] Step 1: Failing test (mock meteredCreate → themes cached; over-cap → static fallback string, no throw).
- [ ] Steps 2-4.
- [ ] Step 5: Commit.

### Task 9: Scheduler hook (`lib/automations/scheduler.ts`)

**Files:** Modify `lib/automations/scheduler.ts` (+ any test for the guard).

**Interfaces:** Register a weekly "competitor-refresh" task: iterate tenants with the feature usable (has center or address + key), call `refreshTenant()` under `runWithTenant`, guarded on last-run (weekly), staggered. Follow the existing daily-task registration + CRON_SECRET guard. Read `lib/automations/scheduler.ts` first.

- [ ] Steps: read pattern → add task (guarded, weekly, per-tenant) → typecheck/build → commit. (Light test: the weekly-due guard is pure — TDD that.)

### Task 10: UI — page + list + detail + feed (`app/marketing/research/`)

**Files:** Create `app/marketing/research/page.tsx` + `ResearchView.tsx`, `CompetitorRow.tsx`, `ChangedFeed.tsx`, `CompetitorDetail.tsx`.

**Interfaces:** Consumes store (list, events, metrics, themes) + summary. Server page `requireAdminPage()` → loads competitors + events + landscape → renders. States: **no key** ("Connect Google Places" card), **no center/address** (complete business profile), **empty** ("no gyms in Xkm"), **populated** (ranked list: name·distance·rating+trend·review-velocity·sparkline; detail: rating chart, themes, recent reviews, its events; the "what changed" feed). Token-driven styling, admin-gated, `dynamic="force-dynamic"`.

- [ ] Steps: build page + components (reuse Card/Button; sparkline can be a tiny inline SVG, no dep) → typecheck/build (route compiles) → commit. (UI: reasoned states, no unit tests required beyond build; user eyeballs.)

### Task 11: Actions + curation + rescan + campaign hook (`actions.ts`)

**Files:** Create `app/marketing/research/actions.ts`; wire into ResearchView.

**Interfaces:** `await requireAdmin()` first line each. `rescanNowAction()` → `discoverCompetitors()`+`refreshTenant()` (metered), `setCompetitorFlagsAction(id,{tracked,muted})`, `addCompetitorAction(placeId|name)`, `markSeenAction(ids)`, `buildCampaignFromCompetitorAction(id)` → seed the campaign engine (reuse `campaignSeedStarterMessage`/BuildCampaignLink pattern → deep-link to the campaign builder pre-filled with the competitor gap). `revalidatePath` after mutations.

- [ ] Steps: implement (admin-gated, direct-POST safe) → typecheck/build → commit.

### Task 12: Nav + daily-brief surface

**Files:** Modify `components/layout/Sidebar.tsx` (Marketing group → add "Market research" → `/marketing/research`, admin-only). Optional: surface unseen `competitor_events` count in the dashboard DailyBrief (only if cheap + non-invasive).

- [ ] Steps: add nav link (respect existing gating pattern) → typecheck/build → commit.

### Task 13: Final whole-branch review

- [ ] Run the final code-reviewer over the branch (most-capable model): tenancy, fail-soft, metering/cap correctness, no float money, admin gates, migration idempotency, Places parse robustness, no secret leakage. Fix Critical/Important. Then finishing-a-development-branch.

## Self-Review notes
- Spec coverage: discovery(T5) · watchlist+curation(T4,T11) · weekly metrics/reviews(T7) · change feed(T6,T7) · AI landscape/themes(T8) · scheduler(T9) · UI(T10) · campaign hook(T11) · nav(T12) · metering(T3) · fail-soft(T1,everywhere). Ads/scrapers/map explicitly deferred.
- Types consistent: `ratingMilli` integer everywhere; `PlaceLite`/`PlaceDetail`/`Metric`/`NewEvent` names shared across tasks.
