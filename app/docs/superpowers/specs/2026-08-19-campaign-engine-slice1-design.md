# Campaign Engine — Slice 1: the Campaign Kit (agent-built, step-approved) — Design

**Date:** 2026-08-19 · **Status:** APPROVED
**Decisions locked:** content-kit first (no public funnel yet) · conversational "ask Adonis" in the Marketing agent chat · **per-artifact Approve / Go-again** loop · engine at **`/marketing/campaigns`** (the empty "Marketing" nav slot); email marketing relabelled **"Email campaigns"** (route unchanged) · **3-email sequence** (announce → proof → last-chance) · **materialise-on-approve as drafts** in real homes, then a **"Launch"** step posts/publishes/sends the approved kit.

## Goal

A gym operator asks the **Marketing agent** in chat — *"Adonis, build me a Summer Shape Up 2026 campaign"* — and Adonis builds a cohesive campaign **one piece at a time, from the Marketing Brain**. Each piece (the offer, the blog, each social post, the email, the ad copy, the video scripts) is drafted and presented in the chat as a card with two buttons: **Approve** (persist + move on) and **Go again** (regenerate — optionally with a tweak note). Nothing is kept until approved. The finished kit lives on a **campaign** the operator can revisit.

## Non-goals (later slices)

- **Slice 2:** the public branded **landing page** + **"Sign up now" form → campaign-attributed leads**. (Not here.)
- **Slice 3:** seasonal **calendar** + **daily-brief "are we ready for September?" radar** + the **CFA scoreboard**.
- Social **auto-posting / scheduling** (needs FB App Review — deferred); real **ad-platform push** (deferred).
- Multi-pipeline / new stages — campaigns **attribute** leads (existing `leads.campaign` + board filter), never new stages.

## The interaction (the heart of this slice)

A structured build **surfaced in the existing agent chat**, reusing its SSE + Approve-card mechanics:

1. **Ask.** Operator: *"build me a Summer Shape Up 2026 campaign."*
2. **Plan (step 0).** Agent calls `plan_campaign` (READ) → proposes `{name, season, start/end, the OFFER/angle drawn from the Marketing Brain, the ordered artifact list}`. Renders as a **plan card** with **Approve** / **Go again**.
   - *Go again* (or the operator types a tweak) → re-plan.
   - *Approve* → `create_campaign` (WRITE, gated) creates the campaign (status `building`) + the artifact rows (status `pending`, in order).
