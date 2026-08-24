# Market Research — Competitor Living Core (P1) — Design

**Date:** 2026-08-24 · **Status:** APPROVED (design) · pending spec review
**Owner-facing name:** Market Research (under **Marketing**)

## Goal

Give a gym owner a **living dashboard of nearby competitors** — auto-discovered
within a radius, re-scanned weekly — showing each rival's **rating & review
trends**, **what people say** (AI-themed), and a **"what changed" feed**, with a
one-click hook into the campaign engine. This is **P1 (the cheap living core)**:
Google Places only, no scrapers, no ads.

## Scope

**In (P1):**
- Discover competitors within a radius of the tenant's location (Google Places).
- A curatable watchlist (pin / mute / add-manually).
- Weekly snapshots of each tracked competitor's **rating** + **review count**.
- Sample of each competitor's **top reviews** → AI theme summary.
- **Change detection** → a per-tenant "what changed" events feed.
- AI **landscape summary** ("where you sit vs the pack").
- New admin-gated page `/marketing/research` + a **Build a campaign from this
  gap** hook into the existing campaign engine.

**Explicitly OUT of P1 (later phases):**
- **Ads** (Meta Ad Library / DSA) → **P2**.
- **Full-review pull + deep sentiment** (paid scraper, ToS grey area) → **P3**.
- **Map view** → optional polish, not P1.
- **Multi-location tenants** (P1 assumes one location from the business profile).

## The hard prerequisite

Gym **ratings/reviews only come from Google Places** (OSM has locations but no
ratings; Yelp is weak in IE). So P1 requires a **Google Cloud API key** with
**Places API (New)** + **Geocoding API** enabled, billing on, restricted to
those two APIs, server-side only. Stored as env var `GOOGLE_PLACES_API_KEY`
(same key does geocoding). No key → the feature surfaces a "connect Google
Places" setup state and does nothing else (fail-soft, never crash).

## Architecture / data flow

```
business profile address ──(Geocoding API, once, cached)──▶ tenant lat/lng
                                                              │
                        ┌─────────────────────────────────────┘
                        ▼
   Places Nearby (New): type=gym + keywords, radius ─▶ upsert `competitors`
                        │  (discovery: on first open + periodically)
                        ▼
   WEEKLY REFRESH JOB (hooks the existing daily scheduler):
     for each tracked competitor:
        Places Details (New) ─▶ snapshot {rating, reviewCount}  → `competitor_metrics`
                             ─▶ top-5 reviews                    → `competitor_reviews`
        diff vs previous snapshot ─▶ `competitor_events` (rating±, review-velocity spike)
        (if reviews changed) AI re-theme  ─── metered ───▶ cache themes on competitor
     discovery re-run occasionally ─▶ new competitor in radius → `competitor_events`
                        │
                        ▼
   /marketing/research  ─── list + detail + "what changed" feed + landscape AI
                        └── "Build a campaign from this gap" ─▶ campaign engine seed
```

All external calls (Geocoding, Places Nearby, Places Details) + AI calls are
**metered per tenant** against a cap (see Metering).

## Data model (per-tenant SQLite, additive — TENANT_MIGRATIONS + PRAGMA guard)

`competitors`
- `id` PK, `siteId` (nullable — reserved for multi-site later; P1 tenant-wide)
- `placeId` (Google, unique per tenant), `name`, `address`, `lat`, `lng`
- `distanceKm` (from tenant centre, computed at discovery)
- `source` ("google")
- `tracked` INTEGER default 1, `muted` INTEGER default 0
- `themesJson` (cached AI review-theme summary), `themesAt`
- `addedBy` ("auto" | "manual"), `firstSeenAt`, `lastRefreshedAt`

`competitor_metrics` (weekly time-series — the "living" part)
- `id` PK, `competitorId` FK, `capturedAt`
- `ratingMilli` INTEGER (rating × 1000, integer-safe), `reviewCount`

`competitor_reviews` (rolling top-5 sample for theming)
- `id` PK, `competitorId` FK, `externalReviewId`, `author`, `ratingMilli`,
  `text`, `publishedAt`, `capturedAt`

`competitor_events` (the change feed / alerts)
- `id` PK, `competitorId` FK (nullable for "new competitor"), `type`
  ("new_competitor" | "rating_up" | "rating_down" | "review_spike"),
  `summary`, `detailJson`, `occurredAt`, `seen` INTEGER default 0

