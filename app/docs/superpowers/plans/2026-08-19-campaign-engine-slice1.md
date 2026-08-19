# Campaign Engine — Slice 1 (Campaign Kit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The Marketing agent builds a full seasonal campaign kit from the Marketing Brain, one artifact at a time, each Approved or "Go again"-regenerated in the chat, materialised as drafts in their real homes, then Launched.

**Architecture:** New per-tenant `campaigns` + `campaign_assets` tables. Five agent tools (`plan_campaign` read, `create_campaign` write, `draft_campaign_asset` read, `approve_campaign_asset` write, `launch_campaign` write) reuse existing generators (`draftBlogPost`, `generateCarouselSlides`+auto-image queue, `draftCampaignEmail`) plus new offer/ad/script prompts. The existing agent draft→Approve-card→`/api/assistant/execute` gate is extended with a **"Go again"** button. A hub at `/marketing/campaigns`.

**Tech Stack:** Next.js 14 App Router, drizzle + better-sqlite3 (sync), `meteredCreate` (agentKey `marketing`), tsx test runner, SSE agent chat.

**Spec:** `docs/superpowers/specs/2026-08-19-campaign-engine-slice1-design.md`

## Global Constraints

- **Every persist is a gated `isWriteTool` write** — `create_campaign`, `approve_campaign_asset`, `launch_campaign` go in `WRITE_TOOLS`; `plan_campaign` and `draft_campaign_asset` are READS. The agent NEVER persists without the operator's Approve.
- **House rules ride in every generator** — all generation injects the tenant Marketing Brain via `getBusinessContext()`; the new `offer`/`ad_copy` prompts additionally state: *never invent guarantees or free offers the Brain hasn't sanctioned* (Inspire bans money-back guarantees + free consultations).
- **Tenancy:** all tool executors run under `runWithTenant(ctx.tenantId)` (the executeTool call sites already wrap); new tables are per-tenant; reuse the cross-tenant-safe libs (`resolveSite`, CMS blog libs, carousels, email campaigns).
- **Artifact order (v1), 9 assets:** `offer` · `blog` · `social`×3 · `email`×3 (announce/proof/last-chance) · `ad_copy` · `video_script`. `plan_campaign` proposes them; operator can trim before approving.
- **Metering:** every generator call is `meteredCreate({tenantId, agentKey:"marketing"})`. Social images reuse the metered auto-image queue.
- **Route/IA:** engine at `/marketing/campaigns` (+ `/[id]`), filling the empty `/marketing` slot. Relabel the email nav group "Campaigns" → "Email campaigns" (routes unchanged).
- **Migration:** additive tables via `ensureTenantTables` CREATE-IF-NOT-EXISTS + the PRAGMA-guarded pattern; dual-schema (drizzle + tenant.ts) byte-consistent. No control-plane, no env.
- Gate per task: `npm run typecheck` && `npm test` (+ `npx next build` for UI/route/migration tasks). Commit on `main`.

---

### Task 1: Schema + migration + campaigns repo

**Files:** Create `src/lib/campaigns/store.ts`; Modify `src/lib/db/schema.ts`, `src/lib/db/tenant.ts`. Test: `src/lib/campaigns/store.test.ts` (pure ordering/status helpers only — DB CRUD verified by build+manual).

**Interfaces produced (consumed by Tasks 3–7):**
- Drizzle tables `campaigns`, `campaignAssets` (+ inferred types `Campaign`, `CampaignAsset`).
- `store.ts`: `createCampaign(input)`, `getCampaign(id)`, `listCampaigns()`, `addAssets(campaignId, defs)`, `getAsset(id)`, `listAssets(campaignId)` (ordered), `setAssetDraft(id, {title, body})`, `approveAsset(id, {externalKind?, externalId?})`, `setCampaignStatus(id, status)`, and the PURE `nextPendingAsset(assets)` + `ASSET_ORDER`/`DEFAULT_ASSET_PLAN` + `isTerminalStatus`.

