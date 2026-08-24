# Market Research P2 — Competitor Ads (Meta Ad Library) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show each tracked competitor's live/recent Facebook & Instagram ads (copy, dates, platforms), detect new-ad/ad-stopped into the "what changed" feed, and AI-summarise their ad angle → counter-campaign hook. Fail-soft with no Meta token.

**Architecture:** New `lib/research/adLibrary.ts` client (Meta `ads_archive`, EU/DSA commercial ads) → `competitor_ads` table + store → ad-fetch folded into `refreshTenant()` → pure ad-diff → `new_ad`/`ad_stopped` events → gallery in `CompetitorDetail` + AI ad-angle. Extends P1. Spec: `docs/superpowers/specs/2026-08-24-market-research-p2-competitor-ads-design.md`.

**Tech:** Next.js 14, drizzle + better-sqlite3 (per-tenant), raw `fetch` (no SDK), existing AI metering, P1's engine.

## Global Constraints

- **Fail-soft:** no `META_AD_LIBRARY_TOKEN` → `adLibraryConfigured()` false → every ad path no-ops (client, refresh, scheduler, detail render). Never throw to a request/render.
- **Every Ad Library method returns a typed result** (`{ok:true,ads}` | `{ok:false,error}`) — never throws (mirror `places.ts`).
- **EU/DSA query:** `ad_type=ALL` + `ad_reached_countries=['<tenant country, default IE>']` + `search_terms=<name>`. Rate limit 200/hr → 1 call per competitor per refresh; handle HTTP 429 as a typed failure (skip, resume next cycle).
- **Free API → no € cost:** do NOT change the research €-cap; record ad-fetch in the usage ledger with `kind:"adlib"` cost 0 (observability). AI ad-angle uses the EXISTING AI cap.
- **Creatives:** rely on ad TEXT + `ad_snapshot_url` (link out); embed an image only if a usable URL is present. No media download.
- **Tenancy:** ambient `db`; additive PRAGMA-guarded migration (mirror P1's `is_self`/research tables). Admin-gated UI/actions (page already `requireAdminPage`; actions `requireAdmin` first).
- **No fabrication** in the AI ad-angle (only the real ad copy). **Skip the self gym** (P1.1 `isSelf`) for ad-fetch.
- Gate each task: `npm run typecheck` + `node scripts/test.mjs` + `npx next build`.

## File Structure
```
lib/research/adLibrary.ts       — typed Meta ads_archive client + adLibraryConfigured()
lib/research/adDiff.ts          — pure: prev active set vs new → new_ad/ad_stopped events
lib/db/schema.ts + tenant.ts    — competitor_ads table (+ optional competitors.adAngleJson/adAngleAt)
lib/research/store.ts (extend)  — upsertAd / listAds / activeAdIds / markAdsStopped
lib/research/refresh.ts (extend)— fold ad-fetch + diff into refreshTenant() (guarded)
lib/research/summary.ts (extend)— adAngle(competitorId) (metered, no-fab, static fallback)
app/marketing/research/actions.ts (extend) — rescan pre-warms adAngle
components/research/CompetitorDetail.tsx — ad gallery
components/research/ChangedFeed.tsx      — new_ad/ad_stopped rows
components/research/CompetitorRow.tsx    — optional "advertising" badge
lib/env.ts                      — add META_AD_LIBRARY_TOKEN to RECOMMENDED_VARS
```

---

### Task 1: Ad Library client (`lib/research/adLibrary.ts`)
**Produces:** `adLibraryConfigured():boolean` (`!!META_AD_LIBRARY_TOKEN`); `AdLite = {adId,bodies:string[],linkTitle?:string,linkCaption?:string,platforms:string[],snapshotUrl:string,startedAt?:string,stoppedAt?:string,imageUrl?:string}`; `searchCompetitorAds(name:string, country?:string): Promise<{ok:true,ads:AdLite[]}|{ok:false,error:string}>`.
**Notes:** GET `https://graph.facebook.com/v21.0/ads_archive?ad_type=ALL&ad_reached_countries=['<country||IE>']&search_terms=<enc name>&fields=id,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms,ad_snapshot_url&limit=25&access_token=<TOK>`. Parse `data[]`; tolerate missing fields; `active` = no stop time or stop in future; 429/non-2xx/throw → `{ok:false}`. No token → `{ok:false,"not_configured"}` without calling.
- [ ] TDD parser with `ads_archive` fixtures (mock fetch, no live calls) → fail → implement → pass → commit.

### Task 2: Pure ad-diff (`lib/research/adDiff.ts`)
**Produces:** `diffAds(prevActiveIds:Set<string>, current:AdLite[], competitorName:string, opts?:{recentWindowDays?:number}): {upserts:AdLite[]; events:NewEvent[]}` — a current ad whose id ∉ prev AND `startedAt` within window → `new_ad` event; a prev-active id absent from current → `ad_stopped`; first-ever fetch (prev empty) seeds without spamming (only `new_ad` for ads started within the window). TDD table (new/stopped/unchanged/first-seed).
- [ ] TDD → commit.

### Task 3: `competitor_ads` table + store (`schema.ts`/`tenant.ts`/`store.ts`)
**Produces:** table per the spec; `upsertAd(competitorId, ad, at)`, `listAds(competitorId):StoredAd[]`, `activeAdIds(competitorId):Set<string>`, `markAdsStopped(competitorId, ids, at)`. Additive PRAGMA-guarded migration (idempotent; build twice). TDD store round-trips (Module._load shim).
- [ ] TDD → double-build → commit.

### Task 4: Fold ad-fetch into refresh (`refresh.ts`)
**Consumes:** T1–T3. In `refreshTenant()`, after the metrics/reviews loop, if `adLibraryConfigured()`: for each tracked NON-self competitor → `searchCompetitorAds(name, country)` → `diffAds(activeAdIds(prev), ads, name)` → `upsertAd` each + `markAdsStopped` the vanished + `addEvent` each event; record `kind:"adlib"` (cost 0). 429/error per competitor → log + continue (resilient). Skip entirely if not configured. TDD (mocked) the loop's new/stopped wiring.
- [ ] TDD → commit.

### Task 5: AI ad-angle (`summary.ts`)
**Produces:** `adAngle(competitorId):Promise<string>` — reads the competitor's stored ad copy; if none → "No active ads found." (no AI); else metered `meteredCreate` (CONTENT_MODEL) → 1–2 line read of their angle strictly from the copy (no-fab); cache on `competitors.adAngleJson`/`adAngleAt`; static fallback over-cap. TDD (mock meteredCreate).
- [ ] TDD → commit.

### Task 6: UI — ad gallery + feed rows + row badge
**Consumes:** store (listAds), cached adAngle. `CompetitorDetail` gains an **Ads** section: cached ad-angle line + ad cards (copy lines + platform badges + run dates + "View on Meta" → snapshotUrl; thumbnail if imageUrl). `ChangedFeed` renders `new_ad`/`ad_stopped` with distinct icons. `CompetitorRow` optional subtle "advertising" badge when the competitor has ≥1 active ad. Zero AI/Google on render (reads store + cached angle only). No-token state = a subtle "Connect Meta Ad Library" note in the Ads section.
- [ ] Build → typecheck/build → commit.

### Task 7: Actions + rescan pre-warm + campaign seed + scheduler + env
**Consumes:** T4/T5. `rescanNowAction` (after refresh) pre-warms `adAngle(id)` per competitor (like themes). `buildCampaignFromCompetitorAction` seed extended to include the ad angle ("they're running X — counter with…", no-fab). The weekly scheduler already calls `refreshTenant()` (which now does ads) — confirm no extra work, just verify the guard. Add `META_AD_LIBRARY_TOKEN` to `env.ts` RECOMMENDED_VARS. `await requireAdmin()` first line on any new/changed action.
- [ ] Build → typecheck/build → commit.

### Task 8: Whole-branch review + deploy
- [ ] `scripts/review-package` the P2 range → final reviewer (most-capable): fail-soft (no token), tenancy, never-throws, rate-limit handling, admin gates, migration idempotency, no-fab AI, no secret leakage (token server-only), self-gym skipped, ad-diff seed correctness. Fix Critical/Important → deploy → finishing-a-development-branch.

## Self-Review
- Spec coverage: client(T1) · diff(T2) · storage(T3) · refresh-fold(T4) · AI angle(T5) · UI gallery+feed+badge(T6) · actions/rescan/campaign/scheduler/env(T7) · review(T8). Page-ID matching / Google-TikTok / spend / media-download explicitly deferred.
- Types consistent: `AdLite`/`StoredAd`/`NewEvent` shared; `adLibraryConfigured` gate everywhere; `new_ad`/`ad_stopped` event types added to P1's `competitor_events`.