## Components (files, roughly — final split in the plan)

- `lib/research/places.ts` — thin typed client over Places (New) Nearby +
  Details + Geocoding (raw `fetch`, no SDK — mirrors the MailgunSender pattern);
  every method returns a typed result, never throws.
- `lib/research/discovery.ts` — geocode tenant → Nearby search → upsert
  competitors + distance.
- `lib/research/refresh.ts` — the weekly per-tenant refresh (snapshot + reviews
  + diff → events); pure change-detection helper extracted + TDD'd.
- `lib/research/store.ts` — tenant-DB reads/writes (watchlist, metrics, events),
  curation (pin/mute/add).
- `lib/research/summary.ts` — AI landscape summary + per-competitor themes
  (metered; static fallback if over cap / no AI).
- `lib/research/spend.ts` — external-data metering (see below).
- `app/marketing/research/{page.tsx,actions.ts}` + components — the UI.
- Scheduler hook — register a weekly "competitor refresh" task in the existing
  daily scheduler (guarded on last-run, staggered across tenants).

## Metering & cost

- Every external call has a known unit cost; record it per tenant in a
  **research spend ledger** (`lib/research/spend.ts`), checked against a
  **per-tenant monthly cap** (own cap, default e.g. €10, admin-adjustable — same
  UX as the AI cap). Over cap → refresh skips + surfaces "cap reached".
- Cadence **weekly**, staggered; manual "Rescan now" button also metered.
- Rough envelope: 5–10 competitors × weekly Details + occasional Nearby +
  geocode-once + a couple AI calls ≈ **single-digit €/tenant/month**.
- AI calls (landscape, themes) go through the EXISTING AI meter/cap unchanged.

## Reuse (not greenfield)

| Need | Existing system |
|---|---|
| Refresh scheduling | in-process daily scheduler (`lib/automations/scheduler`, `/api/cron/daily`) |
| Tenant location | `getBusinessProfile()` address → geocode + cache |
| AI summaries/themes | `meteredCreate` + `assertUnderCap`/`recordUsage` + per-tenant cap |
| Alerts surface | dashboard **DailyBrief** can ingest unseen `competitor_events` |
| The payoff | **campaign engine** seed ("Build a campaign from this gap") |
| Admin gating | `requireAdminPage()` / `requireAdmin()` first-line in actions |
| HTTP-client style | raw `fetch` + typed results (MailgunSender pattern) |

## Error handling / edge cases

- **No key** → feature renders a "Connect Google Places" setup card; jobs no-op.
- **Missing / un-geocodable address** → prompt to complete the business profile; no crash.
- **Places returns 0 competitors** → empty state ("no gyms found in Xkm — widen radius?").
- **A competitor delisted / place_id gone** → mark inactive, keep history, event.
- **Rate limit / API error** → typed failure, logged, refresh continues to next
  competitor; partial results are fine.
- **Over cap** → skip remaining calls that cycle; show cap state.
- **Tenancy** → all reads/writes on the ambient tenant `db`; a competitor's
  events/metrics never leak across tenants.
- **Money/ratings integer-safe** (`ratingMilli`, cents) throughout.

## Testing

- Pure change-detection (snapshot diff → events) — TDD, table of cases
  (rating up/down, first snapshot = no event, review-velocity spike threshold).
- Pure distance (haversine) + Places response → competitor mapping.
- Store round-trips (watchlist curation, metrics append, events unseen).
- Metering: cap enforcement (record → over-cap → skip).
- Places client parses the New API shapes (fixtures, no live calls in tests).
- Gate: `npm run typecheck` + `node scripts/test.mjs` + `npx next build`.

## Decisions (defaults — confirm at review)

- **Radius:** 20km default, per-tenant editable.
- **Cadence:** weekly.
- **Competitor cap for cost:** track up to ~15; owner curates beyond that.
- **Spend cap:** own per-tenant research cap (default €10, admin-adjustable);
  AI portion still on the AI cap.
- **Scope unit:** per-tenant (one location from business profile); multi-site later.

## Phasing (post-P1)

- **P2 — Ads:** Meta Ad Library (EU/DSA) → track competitor FB/IG ads (new/stopped),
  reuse the existing Meta app; `competitor_ads` table + ad gallery + new-ad alerts.
- **P3 — Depth:** full-review pull (paid scraper, opt-in) + sentiment; map view.
