# Campaign Engine — Slice 4: Campaign Build Model + Cost Estimator — Design

**Date:** 2026-08-20 · **Status:** APPROVED (design; scope chosen: "Model choice + estimate")
**Builds on:** Slices 1–3 (Campaign Kit, Funnel, Seasonal Calendar) — all live.
**Decision locked (brainstorm):** the operator wants to see **"≈ €X to build this campaign"** *and* have it **vary by the AI model selected**. Because campaign asset generation is currently hard-wired to `CONTENT_MODEL` (Sonnet) and the model picker only affects agent *chat*, delivering "based on the selected model" requires making the **campaign-build model a real, admin-set, per-tenant choice** — which this slice does, alongside the estimator. Estimate shows at **plan time** (before build) **and** on the **launch confirmation**.

## Goal

An admin can pick which model builds a tenant's campaign assets (Sonnet default; cheaper models = lower cost, at some copy-quality tradeoff). The agent shows an **estimated build cost** for a campaign kit — at plan time and at launch — computed from that model's real per-token pricing, so a cheaper model visibly lowers the number.

## Non-goals (later / out of scope)

- **Per-campaign actual-spend tracking** (`ai_usage` is per-tenant, not per-campaign) — the shown figure is an honest *estimate*, not a post-hoc bill.
- **Image-generation cost** — the campaign kit is **text-only** (verified: `generate.ts` never calls FLUX/fal; AI Post Imagery is a separate Content-Studio flow). The estimate covers the text assets only; if images are later folded into the kit, add their flat cost then.
- **Changing Content Studio's model** — this slice scopes the model choice to **campaign asset generation** only; blog/carousel/etc. keep `CONTENT_MODEL`.
- **Tenant self-serve model switching** — the campaign-build model is **admin-controlled** (agency-set per tenant), for quality control.
- **Streaming/agent-chat model** — unchanged (`agents.model` still drives the conversational loop).

## Architecture (assembles existing rails)

### 1. Per-tenant "campaign build model" setting
- A new per-tenant setting `campaignBuildModel` (a `MODEL_CATALOG` id string), **admin-only** to set, default `CONTENT_MODEL` (`MODELS.sonnet`) when unset. Validated against the `MODEL_CATALOG` allowlist (same guard the agent picker uses — an unknown/`fable` id can never be stored).
- **Resolver** `getCampaignBuildModel(): string` (tenant-scoped, ambient) → the stored id if it's a current `MODEL_CATALOG` id, else `CONTENT_MODEL`. Fail-safe: never returns an unpriced/unknown model.
- **Storage:** reuse the existing per-tenant settings mechanism (the same store `getSettings`/business settings use, or a dedicated `settings` KV row) — no new table if an existing KV fits; a single string value. (Plan picks the exact store after reading `lib/settings.ts`.)

### 2. Generation honors the setting
- The campaign asset generators in `lib/campaigns/generate.ts` (and any sibling campaign generator — `draftCampaignEmail`, the social/carousel path if it routes through here) call `getCampaignBuildModel()` instead of the hard-wired `CONTENT_MODEL`. Metering is unchanged (still `meteredCreate`, agentKey `marketing`); only the `model:` field changes. This makes the model choice actually drive spend **and** output.
- Careful scoping: only the **campaign** generation path changes. `CONTENT_MODEL` stays the literal default and remains used by Content Studio (blog/carousel) untouched.

### 3. The cost estimator (pure)
- `lib/campaigns/costEstimate.ts`:
  - `AVG_TOKENS: Record<AssetKind, { in: number; out: number }>` — heuristic average token counts per asset kind (input dominated by the Marketing Brain + prompt ~2000–2500 tok; output sized to the asset: blog ~1500, video_script ~800, offer/landing ~450–500, email ~450, social ~200, ad_copy ~180). Documented as estimates.
  - `estimateCampaignBuildCents(assets: { kind: AssetKind }[], model: string): number` = Σ `estCostCents(model, { inputTokens, outputTokens })` over the assets (reuses the metering layer's own `estCostCents` + `PRICING`, so the estimate and the real charge share one price source).
  - `formatCentsEur(cents): string` → `"€0.15"` style.
- **Pure + unit-tested** (no AI, no DB): known-plan × known-model → known cents; a cheaper model yields a strictly lower number than Sonnet; an unknown/omitted model prices as Sonnet (mirrors `estCostCents`'s own fallback).

### 4. Show it at plan time
- `plan_campaign` (`tools.campaign.ts`) already returns the transient plan (asset list + offer). Add `estimateCents` + the resolved model **label** to its result, and surface it in the plan message the agent shows ("≈ €0.15 to build these 11 assets on Sonnet 5 — switch the campaign model in settings to change this."). This is the decision-useful moment (before generation spends anything).

### 5. Show it at launch + on the hub
- The campaign detail hub (`/marketing/campaigns/[id]`) and/or `LaunchCampaignButton` show the same estimate as a recap ("estimated build cost ≈ €X on <model>"). At launch the assets are already built, so this is informational, not a gate.

### 6. The admin model selector
- An **admin-only** "Campaign build model" `<select>` (from `MODEL_CATALOG`, showing label + provider) on the campaigns hub (`/marketing/campaigns`), persisted via a small server action → the setting in (1). Non-admins don't see it (same gating as other admin controls). Reuses the model-catalog list the agent picker already renders.

## Data / metering / security / testing / rollout

- **Data:** one per-tenant string setting; no new table if the settings KV fits (plan confirms). No migration expected.
- **Metering:** the estimator is pure math — **no AI call, no new spend**. Generation stays on `meteredCreate` under the cap; only which model runs changes.
- **Security/tenancy:** the setting is read/written under the ambient tenant; the selector + the write action are **admin-gated**. The model id is always validated against `MODEL_CATALOG` before storage and re-validated on read (fail-safe to Sonnet) — a bad/removed id can never reach `estCostCents`/generation.
- **Honesty:** the figure is labelled an **estimate** everywhere; the copy notes it's model-dependent. No fabricated precision.
- **Tests (pure, DB-free):** `estimateCampaignBuildCents` (known plan+model → known cents; cheaper-model-is-cheaper; unknown-model→Sonnet), `getCampaignBuildModel`'s validation/fallback (with the store stubbed), `formatCentsEur`. Gate: typecheck + `npm test` + build.
- **Rollout:** additive — one setting, one resolver, one pure estimator, one admin selector, a `generate.ts` model swap, and estimate display at plan/launch/hub. No env. Existing tenants default to Sonnet (today's behavior) until an admin changes it. Deploy `railway up` from `app/`.

## Tasks (for the plan)
1. Per-tenant `campaignBuildModel` setting + `getCampaignBuildModel()` resolver (validated, Sonnet-fallback) — TDD the resolver.
2. Pure cost estimator (`costEstimate.ts`: `AVG_TOKENS`, `estimateCampaignBuildCents`, `formatCentsEur`) — TDD.
3. Wire `generate.ts` (+ sibling campaign generators) to `getCampaignBuildModel()`; keep Content Studio on `CONTENT_MODEL`.
4. Surface the estimate in `plan_campaign`'s result + the plan message; show it on the hub/launch.
5. Admin "Campaign build model" selector on the campaigns hub + its server action.
6. Final whole-branch review.