- [ ] **Step 1: Drizzle schema** — add after `carouselSets` (~schema.ts:853):
```ts
export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  season: text("season"),
  startsOn: text("starts_on"),   // ISO date or null
  endsOn: text("ends_on"),
  offer: text("offer").notNull().default(""),
  status: text("status", { enum: ["building", "ready", "active", "complete", "archived"] }).notNull().default("building"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});
export const campaignAssets = sqliteTable("campaign_assets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: integer("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["offer", "blog", "social", "email", "ad_copy", "video_script"] }).notNull(),
  title: text("title").notNull().default(""),
  body: text("body").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status", { enum: ["pending", "drafted", "approved"] }).notNull().default("pending"),
  externalKind: text("external_kind", { enum: ["blog_post", "carousel_set", "email_campaign"] }),
  externalId: integer("external_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`),
});
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignAsset = typeof campaignAssets.$inferSelect;
```
- [ ] **Step 2: tenant.ts** — add both `CREATE TABLE IF NOT EXISTS` statements (byte-consistent with the drizzle columns, incl. the FK + an index on `campaign_assets(campaign_id, sort_order)`) into `ensureTenantTables`. No ALTER block needed (brand-new tables). Read the existing carousel table block for the exact idiom.
- [ ] **Step 3: Write the failing test** for the PURE helpers (`npm test -- src/lib/campaigns/store.test.ts`):
```ts
import assert from "node:assert/strict";
import { DEFAULT_ASSET_PLAN, nextPendingAsset } from "./store";
(async () => {
  // Default plan is the 9-asset order from the spec.
  const kinds = DEFAULT_ASSET_PLAN.map((a) => a.kind);
  assert.deepEqual(kinds, ["offer","blog","social","social","social","email","email","email","ad_copy","video_script"].slice(0,10) === kinds ? kinds : kinds);
  assert.equal(DEFAULT_ASSET_PLAN[0].kind, "offer");
  assert.equal(DEFAULT_ASSET_PLAN.filter((a)=>a.kind==="social").length, 3);
  assert.equal(DEFAULT_ASSET_PLAN.filter((a)=>a.kind==="email").length, 3);
  assert.ok(DEFAULT_ASSET_PLAN.every((a,i)=> a.sortOrder === i), "sortOrder is 0..N");
  // nextPendingAsset returns the lowest-sortOrder non-approved asset, or null.
  const assets = [{id:1,sortOrder:0,status:"approved"},{id:2,sortOrder:1,status:"drafted"},{id:3,sortOrder:2,status:"pending"}] as any;
  assert.equal(nextPendingAsset(assets)?.id, 2, "first non-approved by order");
  assert.equal(nextPendingAsset(assets.map((a:any)=>({...a,status:"approved"}))), null, "all approved → null");
  console.log("store.test.ts: passed");
})();
```
(Fix the `DEFAULT_ASSET_PLAN` assertion to a clean `assert.deepEqual(kinds, ["offer","blog","social","social","social","email","email","email","ad_copy","video_script"])` — the muddled line above is a placeholder; the implementer must write the clean assertion.)
- [ ] **Step 4: Implement `store.ts`** — the drizzle CRUD (via ambient `db`), plus PURE `DEFAULT_ASSET_PLAN` (9 defs `{kind, title, sortOrder}` in spec order; social titled "Social post 1..3", email "Email — Announce/Proof/Last chance") and `nextPendingAsset(assets)` (lowest `sortOrder` where `status !== "approved"`, else null). `import "server-only"` at top; keep `DEFAULT_ASSET_PLAN`/`nextPendingAsset` free of db imports so the test runs DB-free (put them in a `plan.ts` sibling if cleaner, and re-export).
- [ ] **Step 5:** typecheck + test + build. Commit `feat(campaigns): schema, migration + campaign store (assets + ordering)`.

---

### Task 2: Asset generation dispatch (reuse generators + new prompts)

**Files:** Create `src/lib/campaigns/generate.ts`, `src/lib/campaigns/prompts.ts`. Test: `src/lib/campaigns/prompts.test.ts`.

**Interfaces produced:** `generateAsset(asset: CampaignAsset, campaign: Campaign, meter, tweak?): Promise<{title, body}>` — dispatches by `kind`. Plus PURE prompt builders in `prompts.ts`: `offerPrompt(campaign, tweak?)`, `adCopyPrompt(campaign, tweak?)`, `videoScriptPrompt(campaign, tweak?)` — each returns the user-prompt string; the house-rule line is a shared const.

- [ ] **Step 1: Test (pure prompts)** — assert each prompt includes the campaign offer + season, the tweak when present, and the shared house-rule clause `HOUSE_RULES_CLAUSE` (verbatim substring: `only use offers, guarantees and mechanisms sanctioned by the Marketing Brain — never invent a money-back guarantee or a free offer`). Run → fail.
- [ ] **Step 2: Implement `prompts.ts`** — the three builders + `HOUSE_RULES_CLAUSE` const. Pure, no imports beyond types.
- [ ] **Step 3: Implement `generate.ts`** dispatch (`import "server-only"`):
  - `offer`/`ad_copy`/`video_script` → `meteredCreate({tenantId, agentKey:"marketing"}, () => ({ model: CONTENT_MODEL, system: [{type:"text", text: `${getBusinessContext()}\n\n${...formatRules}`, cache_control:{type:"ephemeral"}}], messages:[{role:"user", content: <prompt>}] }))` → extract text → `{title, body}`.
  - `blog` → `draftBlogPost({title: asset.title || campaign.name, inputMode:"prompt", prompt: <offer+angle+tweak>, tone:null, targetWords:700, therapy:null, videoTranscript:null, videoProjectName:null}, meter)` → `{title, body: draft.content}`.
  - `social` → `generateCarouselSlides({topic: <offer+tweak>, slideCount:5, tone:null}, meter)` → `{title: asset.title, body: JSON.stringify({caption, slides})}` (images are added at materialise/approve via the auto-image queue, not here).
  - `email` → `draftCampaignEmail(<CampaignDraftInput built from the offer + this email's sequence angle (announce/proof/last-chance derived from asset.title)>, meter)` → `{title, body}`. (Read `draftCampaign.ts` for `CampaignDraftInput`'s exact shape and match it.)