3. **Per-artifact loop (steps 1..N).** For each artifact in order, the agent calls `draft_campaign_asset` (READ) → generates it from the Brain + the campaign offer → renders an **artifact card** (the draft) with **Approve** / **Go again**.
   - *Go again* → `draft_campaign_asset` re-runs (with the operator's optional tweak note) → new draft replaces the shown one.
   - *Approve* → `approve_campaign_asset` (WRITE, gated) stores the approved content and **materialises** it to its real home (below), then the agent advances to the next artifact.
4. **Done drafting.** When every artifact is approved, campaign → status `ready`. Each approved asset already lives as a **draft in its real home** (CMS blog draft, Content Studio carousel, email-campaign draft) — see materialise-on-approve.
5. **Launch (one action, at the end).** From the campaign hub (or the chat), a **"Launch campaign"** control fires the whole kit at once: **publish** the blog to the live site, **send/schedule** the 3-email sequence, and mark the socials **ready-to-post**. Social *auto-posting* needs FB App Review (deferred — for v1 "ready-to-post" = exported/queued for manual posting, clearly labelled). Launch flips the campaign `ready → active`.

**Why this fits:** the agent already does draft (READ, shown in chat) → Approve-card → gated WRITE via `/api/assistant/execute`. This slice adds (a) a second **"Go again"** button on the card that re-invokes the draft tool, and (b) a **campaign** to hang the sequence + approved assets on. No new agent-loop safety surface — every persist is still an `isWriteTool` gated write.

## Data model (tenant DB — additive, migration via the standard PRAGMA-guarded pattern)

- **`campaigns`**: `id, name, slug, season (text), starts_on, ends_on (dates, nullable), offer (text — the season's Grand Slam Offer/angle), status ('building'|'ready'|'active'|'complete'|'archived'), created_at, updated_at`.
- **`campaign_assets`**: `id, campaign_id (FK cascade), kind ('offer'|'blog'|'social'|'email'|'ad_copy'|'video_script'), title, body (text — markdown or JSON per kind), sort_order, status ('pending'|'drafted'|'approved'), external_kind (nullable 'blog_post'|'carousel_set'|'email_campaign'), external_id (nullable — the materialised row's id), created_at, updated_at`.
- No control-plane changes. `leads.campaign` (exists) is how Slice 2 will attribute — untouched here.

## The agent tools (added to `MARKETING_TOOLS`, `tools.marketing.ts`)

All reuse the existing `ToolContext`/`ToolResult`, `runWithTenant`-wrapped execution, and `marketing` meter key.

- **`plan_campaign`** (READ) — input `{ brief: string (the operator's request), name?, season?, startsOn?, endsOn? }`. Reads the Marketing Brain (`getBusinessContext()` / `getBusinessProfile().marketingBrain`) + venue vocab, proposes the campaign + offer + the ordered artifact list. Returns a structured plan (NOT persisted). Metered.
- **`create_campaign`** (WRITE) — input `{ name, season, startsOn?, endsOn?, offer, assets: [{kind, title, sortOrder}] }`. Creates the `campaigns` row + the `pending` `campaign_assets` rows. Returns the campaignId + the first asset to draft.
- **`draft_campaign_asset`** (READ) — input `{ campaignId, assetId, tweak? }`. Generates that asset's content from the Brain + the campaign offer using the right generator (below), returns the draft (persists it to the asset row as `drafted` so "Go again" has something to replace, but NOT approved). Metered. `tweak` threads the operator's "make it punchier / change the offer" note into the prompt.
- **`approve_campaign_asset`** (WRITE) — input `{ campaignId, assetId }`. Marks the asset `approved` and **materialises** (below). When it's the last asset, flips the campaign to `ready`.
- **`launch_campaign`** (WRITE) — input `{ campaignId }`. Only valid when `ready`. Publishes/sends the approved kit (see The Launch step); flips `ready → active`.

Registration mirrors the existing marketing tools in `@/lib/assistant/tools.ts` (TOOLS + executeTool switch + WRITE_TOOLS for the two writes + summarizeToolAction). System-prompt guidance tells the agent to build **one asset at a time**, always via draft→(operator Approve/Go-again)→approve, never batch.

## Generators per asset kind (reuse first)

| kind | generator | materialise on approve |
|---|---|---|
| `offer` | new `meteredCreate` prompt (Grand Slam Offer from the Brain, honouring **house rules** — see below) | stays on `campaign_assets` |
| `blog` | existing `draftBlogPost` (`agentKey:"marketing"`) | `createSiteBlogPost` + `updateBlogContent` → a CMS **blog draft** (external_kind `blog_post`) |
| `social` | existing `generateCarouselSlides` → then the **auto-image queue we just shipped** | a `carousel_sets` row (external_kind `carousel_set`) with AI backgrounds + logo |
| `email` ×3 (announce → proof → last-chance) | existing `draftCampaignEmail`, one call per email with its sequence angle | one `email_campaigns` **draft** row per email (external_kind `email_campaign`) — each approved/regenerated independently |
| `ad_copy` | new `meteredCreate` prompt (FB/IG primary-text + headline variants) | stays on `campaign_assets` |
| `video_script` | new `meteredCreate` prompt (hook→body→CTA reel/ad script) | stays on `campaign_assets` |

**House rules are load-bearing.** Every generator prompt injects the tenant's Marketing Brain (`getBusinessContext`), which for Inspire already carries **NEVER money-back guarantees / free consultations**. The `offer` and `ad_copy` prompts additionally restate: *never invent guarantees or free offers the Brain hasn't sanctioned.*

## The chat UI (`AgentChatPanel.tsx` + the Approve-card)

- Extend the Approve-card: when the pending write is `approve_campaign_asset` (or the `create_campaign` plan step), render **two** buttons — **Approve** (existing → `/api/assistant/execute`) and **Go again**. "Go again" opens an optional one-line tweak input and re-invokes `draft_campaign_asset` (or `plan_campaign`) with the tweak, replacing the shown draft.
- A slim **campaign progress strip** ("Offer ✓ · Blog ✓ · Social 1 ● · Social 2 … · Email … ") so the operator sees where they are in the build.
- All other agent-chat behaviour (SSE stream, durable runs, the normal Approve-card for non-campaign writes) is untouched.

## The campaign hub

- **List** at `/marketing/campaigns`, **detail** at `/marketing/campaigns/[id]`. Detail shows the campaign (name/season/dates/offer/status) + each asset with its status and content; approved blog/social/email link out to their Content Studio / CMS / Email homes (via `external_id`); offer/ad-copy/scripts render inline with copy buttons. A **"Continue building"** button drops the operator back into the agent chat for any `pending`/`drafted` assets; a **"Launch campaign"** button (enabled only when `ready`) fires `launch_campaign` behind the normal approve gate. Post-launch, the hub shows what's live vs. queued-for-manual-posting.

## Resolved decisions

1. **Route/IA.** Engine mounts at **`/marketing/campaigns`** (list) + `/marketing/campaigns/[id]` (detail), filling the existing empty **"Marketing"** nav slot (`/marketing`, Megaphone) — the `/marketing` placeholder page becomes/points at the engine. The existing email-marketing **"Campaigns"** nav group is **relabelled "Email campaigns"** (its `/campaigns` routes are unchanged — no risky move of a live feature).
2. **Artifact set (v1), 9 assets in order:** `offer` · `blog` · `social` ×3 · `email` ×3 (announce/proof/last-chance) · `ad_copy` · `video_script`. The `plan_campaign` proposal lists them and the operator can trim before approving the plan.
3. **Materialise-on-approve = drafts in real homes**, then **Launch** posts them (blog publish, email send/schedule, social ready-to-post). See the interaction step 5 + generators table.

## The Launch step

- `launch_campaign` (WRITE, gated) — only offered once the campaign is `ready` (all assets approved). Executes, per approved asset via its `external_id`: **blog** → `setPublishState(..., "published")`; **email** ×3 → move each draft to sent/scheduled (reuse the existing campaign send/schedule path — for v1 "schedule" may mean queue/mark-ready if throttled send isn't wired to a scheduler, clearly stated); **social** → mark **ready-to-post** (auto-post deferred to App Review). `offer`/`ad_copy`/`video_script` have no publish target (reference assets). Flips campaign `ready → active`; the hub shows what went live vs. what's queued for manual posting.

## Metering, tenancy, testing, rollout

- **Metering:** every generator call goes through `meteredCreate` with `agentKey:"marketing"` — appears on /agents; the whole build is capped like any AI spend. A full kit is ~7–10 model calls + the social images (~4¢ each).
- **Tenancy:** all tools run `runWithTenant(ctx.tenantId)`; campaign tables are per-tenant; the site/asset materialisation reuses the existing cross-tenant-safe libs.
- **Tests:** pure unit tests for the plan/asset ordering + the tool input validation + the house-rule prompt injection assertion; the generators are already tested. Gate: typecheck + `npm test` + build.
- **Rollout:** additive; no env; migration is additive tables. Deploy `railway up` from `app/`. The agent gains the tools immediately; existing agents/tools untouched.
