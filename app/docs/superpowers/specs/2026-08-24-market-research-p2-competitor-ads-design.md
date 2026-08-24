# Market Research P2 — Competitor Ads (Meta Ad Library) — Design

**Date:** 2026-08-24 · **Status:** APPROVED (design) · pending spec review
Extends **Market Research P1** ([[market-research-p1]]) — the competitor living dashboard. P2 adds the "see what ads they're running" half of the original vision.

## Goal

For each tracked competitor, show their **live + recent Facebook/Instagram ads** (copy, run dates, platforms), detect **new ads launched / ads stopped** into the "what changed" feed, and AI-summarise **their ad angle** → wired into Build-a-campaign so the operator can counter it. Fail-soft with no Meta token (like P1 with no Google key).

## The data-source reality (verified)

Meta's **Ad Library API** (`ads_archive`) returns **commercial ads** — but only for **EU-reaching ads** (DSA Article 39 forces Meta to expose every ad shown in the EU: creative, advertiser, run dates, platforms, aggregate reach, kept 1 year). Our gyms are in **Ireland (EU)** → `ad_type=ALL` + `ad_reached_countries=['IE']` returns their commercial FB/IG ads. Free tier, **200 calls/hour** (ample for a weekly refresh of ~15 competitors). Reuses the tenant/operator's existing **Meta app**.

**Honest constraint on creatives:** the API reliably returns ad **text** (`ad_creative_bodies`, `ad_creative_link_titles`, `ad_creative_link_captions`), delivery dates, `publisher_platforms`, and an **`ad_snapshot_url`** (a Meta-hosted page rendering the full ad). Direct, embeddable creative-image URLs are NOT reliably provided. So the in-app gallery is **ad-copy cards + platform/date badges + a "View on Meta" link to the snapshot** — embed a thumbnail only if a usable image URL is present. The AI "ad angle" reads the ad **copy** (always available), so it works regardless.

## Scope

**In (P2):**
- A typed Ad Library client (fail-soft, never-throws).
- Per-competitor ad fetch by **name search** (`search_terms`), country=tenant's (IE), stored in `competitor_ads`.
- Fold ad-fetch into the **weekly refresh** + **manual rescan**; detect **new_ad / ad_stopped** → change events in the feed.
- **Ad gallery** on the competitor detail (copy + dates + platforms + snapshot link).
- AI **"ad angle"** summary per competitor (metered, no-fabrication) + a **counter-campaign** seed.
- Fail-soft everywhere; respects the 200/hr rate limit.

**Out of P2 (later):**
- **Page-ID matching** (precise advertiser resolution) — v1 uses name search (some noise; operator curates). Deferred.
- Google/TikTok ad transparency (other DSA repositories).
- Exact spend (API gives bucketed ranges only).
- Downloading/hosting creative media.

## Prerequisite (operator, done in parallel — NON-blocking, feature is fail-soft)

A **Meta Ad Library API access token** in Railway as `META_AD_LIBRARY_TOKEN`. This endpoint historically requires a one-time **identity + location confirmation** on the Meta account (facebook.com/ID) — the long pole (Meta can take a few days). Steps given separately. No token → `adLibraryConfigured()` false → all ad features no-op (dashboard, refresh, detail), exactly like P1's no-key path.

## Architecture / data flow

```
tracked competitor (name)
        │  (weekly refresh + manual rescan; only if adLibraryConfigured())
        ▼
Ad Library API: ads_archive?ad_type=ALL&ad_reached_countries=['IE']
                &search_terms=<name>&fields=id,ad_creative_bodies,
                ad_creative_link_titles,ad_delivery_start_time,
                ad_delivery_stop_time,publisher_platforms,ad_snapshot_url
        ▼  typed, never-throws, rate-limit-aware
upsert into `competitor_ads` (by ad id) ; mark still_active ; set last_seen
        ▼
diff vs previous ad set → `competitor_events`:
   "new_ad"  (an ad id not seen before, started recently)
   "ad_stopped" (a previously-active ad now inactive)
        ▼
UI: competitor detail → ad gallery ; feed → new-ad rows ;
    AI adAngle(competitor) [metered] → "Build a counter-campaign"
```

## Data model — new tenant table (additive, PRAGMA-guarded migration)

`competitor_ads`
- `id` PK, `competitorId` INTEGER (FK-ish), `adId` TEXT (Meta archive id; unique per competitor)
- `bodies` TEXT (JSON: the ad copy lines), `linkTitle` TEXT null, `linkCaption` TEXT null
- `platforms` TEXT (JSON: ["facebook","instagram"]), `snapshotUrl` TEXT
- `startedAt` TEXT null, `stoppedAt` TEXT null, `active` INTEGER default 1
- `firstSeenAt` TEXT, `lastSeenAt` TEXT
- (optional) `imageUrl` TEXT null — only if the API yields a usable one