- [ ] **Step 4:** typecheck + test + build. Commit `feat(campaigns): per-asset generation dispatch + offer/ad/script prompts (house-rule-guarded)`.

---

### Task 3: The five agent tools + registration

**Files:** Create `src/lib/agents/tools.campaign.ts`; Modify `src/lib/assistant/tools.ts` (register), `src/lib/assistant/system.ts` (guidance). Test: `src/lib/agents/tools.campaign.test.ts`.

**Interfaces produced:** schemas + executors for `plan_campaign`, `create_campaign`, `draft_campaign_asset`, `approve_campaign_asset`, `launch_campaign`; registered into `TOOLS`, `executeTool`, `WRITE_TOOLS` (the 3 writes), `summarizeToolAction`.

- [ ] **Step 1: Test** — validate: the three writes are in `WRITE_TOOLS`, the two reads are NOT; `plan_campaign` executor returns a plan object with `DEFAULT_ASSET_PLAN` kinds; `create_campaign` with a missing name → error result; `summarizeToolAction` gives human strings for each write (e.g. "Create campaign 'Summer Shape Up 2026' and 9 assets", "Approve the Offer for 'Summer Shape Up 2026'", "Launch 'Summer Shape Up 2026'"). Follow the `tools.marketing.test.ts` react-cache shim pattern. Run → fail.
- [ ] **Step 2: Implement `tools.campaign.ts`** (mirror `tools.marketing.ts` structure — local `ToolContext`/`ToolResult`/`tdb`):
  - `plan_campaign` (READ): from `{brief, name?, season?, startsOn?, endsOn?}`, reads Brain + venue vocab, returns `{name, season, startsOn, endsOn, offer, assets: DEFAULT_ASSET_PLAN}` as JSON (the offer itself is generated via the offer prompt so it's real, honouring house rules). Metered.
  - `create_campaign` (WRITE): `{name, season, startsOn?, endsOn?, offer, assets}` → `createCampaign` + `addAssets` (offer asset seeded already `approved` with the offer text if the operator approved it at plan step — OR left `pending`; keep simple: offer is asset[0], created `drafted` with the plan's offer text so its first card is Approve/Go-again like the rest). Returns `{campaignId, nextAsset}`.
  - `draft_campaign_asset` (READ): `{campaignId, assetId, tweak?}` → `generateAsset` → `setAssetDraft` (status `drafted`) → returns the draft for the card. Metered.
  - `approve_campaign_asset` (WRITE): `{campaignId, assetId}` → materialise (Task 4) → `approveAsset` → if `nextPendingAsset` null, `setCampaignStatus(ready)`. Returns `{approved, nextAsset|null, campaignStatus}`.
  - `launch_campaign` (WRITE): `{campaignId}` → Task 5. 
- [ ] **Step 3: Register** in `tools.ts` (TOOLS spread, executeTool switch cases, WRITE_TOOLS for the 3, summarizeToolAction cases) — mirror how `MARKETING_TOOLS` is wired. **System prompt** (`system.ts` marketing section / the agent guidance): add "To build a campaign: call plan_campaign, show the plan for Approve/Go-again; on approve create_campaign; then for EACH asset in order call draft_campaign_asset, show it for Approve/Go-again, and only call approve_campaign_asset after the operator approves — ONE asset at a time, never batch. Offer launch_campaign only when every asset is approved."
- [ ] **Step 4:** typecheck + test + build. Commit `feat(campaigns): agent tools (plan/create/draft/approve/launch) + registration + guidance`.

---

### Task 4: Materialise-on-approve

**Files:** Modify `src/lib/campaigns/` (a `materialise.ts` used by `approve_campaign_asset`).

**Interface:** `materialiseAsset(asset, campaign): { externalKind, externalId } | null` — called inside `approve_campaign_asset` before `approveAsset`.

- [ ] **Step 1: Implement** per kind:
  - `blog` → `createSiteBlogPost(...)` on the tenant's resolved site + `updateBlogContent(id,{content: body, status:"ready"})` → `{blog_post, id}`.
  - `social` → create a `carousel_sets` row from the stored `{caption, slides}` (reuse the carousel create + slide insert path used by the Content Studio generate route) **and enqueue the auto-image generation** (`queueSlideImages`) so backgrounds + logo land — `{carousel_set, id}`.
  - `email` → create an `email_campaigns` draft row from the body (reuse `lib/marketing/campaigns.ts` create) → `{email_campaign, id}`.
  - `offer`/`ad_copy`/`video_script` → return null (no external home; content stays on the asset).
- [ ] **Step 2:** typecheck + test + build. Commit `feat(campaigns): materialise approved blog/social/email into their real homes (as drafts)`.

---

### Task 5: Launch

**Files:** Modify `src/lib/campaigns/` (a `launch.ts`).

**Interface:** `launchCampaign(campaignId): { published: [...], queued: [...] }` — called by `launch_campaign`; requires status `ready`.

- [ ] **Step 1: Implement** — for each approved asset with an `externalId`: `blog` → `setPublishState(siteId, externalId, "published")`; `email` → move the draft to sent/scheduled via the existing campaign send path (for v1, if a scheduler isn't wired, set the email campaign to its "ready/queued" state and report it as queued — do NOT fabricate a scheduler); `social` → mark ready-to-post (no auto-post — App Review; report as queued-for-manual). Then `setCampaignStatus(active)`. Return a summary of what published vs queued. Read the email campaigns lib + CMS blog publish to match real signatures; never invent a send/schedule API that doesn't exist — degrade to "queued/ready" with an honest label.
- [ ] **Step 2:** typecheck + test + build. Commit `feat(campaigns): launch — publish blog, queue emails, mark socials ready`.

---

### Task 6: Chat UI — "Go again" + progress strip

**Files:** Modify `src/components/agents/AgentChatPanel.tsx` (+ any shared Approve-card component it uses). Read it fully first.

**Interface:** the Approve-card, when the pending write is `approve_campaign_asset`/`create_campaign`, renders **Approve** (existing) + **Go again** (new). "Go again" reveals an optional one-line tweak input and re-invokes the draft/plan read tool (via the existing chat send path with a system-directed follow-up, or a dedicated re-draft call) so a fresh draft replaces the shown one. A compact **progress strip** (assets + ✓/●/…) renders when a campaign build is active.

- [ ] **Step 1: Implement** matching the existing SSE + Approve-card mechanics (do not disturb the normal Approve flow for non-campaign writes). The "Go again" action should result in the agent re-drafting that asset — simplest reliable wiring: send a chat message like `Go again on that <asset> — <tweak>` which the system prompt maps to a fresh `draft_campaign_asset` call; OR call an endpoint that re-runs `draft_campaign_asset` directly and streams the new card. Choose the one that fits the existing chat plumbing; document the choice.
- [ ] **Step 2:** typecheck + test + build. Commit `feat(campaigns): agent-chat Go-again + campaign progress strip`.

---

### Task 7: Campaign hub + nav

**Files:** Create `src/app/marketing/campaigns/page.tsx` (list), `src/app/marketing/campaigns/[id]/page.tsx` (detail), `src/components/campaigns/*`. Modify `src/app/marketing/page.tsx` (point at/redirect to the engine), `src/components/layout/Sidebar.tsx` (Marketing slot → engine; relabel email group "Campaigns"→"Email campaigns").

- [ ] **Step 1: List** — campaigns table (name/season/status/created) + "New campaign" hint (points the operator to ask the Marketing agent, or deep-links the agent chat). 
- [ ] **Step 2: Detail** — campaign header + assets list (status, content preview; approved blog/social/email link to their homes via external refs; offer/ad/scripts inline with copy). **Continue building** (→ agent chat) + **Launch campaign** (enabled only when `ready`, fires `launch_campaign` via the same execute path/approve gate).
- [ ] **Step 3: Nav** — in `Sidebar.tsx`: relabel the email `Campaigns` group → `Email campaigns`; wire the `Marketing` item (or a child) to `/marketing/campaigns`. Match the existing NAV idiom.
- [ ] **Step 4:** typecheck + test + build. Commit `feat(campaigns): /marketing/campaigns hub (list + detail + launch) + nav (Email campaigns relabel)`.

---

## Post-plan (controller)
- Final whole-branch review (opus): the write-gate integrity (all 3 writes gated, reads never persist beyond `drafted`), tenancy on the new tables + materialisation, house-rule injection in every generator, metering coverage, no disruption to the existing Marketing/other agents or the email-campaigns feature, and the migration's additive safety.
- Deploy `railway up` from `app/` after the gate. No env, no migration data. Manual QA: ask the Marketing agent to build a campaign end-to-end (plan → per-asset approve/go-again → launch) on a test tenant; verify /agents shows `marketing` spend; verify email group reads "Email campaigns".

## Self-review notes
- Spec coverage: schema (T1), generation+house-rules (T2), tools+gate (T3), materialise (T4), launch (T5), chat go-again (T6), hub+nav (T7).
- Type consistency: `Campaign`/`CampaignAsset`/`generateAsset`/`nextPendingAsset`/the 5 tool names stable across tasks.
- Reuse-first: only offer/ad/script prompts + the campaign scaffolding are new; blog/social/email/images all reuse shipped generators.
- Known deferrals (Slice 2/3): landing page + form→attributed leads; social auto-post (App Review); seasonal calendar + daily-brief radar + CFA scoreboard.
