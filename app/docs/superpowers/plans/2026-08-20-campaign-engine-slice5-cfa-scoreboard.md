# Campaign Engine Slice 5 — CFA/ROAS Per-Campaign Scoreboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On each campaign's hub, show CFA ✓/✗ (upfront cash ≥ ad spend), CAC, ROAS, MRR-added, and conversion rate — revenue pulled from the converts' memberships/packages, ad spend the one manual input.

**Architecture:** One additive per-campaign column (`ad_spend_cents`). A DB gatherer traces campaign → won-role leads → client (clientId or email/phone) → their memberships/packages, aggregating `{upfrontCashCents, mrrCents}`. A pure `computeCampaignScoreboard` does the metric math (testable), fed by a thin async `getCampaignScoreboard`. A hub panel renders it + an admin ad-spend editor.

**Tech Stack:** Next.js 14 App Router, TypeScript, better-sqlite3/drizzle, `node scripts/test.mjs` pure-test runner.

## Global Constraints

- **Money is integer cents everywhere** internally (`clientMemberships`/`clientPackages.priceCents` are cents; clinic `packages.pricePaidEur` × 100; ad spend euros × 100). Format via a cents→€ helper.
- **CFA/CAC/ROAS use `adSpendCents` as the acquisition cost** — the AI build cost (Slice-4 estimate) is a small SEPARATE informational line, never in a ratio denominator.
- **Zero-safe:** 0 leads → conversion rate null; 0 converts → CAC null; 0 ad spend → ROAS + CFA null (UI: "add ad spend").
- **Convert = a campaign lead in a WON-role stage that resolves to a client** (via `leads.clientId`, else email/phone match to `clients`).
- **Tenancy:** all reads/writes under the ambient tenant; the email/phone match is within this tenant's own `clients` only.
- **Admin-gated** ad-spend edit (server action re-checks admin, like Slice-4's `setCampaignBuildModelAction`); the read-only scoreboard is staff-visible.
- **No new AI call** — reuse the pure Slice-4 `estimateCampaignBuildCents` for the AI-build line.
- **Gate (from `app/`):** `npm run typecheck` · `npm test` (`node scripts/test.mjs`) · `npx next build`.

---

### Task 1: `campaigns.ad_spend_cents` column + setter

**Files:**
- Modify: `src/lib/db/schema.ts` (the `campaigns` table def — add the drizzle column)
- Modify: `src/lib/db/tenant.ts` (the additive-migration block, ~line 1390–1460 — add a `PRAGMA table_info(campaigns)` guard + `ALTER TABLE`)
- Modify: `src/lib/campaigns/store.ts` (add `setCampaignAdSpend`; ensure the `Campaign` type/select carries `adSpendCents`)

**Interfaces — Produces:** `setCampaignAdSpend(campaignId: number, cents: number): void` (clamps `cents` to `Math.max(0, Math.round(cents))`); `Campaign.adSpendCents: number`.

- [ ] **Step 1: schema** — in `schema.ts`'s `campaigns` table, add `adSpendCents: integer("ad_spend_cents").notNull().default(0),`.
- [ ] **Step 2: migration** — read the existing guarded ALTERs in `tenant.ts` (e.g. `ALTER TABLE leads ADD COLUMN stage_id …` at ~1413). Mirror the pattern for campaigns:
```ts
const campCols = sqlite.prepare("PRAGMA table_info(campaigns)").all() as Array<{ name: string }>;
if (!campCols.some((c) => c.name === "ad_spend_cents")) {
  sqlite.exec("ALTER TABLE campaigns ADD COLUMN ad_spend_cents INTEGER NOT NULL DEFAULT 0");
}
```
Place it alongside the other guarded ALTERs in that function.
- [ ] **Step 3: store setter** — in `store.ts`, add:
```ts
export function setCampaignAdSpend(campaignId: number, cents: number): void {
  const clamped = Math.max(0, Math.round(cents));
  db.update(campaigns).set({ adSpendCents: clamped }).where(eq(campaigns.id, campaignId)).run();
}
```
Confirm the `Campaign` type (whatever `getCampaign`/`listCampaigns` return) now includes `adSpendCents` (drizzle `select()` picks it up automatically once the column's in the table def).
- [ ] **Step 4: verify** — `npm run typecheck` + `npx next build` (the build boots a tenant DB → runs the migration; confirm no error). No pure unit test here (it's schema/DB); reason about idempotency (the `PRAGMA` guard) in the report.
- [ ] **Step 5: Commit** — `git commit -m "feat(campaigns): ad_spend_cents column + setCampaignAdSpend"`

---

### Task 2: convert + revenue gather (+ pure aggregation)

**Files:**
- Create: `src/lib/campaigns/scoreboardData.ts`
- Test: `src/lib/campaigns/scoreboardData.test.ts` (the PURE aggregation only)

**Interfaces:**
- Consumes: `countLeadsByCampaign` (`@/lib/leads`); `WON_ROLES` + `StageRole` (`@/lib/pipeline/roles`); drizzle `leads`, `pipelineStages`, `clients`, `clientMemberships`, `clientPackages`, `packages` (`@/lib/db/schema`); the ambient `db`.
- Produces:
  - `type MembershipRec = { priceCents: number; status: "active" | "expired" | "cancelled" }`
  - `type PackageRec = { priceCents: number; status: "active" | "expired" | "cancelled" }`
  - `aggregateConvertRevenue(input: { memberships: MembershipRec[]; packages: PackageRec[]; clinicPackagesCents: number[] }): { upfrontCashCents: number; mrrCents: number }` — **pure**.
  - `async gatherCampaignRevenue(campaignName: string): Promise<{ leads: number; converts: number; upfrontCashCents: number; mrrCents: number }>` — the DB side.

- [ ] **Step 1: Write the failing test (pure aggregation)**

```ts
// src/lib/campaigns/scoreboardData.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateConvertRevenue } from "./scoreboardData";

test("MRR = active memberships' monthly price; cancelled/expired excluded", () => {
  const r = aggregateConvertRevenue({
    memberships: [
      { priceCents: 5000, status: "active" },
      { priceCents: 4000, status: "active" },
      { priceCents: 9999, status: "cancelled" },
      { priceCents: 8888, status: "expired" },
    ],
    packages: [], clinicPackagesCents: [],
  });
  assert.equal(r.mrrCents, 9000); // 5000 + 4000
});

test("upfront = active memberships' first month + non-cancelled packages + clinic packages", () => {
  const r = aggregateConvertRevenue({
    memberships: [{ priceCents: 5000, status: "active" }],       // first month 5000
    packages: [
      { priceCents: 12000, status: "active" },                    // counts
      { priceCents: 3000, status: "expired" },                    // counts (paid, now expired)
      { priceCents: 9999, status: "cancelled" },                  // excluded (refunded)
    ],
    clinicPackagesCents: [7500, 2500],                            // 10000
  });
  assert.equal(r.upfrontCashCents, 5000 + 12000 + 3000 + 10000); // 30000
});

test("empty → zeros, never throws", () => {
  const r = aggregateConvertRevenue({ memberships: [], packages: [], clinicPackagesCents: [] });
  assert.deepEqual(r, { upfrontCashCents: 0, mrrCents: 0 });
});
```

- [ ] **Step 2: Run — verify fail** — `node scripts/test.mjs 2>&1 | grep -i scoreboardData` → FAIL.

- [ ] **Step 3: Implement the pure aggregation + the DB gatherer**

```ts
// src/lib/campaigns/scoreboardData.ts  (pure part)
export type MembershipRec = { priceCents: number; status: "active" | "expired" | "cancelled" };
export type PackageRec = { priceCents: number; status: "active" | "expired" | "cancelled" };

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Pure: converts' membership/package records → { upfrontCashCents, mrrCents }. */
export function aggregateConvertRevenue(input: {
  memberships: MembershipRec[];
  packages: PackageRec[];
  clinicPackagesCents: number[];
}): { upfrontCashCents: number; mrrCents: number } {
  const activeMonthly = input.memberships.filter((m) => m.status === "active").map((m) => m.priceCents);
  const mrrCents = sum(activeMonthly);
  const paidPackages = input.packages.filter((p) => p.status !== "cancelled").map((p) => p.priceCents);
  const upfrontCashCents = mrrCents /* first month of each active membership */ + sum(paidPackages) + sum(input.clinicPackagesCents);
  return { upfrontCashCents, mrrCents };
}
```

For the DB `gatherCampaignRevenue` (NOT unit-tested — integration): read `src/lib/leads.ts` (the `leftJoin(pipelineStages, eq(pipelineStages.id, leads.stageId))` shape at ~line 257) and `src/lib/pipeline/roles.ts` (`WON_ROLES`). Then:
1. `leads = countLeadsByCampaign(campaignName)`.
2. **Converted client ids:** select leads where `campaign = campaignName`, left-join `pipelineStages` on `stageId`, keep rows whose `pipelineStages.role` is in `WON_ROLES`; resolve each to a client id — use `leads.clientId` when non-null, else match a `clients` row by `lower(email)` or `phone` (this tenant only). Dedupe → the set of converted client ids; `converts = ids.size`.
3. **Revenue:** for those client ids, select their `clientMemberships` ({priceCents, status}), `clientPackages` ({priceCents, status}), and clinic `packages` ({pricePaidEur}) → map clinic euros to cents (`Math.round(pricePaidEur*100)`); call `aggregateConvertRevenue`.
4. Return `{ leads, converts, upfrontCashCents, mrrCents }`. Guard everything against empty/no-converts (returns zeros).

- [ ] **Step 4: Run — verify pure tests pass** — `node scripts/test.mjs 2>&1 | grep -iE "scoreboardData|pass|fail"`; then `npm run typecheck` (surfaces any wrong table/column ref in the gatherer — fix against real schema).
- [ ] **Step 5: Commit** — `git commit -m "feat(campaigns): scoreboard convert+revenue gather (pure aggregation + DB)"`

---

### Task 3: pure `computeCampaignScoreboard`

**Files:**
- Create: `src/lib/campaigns/scoreboard.ts`
- Test: `src/lib/campaigns/scoreboard.test.ts`

**Interfaces — Produces:**
- `interface ScoreboardInput { leads: number; converts: number; adSpendCents: number; aiBuildCents: number; upfrontCashCents: number; mrrCents: number }`
- `interface Scoreboard { leads: number; converts: number; conversionRatePct: number | null; adSpendCents: number; aiBuildCents: number; cacCents: number | null; upfrontCashCents: number; mrrCents: number; cfaCovered: boolean; roas: number | null }`
- `computeCampaignScoreboard(input: ScoreboardInput): Scoreboard`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/campaigns/scoreboard.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCampaignScoreboard } from "./scoreboard";

const base = { leads: 20, converts: 4, adSpendCents: 10000, aiBuildCents: 15, upfrontCashCents: 18000, mrrCents: 9000 };

test("happy path: rates, CAC, CFA covered, ROAS", () => {
  const s = computeCampaignScoreboard(base);
  assert.equal(s.conversionRatePct, 20);      // 4/20*100
  assert.equal(s.cacCents, 2500);             // 10000/4
  assert.equal(s.cfaCovered, true);           // 18000 >= 10000
  assert.equal(s.roas, 1.8);                  // 18000/10000
  assert.equal(s.aiBuildCents, 15);           // informational, unchanged
});

test("CFA not covered when upfront < ad spend", () => {
  const s = computeCampaignScoreboard({ ...base, upfrontCashCents: 6000 });
  assert.equal(s.cfaCovered, false);
  assert.equal(s.roas, 0.6);
});

test("0 ad spend → ROAS null, CFA not covered (UI shows 'add ad spend')", () => {
  const s = computeCampaignScoreboard({ ...base, adSpendCents: 0 });
  assert.equal(s.roas, null);
  assert.equal(s.cfaCovered, false);
  assert.equal(s.cacCents, null);   // adSpend 0 → CAC also null
});

test("0 converts → CAC null; 0 leads → conversion rate null; never throws", () => {
  assert.equal(computeCampaignScoreboard({ ...base, converts: 0, adSpendCents: 10000 }).cacCents, null);
  assert.equal(computeCampaignScoreboard({ ...base, leads: 0, converts: 0 }).conversionRatePct, null);
});
```

- [ ] **Step 2: Run — verify fail** — `node scripts/test.mjs 2>&1 | grep -i "scoreboard\b"` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/campaigns/scoreboard.ts
export interface ScoreboardInput {
  leads: number; converts: number; adSpendCents: number;
  aiBuildCents: number; upfrontCashCents: number; mrrCents: number;
}
export interface Scoreboard {
  leads: number; converts: number; conversionRatePct: number | null;
  adSpendCents: number; aiBuildCents: number; cacCents: number | null;
  upfrontCashCents: number; mrrCents: number;
  cfaCovered: boolean; roas: number | null;
}

export function computeCampaignScoreboard(i: ScoreboardInput): Scoreboard {
  const hasSpend = i.adSpendCents > 0;
  return {
    leads: i.leads,
    converts: i.converts,
    conversionRatePct: i.leads > 0 ? (i.converts / i.leads) * 100 : null,
    adSpendCents: i.adSpendCents,
    aiBuildCents: i.aiBuildCents,
    cacCents: hasSpend && i.converts > 0 ? Math.round(i.adSpendCents / i.converts) : null,
    upfrontCashCents: i.upfrontCashCents,
    mrrCents: i.mrrCents,
    cfaCovered: hasSpend && i.upfrontCashCents >= i.adSpendCents,
    roas: hasSpend ? i.upfrontCashCents / i.adSpendCents : null,
  };
}
```
(Note: `cacCents` is null when ad spend is 0 — CAC has no meaning without a cost, and the UI shows "add ad spend" for the whole cost row. This is intentional; the test asserts it.)

- [ ] **Step 4: Run — verify pass** — `node scripts/test.mjs 2>&1 | grep -iE "scoreboard|pass|fail"`; `npm run typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "feat(campaigns): pure computeCampaignScoreboard metric math"`

---

### Task 4: Hub scoreboard panel + admin ad-spend editor

**Files:**
- Modify: `src/app/marketing/campaigns/[id]/page.tsx` (add the scoreboard panel)
- Modify: `src/app/marketing/campaigns/actions.ts` (add `setCampaignAdSpendAction`)
- Create (if cleaner): `src/lib/campaigns/scoreboardData.ts` already has the gatherer; add a thin `getCampaignScoreboard(campaign)` there or in `scoreboard.ts`.

**Interfaces:**
- Consumes: `gatherCampaignRevenue` + `computeCampaignScoreboard` (T2/T3), `estimateCampaignBuildCents` + `getCampaignBuildModel` (Slice 4), `setCampaignAdSpend` (T1), `requireAdmin`/the hub's admin gate.

- [ ] **Step 1: the gatherer wrapper** — add `async getCampaignScoreboard(campaign)`: `const { leads, converts, upfrontCashCents, mrrCents } = await gatherCampaignRevenue(campaign.name); const aiBuildCents = estimateCampaignBuildCents(<campaign's assets>, await getCampaignBuildModel()); return computeCampaignScoreboard({ leads, converts, adSpendCents: campaign.adSpendCents, aiBuildCents, upfrontCashCents, mrrCents });` (get the campaign's assets the same way the hub already does for the Slice-4 estimate — reuse that `listAssets` call, don't re-query).
- [ ] **Step 2: hub panel** — read `[id]/page.tsx` first (tenant-context + the existing Slice-4 estimate line + layout idiom). Add a "Scoreboard" section: the **CFA hero** — when `roas === null` show "Add ad spend to see if this campaign paid for itself"; else `cfaCovered` ? "✓ Self-funded — front-end sales covered the €X ad spend (Y.Y×)" : "✗ €Z short of covering the €X ad spend". Then a compact stat grid: Leads · Converts · Conv. rate (`—` if null) · Ad spend (the editable field) · CAC (`—` if null) · Upfront cash · MRR added · ROAS (`—` if null) · AI build cost. Money via a cents→€ helper (reuse `formatCentsEur` from `costEstimate.ts`). Empty states: 0 converts → "No conversions attributed yet."
- [ ] **Step 3: ad-spend editor** — an admin-only `<form action={setCampaignAdSpendAction}>` with a number input (euros, `defaultValue={(campaign.adSpendCents/100).toFixed(2)}`, hidden `campaignId`). The server action (in `actions.ts`, mirror `setCampaignBuildModelAction`): `"use server"`, `await requireAdmin()` FIRST, parse `campaignId` + `eur = Number(formData.get("adSpend"))`, `setCampaignAdSpend(campaignId, Math.round((isFinite(eur) ? Math.max(0, eur) : 0) * 100))`, `revalidatePath(\`/marketing/campaigns/${campaignId}\`)`. Non-admins: the editor isn't rendered (but the action still re-checks).
- [ ] **Step 4: Gate** — `npm run typecheck` · `npm test` · `npx next build`. Reason about the empty/no-spend/no-convert states in the report.
- [ ] **Step 5: Commit** — `git commit -m "feat(campaigns): CFA/ROAS scoreboard panel + admin ad-spend editor on the hub"`

---

## Post-plan (controller)
- **Final whole-branch review** (sonnet): the money math (all cents; CFA/CAC/ROAS on ad spend; AI build separate; zero-guards), the convert linkage (won-role + clientId/email-phone, tenant-scoped — no cross-tenant client match), revenue-status filtering (cancelled excluded, active-only MRR), the admin gate on the ad-spend action (direct-POST safe), the migration idempotency, and no regression to the hub / Slice-4 estimate display.
- Deploy `railway up` from `app/`. Migration runs on boot (additive column). Manual QA: on a campaign with attributed won leads, confirm converts + revenue show; set an ad spend → CFA/CAC/ROAS activate; a non-convert campaign shows the empty states.

## Self-review notes
- Coverage: ad-spend column+setter (T1), convert+revenue gather w/ pure aggregation (T2), pure metric math (T3), hub panel+editor (T4), review (post). Every spec §Architecture item maps to a task.
- Reuse-first: countLeadsByCampaign, WON_ROLES + the pipelineStages role join, the client revenue tables, estimateCampaignBuildCents (Slice 4), formatCentsEur, requireAdmin + the Slice-4 action pattern, the hub page.
- Testable core isolated: `aggregateConvertRevenue` (T2) + `computeCampaignScoreboard` (T3) are pure + fully TDD'd; the DB gather + UI are integration (typecheck + build + reasoned states).
- Type consistency: `{upfrontCashCents, mrrCents}` (T2) → `ScoreboardInput` (T3); `adSpendCents` (T1) → T3/T4; `getCampaignScoreboard` (T4) composes T2+T3+Slice-4.