Reuse P1's `competitor_events` for `new_ad`/`ad_stopped` (new event `type` values). Optionally cache the AI ad-angle on `competitors` (a new `adAngleJson`/`adAngleAt`, mirroring `themesJson`).

## Components (final split in the plan)

- `lib/research/adLibrary.ts` — typed client: `adLibraryConfigured()`, `searchCompetitorAds(name, country): Promise<{ok,ads}|{ok:false,error}>` (raw fetch, field mask, never-throws, 200/hr-aware). Mirrors `places.ts`'s shape.
- `lib/research/adStore.ts` (or extend `store.ts`) — `upsertAd`, `listAds(competitorId)`, `activeAdIds(competitorId)`, mark-stopped.
- `lib/research/adRefresh.ts` (or extend `refresh.ts`) — per-competitor ad fetch → upsert → diff → new_ad/ad_stopped events. Folded into `refreshTenant()` (guarded on `adLibraryConfigured()`).
- `lib/research/adAngle.ts` (or extend `summary.ts`) — AI ad-angle from the ad copy (metered, static fallback, no-fab).
- UI: extend `components/research/CompetitorDetail.tsx` with the ad gallery; `ChangedFeed.tsx` gets new_ad/ad_stopped rows; optionally an "advertising" badge on `CompetitorRow`. Campaign seed extended to include the ad angle.
- Rescan action (`actions.ts`) pre-warms the ad angle (like it pre-warms themes).

## Metering / rate-limit

- The Ad Library API is **free** (no € cost) — so NO change to the research €-cap. Instead, respect the **200 calls/hour** limit: the weekly refresh does 1 call per tracked competitor (≤15), well under; the manual rescan same; **stagger** if a tenant somehow exceeds. Record ad-fetch calls in the research usage ledger with a `kind:"adlib"` and `UNIT_COST_CENTS.adlib = 0` (observability, not billing). Handle HTTP 429 → back off gracefully (typed failure, retry next cycle).
- AI ad-angle uses the EXISTING AI cap (like themes).

## Reuse (P1)

Same tenancy (ambient `db`), fail-soft contract, weekly scheduler (adds the ad step), change-feed, competitor detail, campaign hook, admin gating, `TENANT_MIGRATIONS` pattern, the never-throws + typed-result house style.

## Error handling / edge cases

- **No token** → `adLibraryConfigured()` false → every ad feature no-ops; the detail shows a subtle "Connect Meta Ad Library" note; scheduler/rescan skip the ad step. Never throws.
- **No ads found** for a competitor (many small gyms don't advertise) → empty gallery ("No active ads found"), not an error. Common + expected.
- **Name-search noise** (a search returns ads from a differently-named advertiser) → v1 accepts it; the operator can mute a competitor; v2 Page-ID matching fixes it. Store the advertiser/page name on the ad so obvious mismatches are visible.
- **Rate limit (429)** → typed failure, skip remaining this cycle, resume next; never crash.
- **Snapshot images** don't embed → fall back to copy + "View on Meta" link (the design assumes this).
- **Tenancy** — all ad rows on the ambient tenant `db`; never cross-tenant.
- **Self gym** (P1.1 `isSelf`) — skip ad-fetch for the tenant's own gym (or show it under "Your gym" — but don't treat as a competitor).

## Testing

- Pure: the ad-diff (previous active set vs new set → new_ad/ad_stopped events) — TDD table (a new ad → new_ad; a vanished ad → ad_stopped; unchanged → none; first fetch → all new_ad but only if started recently, else just seed).
- Ad Library response parser (fixtures of `ads_archive` JSON → typed ads; missing fields tolerated; never-throws).
- Store round-trips (upsert ad, list, active set, mark stopped).
- Fail-soft (no token → configured false → no calls).
- Gate: typecheck + `node scripts/test.mjs` + `next build` (twice — migration idempotent).

## Decisions (defaults — confirm at review)

- **Matching:** name search (`search_terms`) v1; Page-ID v2 deferred.
- **Country:** the tenant's country (IE for Inspire) — derive from the business profile / centre; default IE.
- **Refresh:** ad-fetch folded into the existing weekly refresh + manual rescan (not a separate cadence).
- **New-ad "recently":** an ad is `new_ad` only if its `ad_delivery_start_time` is within ~the last refresh window (so the first bulk fetch seeds without spamming 40 "new ad" events — mirror P1's discovery-seed vs real-change rule).
- **Env var:** `META_AD_LIBRARY_TOKEN`.
