# Campaign Engine Slice 4 — Campaign Build Model + Cost Estimator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin choose which model builds a tenant's campaign assets, drive generation with it, and show a heuristic "≈ €X to build this kit on <model>" estimate at plan time + launch that varies by the chosen model.

**Architecture:** A per-tenant `campaignBuildModel` KV setting (validated against `MODEL_CATALOG`, Sonnet fallback) feeds both a pure cost estimator (`estCostCents` × heuristic tokens) and the campaign generators (threaded as an optional `model` param so Content Studio stays on `CONTENT_MODEL`). The estimate surfaces in `plan_campaign` and on the campaign hub; an admin `<select>` on the hub sets the model.

**Tech Stack:** Next.js 14 App Router, TypeScript, better-sqlite3 (settings KV), `node scripts/test.mjs` pure-test runner.

## Global Constraints

- **No schema change / no migration** — the model choice is a `settings`-table KV value via `readKey`/`setKey` (`@/lib/settings`).
- **Model ids come only from `MODEL_CATALOG`** (`@/lib/ai/modelCatalog`); an id not currently in the catalog (or unset) **falls back to `CONTENT_MODEL`** (`MODELS.sonnet`, `@/lib/ai/client`) everywhere — a bad/removed id can never reach `estCostCents` or generation.
- **Estimator is pure** (no AI, no DB) and shares the metering layer's `estCostCents` + `PRICING` (`@/lib/ai/client`) so the estimate and the real charge use one price source.
- **Scope = campaign generation only.** The campaign build model applies to the campaign kit's generators; Content Studio (blog/carousel/refreshSlides used outside campaigns) stays on `CONTENT_MODEL` via a default param.
- **Admin-gated** — the model selector + its write action require an admin (mirror `requireAdminPage`/the hub's existing gating). Non-admins never see it.
- **Honest labelling** — the figure is always an "estimate", model-named. Text-only (the kit generates no images — no image cost).
- **Gate (from `app/`):** `npm run typecheck` · `npm test` (`node scripts/test.mjs`) · `npx next build`.

---

### Task 1: `campaignBuildModel` setting + resolver

**Files:**
- Create: `src/lib/campaigns/buildModel.ts`
- Test: `src/lib/campaigns/buildModel.test.ts`

**Interfaces:**
- Consumes: `MODEL_CATALOG` (`@/lib/ai/modelCatalog` — array of `{ id, label, provider, … }`), `CONTENT_MODEL` (`@/lib/ai/client`), `readKey`/`setKey` (`@/lib/settings`).
- Produces:
  - `const CAMPAIGN_MODEL_KEY = "campaignBuildModel"`
  - `resolveCampaignBuildModel(raw: string | null | undefined): string` — **pure**: returns `raw` iff it's a current `MODEL_CATALOG` id, else `CONTENT_MODEL`.
  - `getCampaignBuildModel(): string` — `resolveCampaignBuildModel(readKey(CAMPAIGN_MODEL_KEY, ""))` (tenant-scoped via the ambient `readKey`).
  - `setCampaignBuildModel(id: string): void` — validates against `MODEL_CATALOG` (throws `Error` on an unknown id), else `setKey(CAMPAIGN_MODEL_KEY, id)`.
  - `isCampaignBuildModelId(id: string): boolean` — helper used by the resolver + setter.

- [ ] **Step 1: Write the failing test** (pure resolver + validator only — `getCampaignBuildModel`/`setCampaignBuildModel` hit the DB proxy and are NOT unit-tested here):

```ts
// src/lib/campaigns/buildModel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCampaignBuildModel, isCampaignBuildModelId } from "./buildModel";
import { MODEL_CATALOG } from "@/lib/ai/modelCatalog";
import { CONTENT_MODEL } from "@/lib/ai/client";

test("resolveCampaignBuildModel: a real catalog id passes through", () => {
  const anId = MODEL_CATALOG[0].id;
  assert.equal(resolveCampaignBuildModel(anId), anId);
});

test("resolveCampaignBuildModel: unset / empty / unknown / null → CONTENT_MODEL", () => {
  assert.equal(resolveCampaignBuildModel(""), CONTENT_MODEL);
  assert.equal(resolveCampaignBuildModel(null), CONTENT_MODEL);
  assert.equal(resolveCampaignBuildModel(undefined), CONTENT_MODEL);
  assert.equal(resolveCampaignBuildModel("claude-fable-5"), CONTENT_MODEL); // deliberately not in the catalog
  assert.equal(resolveCampaignBuildModel("garbage"), CONTENT_MODEL);
});

test("isCampaignBuildModelId: catalog membership", () => {
  assert.equal(isCampaignBuildModelId(MODEL_CATALOG[0].id), true);
  assert.equal(isCampaignBuildModelId("nope"), false);
});
```

- [ ] **Step 2: Run — verify fail** — `cd app && node scripts/test.mjs 2>&1 | grep -i buildModel` → FAIL (module missing).

- [ ] **Step 3: Implement `buildModel.ts`**

```ts
// src/lib/campaigns/buildModel.ts
// The per-tenant model that builds a campaign's assets. Admin-set, validated
// against MODEL_CATALOG, Sonnet fallback. Read/written via the settings KV.
import { MODEL_CATALOG } from "@/lib/ai/modelCatalog";
import { CONTENT_MODEL } from "@/lib/ai/client";
import { readKey, setKey } from "@/lib/settings";

export const CAMPAIGN_MODEL_KEY = "campaignBuildModel";

const CATALOG_IDS = new Set<string>(MODEL_CATALOG.map((m) => m.id));

export function isCampaignBuildModelId(id: string): boolean {
  return CATALOG_IDS.has(id);
}

/** Pure: a current catalog id passes; anything else (unset/unknown/removed) → CONTENT_MODEL. */
export function resolveCampaignBuildModel(raw: string | null | undefined): string {
  return raw && CATALOG_IDS.has(raw) ? raw : CONTENT_MODEL;
}

/** The model the current tenant's campaign generation should use. */
export function getCampaignBuildModel(): string {
  return resolveCampaignBuildModel(readKey<string>(CAMPAIGN_MODEL_KEY, ""));
}

/** Admin setter. Rejects an id not in MODEL_CATALOG. */
export function setCampaignBuildModel(id: string): void {
  if (!isCampaignBuildModelId(id)) throw new Error(`Unknown campaign build model: ${id}`);
  setKey(CAMPAIGN_MODEL_KEY, id);
}
```

- [ ] **Step 4: Run — verify pass** — `node scripts/test.mjs 2>&1 | grep -iE "buildModel|pass|fail"` → pass; then `npm run typecheck` (confirms the `readKey`/`setKey`/`MODEL_CATALOG`/`CONTENT_MODEL` imports resolve — fix paths against the real modules if tsc complains).

- [ ] **Step 5: Commit** — `git add src/lib/campaigns/buildModel.ts src/lib/campaigns/buildModel.test.ts && git commit -m "feat(campaigns): per-tenant campaign build-model setting + resolver"`

---

### Task 2: The pure cost estimator

**Files:**
- Create: `src/lib/campaigns/costEstimate.ts`
- Test: `src/lib/campaigns/costEstimate.test.ts`

**Interfaces:**
- Consumes: `estCostCents` (`@/lib/ai/client` — `estCostCents(model: string, u: { inputTokens: number; outputTokens: number }): number`), `MODELS` (`@/lib/ai/client`), `AssetKind` + `ASSET_ORDER` (`@/lib/campaigns/plan`).
- Produces:
  - `const AVG_TOKENS: Record<AssetKind, { in: number; out: number }>`
  - `estimateCampaignBuildCents(assets: { kind: AssetKind }[], model: string): number`
  - `formatCentsEur(cents: number): string`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/campaigns/costEstimate.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { AVG_TOKENS, estimateCampaignBuildCents, formatCentsEur } from "./costEstimate";
import { estCostCents, MODELS } from "@/lib/ai/client";
import { ASSET_ORDER } from "@/lib/campaigns/plan";

// The default 11-asset kit (7 kinds; social×3, email×3)
const KIT: { kind: (typeof ASSET_ORDER)[number] }[] = [
  { kind: "offer" }, { kind: "landing_page" }, { kind: "blog" },
  { kind: "social" }, { kind: "social" }, { kind: "social" },
  { kind: "email" }, { kind: "email" }, { kind: "email" },
  { kind: "ad_copy" }, { kind: "video_script" },
];

test("AVG_TOKENS has an entry for every asset kind", () => {
  for (const k of ASSET_ORDER) assert.ok(AVG_TOKENS[k], `missing AVG_TOKENS for ${k}`);
});

test("single-asset estimate equals one estCostCents call for that kind", () => {
  const got = estimateCampaignBuildCents([{ kind: "blog" }], MODELS.sonnet);
  const want = estCostCents(MODELS.sonnet, {
    inputTokens: AVG_TOKENS.blog.in, outputTokens: AVG_TOKENS.blog.out,
  });
  assert.equal(got, want);
});

test("the full kit sums per-asset (social/email counted 3x)", () => {
  const total = estimateCampaignBuildCents(KIT, MODELS.sonnet);
  const expected = KIT.reduce(
    (s, a) => s + estCostCents(MODELS.sonnet, { inputTokens: AVG_TOKENS[a.kind].in, outputTokens: AVG_TOKENS[a.kind].out }),
    0,
  );
  assert.equal(total, expected);
  assert.ok(total > 0);
});

test("a cheaper model estimates strictly less than Sonnet; a dearer one more", () => {
  const sonnet = estimateCampaignBuildCents(KIT, MODELS.sonnet);
  const haiku = estimateCampaignBuildCents(KIT, MODELS.haiku);
  const opus = estimateCampaignBuildCents(KIT, MODELS.opus);
  assert.ok(haiku < sonnet, `haiku ${haiku} should be < sonnet ${sonnet}`);
  assert.ok(opus > sonnet, `opus ${opus} should be > sonnet ${sonnet}`);
});

test("an unknown model prices as Sonnet (mirrors estCostCents fallback)", () => {
  assert.equal(estimateCampaignBuildCents(KIT, "no-such-model"), estimateCampaignBuildCents(KIT, MODELS.sonnet));
});

test("formatCentsEur", () => {
  assert.equal(formatCentsEur(0), "€0.00");
  assert.equal(formatCentsEur(15.12), "€0.15");
  assert.equal(formatCentsEur(4.9), "€0.05");
});
```

- [ ] **Step 2: Run — verify fail** — `node scripts/test.mjs 2>&1 | grep -i costEstimate` → FAIL.

- [ ] **Step 3: Implement `costEstimate.ts`**

```ts
// src/lib/campaigns/costEstimate.ts
// Heuristic build-cost estimate for a campaign kit. PURE: reuses the metering
// layer's own estCostCents + PRICING so the estimate and the real charge share
// one price source. Token counts are documented AVERAGES, not measurements.
import { estCostCents } from "@/lib/ai/client";
import type { AssetKind } from "@/lib/campaigns/plan";

/** Average input/output tokens per asset kind. Input is dominated by the
 *  Marketing Brain + prompt (~2–2.5k); output is sized to the asset. Estimates. */
export const AVG_TOKENS: Record<AssetKind, { in: number; out: number }> = {
  offer: { in: 2000, out: 500 },
  landing_page: { in: 2200, out: 450 },
  blog: { in: 2500, out: 1500 },
  social: { in: 2000, out: 200 },
  email: { in: 2200, out: 450 },
  ad_copy: { in: 2000, out: 180 },
  video_script: { in: 2200, out: 800 },
};

export function estimateCampaignBuildCents(assets: { kind: AssetKind }[], model: string): number {
  return assets.reduce((sum, a) => {
    const t = AVG_TOKENS[a.kind];
    if (!t) return sum; // unknown kind contributes nothing rather than throwing
    return sum + estCostCents(model, { inputTokens: t.in, outputTokens: t.out });
  }, 0);
}

export function formatCentsEur(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}
```

- [ ] **Step 4: Run — verify pass** — `node scripts/test.mjs 2>&1 | grep -iE "costEstimate|pass|fail"` → pass; `npm run typecheck`. (If a test's exact-equality on `formatCentsEur(15.12)` or the estCostCents math fails, re-derive against the REAL `estCostCents`/`PRICING` values rather than weakening the test — the values here assume `toFixed(2)` rounding of cents/100.)

- [ ] **Step 5: Commit** — `git add src/lib/campaigns/costEstimate.ts src/lib/campaigns/costEstimate.test.ts && git commit -m "feat(campaigns): pure campaign build-cost estimator"`

---

### Task 3: Route the campaign build model into generation

**Files:**
- Modify: `src/lib/campaigns/generate.ts` (`generateRaw` ~line 123–125; the `generateAsset` dispatch ~line 178+ calls to `draftBlogPost`/`generateCarouselSlides`/`draftCampaignEmail`)
- Modify: `src/lib/ai/draftBlog.ts` (`draftBlogPost` ~line 106), `src/lib/ai/generateCarousel.ts` (`generateCarouselSlides` ~line 234), `src/lib/ai/draftCampaign.ts` (`draftCampaignEmail` ~line 87)

**Interfaces:**
- Consumes: `getCampaignBuildModel()` (Task 1).

**Goal:** every asset in the campaign kit is generated on the tenant's chosen model, while Content Studio / any other caller of the three shared generators keeps `CONTENT_MODEL`.

- [ ] **Step 1: Read** `src/lib/campaigns/generate.ts` fully — confirm `generateRaw` uses `CONTENT_MODEL` (line ~125) and that `generateAsset`'s `blog`/`social`/`email` cases call `draftBlogPost`/`generateCarouselSlides`/`draftCampaignEmail`. Read each of those three generators to find where they set `model: CONTENT_MODEL`.
- [ ] **Step 2: Add an optional `model` param to each shared generator**, defaulting to `CONTENT_MODEL`, and use it in that generator's `meteredCreate` call. E.g. in `draftCampaignEmail(... , opts)` add a trailing optional `model: string = CONTENT_MODEL` (match each function's existing signature/opts shape — some take a positional list, some an opts object; follow what's there) and replace its `model: CONTENT_MODEL` with `model`. Do the same for `draftBlogPost` and `generateCarouselSlides`. **Every EXISTING caller that doesn't pass the param keeps `CONTENT_MODEL`** — verify by grep that all current call sites still typecheck without change.
- [ ] **Step 3: In `generate.ts`**: at the top of `generateAsset` compute `const model = getCampaignBuildModel();`. Change `generateRaw` to take + use that model (add a `model` param to `generateRaw` and pass `model` from each `generateRaw(...)` call in the offer/landing/ad_copy/video_script cases; use it in its `meteredCreate` `model:` field instead of `CONTENT_MODEL`). Pass `model` to the `draftBlogPost`/`generateCarouselSlides`/`draftCampaignEmail` calls in the blog/social/email cases.
- [ ] **Step 4: Gate** — `npm run typecheck` (catches any missed caller), `npm test`, `npx next build`. Grep-confirm no non-campaign caller of the three shared generators now passes a model (they should all still use the default).
- [ ] **Step 5: Commit** — `git commit -m "feat(campaigns): campaign kit generates on the tenant's chosen build model (Content Studio unchanged)"`

---

### Task 4: Surface the estimate (plan_campaign + hub)

**Files:**
- Modify: `src/lib/agents/tools.campaign.ts` (`plan_campaign`'s executor + result)
- Modify: `src/app/marketing/campaigns/[id]/page.tsx` (hub — show estimate) and/or `src/components/campaigns/LaunchCampaignButton.tsx`

**Interfaces:**
- Consumes: `estimateCampaignBuildCents` + `formatCentsEur` (Task 2), `getCampaignBuildModel` (Task 1), `MODEL_CATALOG` (for the label).

- [ ] **Step 1: Read** `tools.campaign.ts`'s `plan_campaign` executor — find where it builds the plan result object (the `assets` array + offer). Compute `const model = getCampaignBuildModel(); const label = MODEL_CATALOG.find(m => m.id === model)?.label ?? model; const estimateCents = estimateCampaignBuildCents(plan.assets, model);` and include `estimateCents` + `modelLabel` in the returned result **and** in the human-facing plan message the agent shows — one honest line, e.g. `` `Estimated build cost: ${formatCentsEur(estimateCents)} on ${label} (an estimate — change the campaign model in settings to lower it).` ``. Do not gate anything on it.
- [ ] **Step 2:** On the campaign hub `/marketing/campaigns/[id]` (server component — read it first for the tenant-context + layout idiom), compute the same estimate from the campaign's asset plan (`listAssets(campaignId)` → their kinds) + `getCampaignBuildModel()` and render a small stat: `Estimated build cost ≈ <formatCentsEur> on <label>`. (This is the launch-time recap; it's informational since assets are already built.)
- [ ] **Step 3: Gate** — typecheck + test + build. Commit `feat(campaigns): show estimated build cost at plan time + on the campaign hub`.

---

### Task 5: Admin "Campaign build model" selector

**Files:**
- Modify: `src/app/marketing/campaigns/page.tsx` (campaigns hub — add the selector, admin-only)
- Create: `src/app/marketing/campaigns/actions.ts` (or extend an existing campaigns actions file) — a server action `setCampaignBuildModelAction(formData)` 

**Interfaces:**
- Consumes: `MODEL_CATALOG` (options), `getCampaignBuildModel` (current value), `setCampaignBuildModel` (Task 1), the hub's existing admin gate.

- [ ] **Step 1: Read** `src/app/marketing/campaigns/page.tsx` for its admin gating (`requireAdminPage`?) + how it renders + whether it already has a server-action file. Confirm how other admin `<select>` + server-action pairs in the app are wired (grep for `"use server"` + `<form action=`).
- [ ] **Step 2:** Add a server action (`"use server"`) `setCampaignBuildModelAction(formData: FormData)`: re-check admin (`requireAdminPage()` or the app's server-action admin guard), read `model = String(formData.get("model"))`, call `setCampaignBuildModel(model)` (which validates), `revalidatePath("/marketing/campaigns")`. On an invalid id `setCampaignBuildModel` throws — catch + ignore/return (don't 500).
- [ ] **Step 3:** On the hub, **admin-only**, render a small `<form action={setCampaignBuildModelAction}>` with a `<select name="model">` of `MODEL_CATALOG` (`{label} ({provider})`), `defaultValue={getCampaignBuildModel()}`, and a submit. Label it "Campaign build model" with a one-line hint that it drives generation + the cost estimate. Non-admins: don't render it.
- [ ] **Step 4: Gate** — typecheck + test + build. Manually reason about the non-admin path (selector hidden) + an invalid submit (no crash). Commit `feat(campaigns): admin selector for the per-tenant campaign build model`.

---

## Post-plan (controller)
- **Final whole-branch review** (opus if it runs, else sonnet): the model resolver's validation/fallback (no unpriced id reaches estCostCents/generation), the estimator's honesty (matches what generation actually runs), that Content Studio's model is genuinely unchanged (the three shared generators default to CONTENT_MODEL for every non-campaign caller), the admin gate on the selector + its server action, tenancy (setting read/written under the ambient tenant), and no metering regression (estimator adds no AI call).
- Deploy `railway up` from `app/`. No env, no migration. Manual QA: as admin, set the campaign model to a cheaper one on the hub → plan a campaign in the agent → confirm the plan message's estimate drops vs Sonnet → build an asset → (spot-check the metered model changed). Reset to Sonnet.

## Self-review notes
- Coverage: setting+resolver (T1), pure estimator (T2), generation routing (T3), estimate display (T4), admin selector (T5), review (post). Every spec §Architecture item maps to a task.
- Reuse-first: `estCostCents`/`PRICING`/`CONTENT_MODEL`/`MODELS`, `MODEL_CATALOG`, `readKey`/`setKey`, `meteredCreate`, `plan_campaign`, the hub + its admin gate — all existing. New: one setting module, one pure estimator, an optional `model` param on 3 generators, estimate display, one admin selector.
- Type consistency: `AssetKind`/`ASSET_ORDER` (plan.ts) used by T2's `AVG_TOKENS` + T4; `getCampaignBuildModel` (T1) consumed by T3 + T4; `estimateCampaignBuildCents`/`formatCentsEur` (T2) consumed by T4; `setCampaignBuildModel` (T1) consumed by T5.
- Honesty crux: T3 makes generation actually use the chosen model, so T4's estimate isn't a lie. The final review must confirm the whole kit (incl. blog/social/email via the shared generators) runs on the chosen model.
