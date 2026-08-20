# Campaign Engine — Slice 5: CFA/ROAS Per-Campaign Scoreboard — Design

**Date:** 2026-08-20 · **Status:** APPROVED (design)
**Builds on:** Slices 1–4 (Campaign Kit, Funnel, Seasonal Calendar, Build-Model+Estimator) — all live.
**Decision locked (brainstorm):** revenue is **pulled from memberships/packages** (not typed in); ad spend is the **one manual per-campaign input**; the revenue metric shows **both** upfront cash (drives the CFA verdict) **and** MRR added. Hormozi **CFA** framing: did the campaign's front-end sales cover the acquisition cost?

## Goal

On each campaign's hub, show what the campaign actually returned: leads → converts → revenue vs ad spend, with the headline **CFA ✓/✗** (upfront cash ≥ ad spend?), plus CAC, ROAS, and MRR added. Revenue is real (from the converts' memberships/packages); ad spend is the operator's one manual input.

## Non-goals (later / out of scope)

- **Auto ad-spend from the FB/Google Ads API** — deferred (FB App Review); ad spend is manual this slice.
- **Multi-touch / time-decay attribution** — a lead is attributed to exactly one campaign (`leads.campaign`, already the model since Slice 2). Last-touch, single-campaign.
- **LTV / churn modelling** — MRR added is a run-rate snapshot, not a forecast.
- **Cross-campaign roll-up dashboards** — this is the per-campaign hub view; a portfolio scoreboard is a later slice.
- **Editing revenue** — revenue is read-only (derived); only ad spend is editable.

## Architecture

### 1. Ad spend — the one manual input
- Add `adSpendCents INTEGER NOT NULL DEFAULT 0` to the per-tenant `campaigns` table (additive column via the established `TENANT_MIGRATIONS` + `PRAGMA table_info` guard pattern — same as the `leads.stage_id` addition; no data loss, idempotent).
- Admin-editable on the campaign hub: a small "Ad spend (€)" field + a server action (`setCampaignAdSpend`, admin-gated, euros→cents, clamps ≥ 0). Persisted on the campaign row.

### 2. Convert detection (campaign → won lead → client)
- The campaign's **leads** = `leads WHERE campaign = campaign.name` (the Slice-2 attribution; reuse `countLeadsByCampaign`'s query shape).
- A **convert** = such a lead that (a) is in a **won-role** pipeline stage (the pipeline engine's won/repeat roles — reuse `lib/pipeline`'s role sets, not a hardcoded stage name) AND (b) resolves to a **client**: primarily `leads.clientId`, with an **email/phone match** to `clients` as a fallback (both tables carry email + phone) so attribution is robust when `clientId` wasn't set explicitly.
- Produces, per campaign, the set of **converted client ids**.

### 3. Revenue from memberships/packages (per converted client)
Reads existing tenant tables, all `clientId`-scoped, statuses respected:
- **`clientMemberships`** (`priceCents` monthly, `status`): active memberships contribute their `priceCents` to **MRR added**, and (once each) their first month to **upfront cash**.
- **`clientPackages`** (`priceCents`, one-off, `status`): active/valid packages contribute `priceCents` to **upfront cash**.
- **`packages`** (clinic therapy, `pricePaidEur` → cents, one-off): contribute to **upfront cash** (Renova/clinic venues).
- Only revenue from the campaign's **converted** clients counts.

### 4. The pure scoreboard computation (unit-tested)
`lib/campaigns/scoreboard.ts` — a **pure** `computeCampaignScoreboard(input)` separated from the DB reads so the math is testable in the DB-free runner:
```
input:  { leads, converts, adSpendCents, aiBuildCents,
          upfrontCashCents, mrrCents }
output: { leads, converts, conversionRatePct,
          adSpendCents, aiBuildCents,                   // aiBuild = the Slice-4 estimate, shown as a small SEPARATE line
          cacCents,                                     // adSpend / converts (null if 0 converts)
          upfrontCashCents, mrrCents,
          cfaCovered: boolean, cfaRatio,                // upfrontCash ≥ adSpend?  ratio = upfrontCash / adSpend
          roas }                                        // upfrontCash / adSpend (null if adSpend 0)
```
**CFA/CAC/ROAS use `adSpend` as the acquisition cost** — matches the operator's "did it cover the ad spend?" framing; the AI build cost (~€0.15) is a small informational line only, never in the ratio denominators. Divide-by-zero safe (0 converts → CAC null/"—"; 0 ad spend → ROAS/CFA-ratio null/"add ad spend"). A thin async gatherer (`getCampaignScoreboard(campaign)`) runs the §2/§3 DB reads + the Slice-4 `estimateCampaignBuildCents` and calls the pure fn.

### 5. The hub panel
On `/marketing/campaigns/[id]`, a "Scoreboard" section: the **CFA verdict** as the hero (✓ "Self-funded — front-end sales covered the €X spend" / ✗ "€Y short of covering spend"), then a compact stat grid (Leads · Converts · Conv. rate · Ad spend [editable] · CAC · Upfront cash · MRR added · ROAS · AI build cost). Honest empty states: no ad spend set → prompt to add it (CAC/CFA/ROAS show "—" until then); no converts → "No conversions attributed yet." Admin-only for the ad-spend editor; the read-only scoreboard shows for any staff who can see the hub.

## Security, tenancy, metering, testing, rollout
- **Tenancy:** all reads/writes under the ambient tenant; the per-tenant DB is the structural guard. The email/phone convert-match is within the tenant's own `clients` only.
- **Security:** ad-spend edit is admin-gated (server action re-checks admin, like the Slice-4 selector). Read-only scoreboard is staff-visible.
- **Metering:** the scoreboard makes **no AI call** — it reuses the pure Slice-4 estimator for the AI-build line. Zero new spend.
- **Money correctness:** all money normalized to **integer cents** internally (`clientMemberships`/`clientPackages` are already cents; `packages.pricePaidEur` × 100; ad spend euros × 100). Formatting via a shared cents→€ helper.
- **Tests (pure, DB-free):** `computeCampaignScoreboard` — CFA covered/not, CAC/ROAS/conversion-rate math, all the zero-guards (0 leads, 0 converts, 0 spend), upfront-vs-MRR separation. Plus the pure convert-revenue aggregation helper if extracted (sum memberships/packages → {upfront, mrr}). Gate: typecheck + `npm test` + build.
- **Rollout:** one additive column (ad spend) + a migration; two new lib modules (convert/revenue gather + pure scoreboard); one hub panel + one server action. Existing campaigns start at €0 ad spend (scoreboard shows leads/converts/revenue immediately; CAC/CFA/ROAS activate once spend is entered). Deploy `railway up` from `app/`.

## Tasks (for the plan)
1. `campaigns.adSpendCents` column (schema + additive migration) + `setCampaignAdSpend` store fn (clamp ≥0). TDD the clamp/migration guard reasoning.
2. Convert + revenue gather (`lib/campaigns/scoreboardData.ts`): campaign→won-leads→client (clientId + email/phone fallback) → converted client ids; sum their memberships/packages into `{ upfrontCashCents, mrrCents }`. Extract a **pure** revenue-aggregation helper (records → {upfront, mrr}) and TDD it.
3. Pure `computeCampaignScoreboard` (`lib/campaigns/scoreboard.ts`) — all the metric math + zero-guards. TDD thoroughly.
4. Hub panel on `/marketing/campaigns/[id]` (CFA hero + stat grid) + the admin ad-spend editor (field + server action). Wire `getCampaignScoreboard`.
5. Final whole-branch review.
