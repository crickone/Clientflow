# Campaign Engine — Slice 2 (the Funnel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every campaign gets a branded landing page on the client's site with a "Register your interest" form; a submission creates a `campaign`-attributed lead in the pipeline. Landing copy is an 11th campaign asset (same Approve/Go-again flow); it goes live on Launch.

**Architecture:** A `landing_page` asset kind (generated from the offer, house-rule-guarded). A public host-scoped `POST /api/campaigns/signup` that resolves the tenant from the site host (NO API key) and calls the existing `upsertLead` with campaign attribution. A public route `/site/[siteSlug]/c/[campaignSlug]` renders a branded landing template (tenant logo/accent/fonts) + the form. Launch makes it live.

**Tech Stack:** Next.js 14 App Router, drizzle + better-sqlite3, `resolvePublicSite` (host→tenant), `upsertLead`, `meteredCreate` (agentKey marketing), tsx tests.

**Spec:** `docs/superpowers/specs/2026-08-19-campaign-engine-slice2-design.md`

## Global Constraints

- **NO API key in public HTML.** The signup endpoint resolves the tenant from the request HOST via `resolvePublicSite` (control-plane `site_domains`) — the same trust basis as the public CMS. Dev fallback: `?site=`/body `siteSlug`.
- **Every public write under `runWithTenant`**, and the campaign must belong to the resolved tenant (cross-tenant submission impossible; per-tenant DB is the structural guard).
- **Reuse `upsertLead`** (`@/lib/leads`, `NormalizedLeadInput`: `{source, sourceLeadId, campaign, fullName, email, phone, notes, therapyInterest?}`) — it splits fullName, dedupes on `(source,sourceLeadId)`, assigns the pipeline entry stage. Signup uses `source:"landing"`, `campaign: <campaign.name>`.
- **Public endpoint hardening** mirrors `/api/leads/inbound`: honeypot (silent 200 drop), per-IP rate-limit, ≤32KB, validate name + at-least-one of email/phone.
- **House rules** in the landing-copy generator (getBusinessContext + the shared HOUSE_RULES_CLAUSE): no price, no guarantees, no fabricated proof; CTA = "Register your interest".
- **Branding from tenant settings** (logo `getChromeLogoSrc`, accent `getThemeForTenant`, fonts `getBrandFontIds`, business name/contact) — read inside `runWithTenant(tenantId)` on the public route. Never scrape the client's HTML.
- Adding `landing_page` to the drizzle `kind` enum is TS-only (the tenant.ts CREATE TABLE is `kind TEXT NOT NULL`, no CHECK) — **no DB migration**.
- Gate per task: `npm run typecheck` && `npm test` (+ `npx next build` for routes/endpoints). Commit on `main`.

---

### Task 1: `landing_page` asset — kind + plan + generation

**Files:** Modify `src/lib/db/schema.ts` (kind enum), `src/lib/campaigns/plan.ts` (DEFAULT_ASSET_PLAN), `src/lib/campaigns/prompts.ts` (+ landing prompt), `src/lib/campaigns/generate.ts` (+ dispatch case), `src/lib/campaigns/materialise.ts` (landing → null), `src/lib/campaigns/store.test.ts` + `src/lib/campaigns/prompts.test.ts` (update).

**Interfaces produced:** `AssetKind` gains `"landing_page"`; `DEFAULT_ASSET_PLAN` is 11 entries with landing_page at sortOrder 1; `landingPagePrompt(campaign, tweak?)`; `generateAsset` handles `landing_page` → `{title, body: JSON.stringify({headline, subhead, bullets, ctaLabel})}`.

- [ ] **Step 1: schema enum** — add `"landing_page"` to `campaign_assets.kind` enum (schema.ts ~960). (No tenant.ts change — the CREATE TABLE column is plain `kind TEXT NOT NULL`; verify that's so and leave it.)
- [ ] **Step 2: plan** — insert `{ kind: "landing_page", title: "Landing page", sortOrder: 1 }` after `offer` in `DEFAULT_ASSET_PLAN`; **renumber** every subsequent `sortOrder` +1 (blog→2, social 1..3→3..5, email×3→6..8, ad_copy→9, video_script→10). Update `src/lib/campaigns/store.test.ts`'s exact-order assertion to the new 11-kind array `["offer","landing_page","blog","social","social","social","email","email","email","ad_copy","video_script"]`.
- [ ] **Step 3: prompt (TDD)** — add `landingPagePrompt(campaign, tweak?)` to `prompts.ts` returning a user-prompt that asks for a landing page as JSON `{headline, subhead, bullets:[3-5], ctaLabel}` from the offer, includes season + tweak + `HOUSE_RULES_CLAUSE`, and states the CTA is "Register your interest" (never a price/booking/guarantee). Extend `prompts.test.ts`: assert it includes the offer, HOUSE_RULES_CLAUSE, and "Register your interest". Write → fail → implement → pass.
- [ ] **Step 4: generate dispatch** — in `generate.ts`, add the `landing_page` case: `meteredCreate` with `CONTENT_MODEL` + `getBusinessContext()` + a LANDING_FORMAT_RULES block instructing JSON-only output; parse the model's JSON tolerantly (fallback `{headline: campaign.offer-derived, subhead:"", bullets:[], ctaLabel:"Register your interest"}` if parse fails — never throw); return `{title: asset.title, body: JSON.stringify(parsed)}`. Add a pure `parseLandingBody(body)` helper (in `assetBody.ts`, mirroring `parseSocialBody`) → `{headline, subhead, bullets, ctaLabel} | null`; TDD it.
- [ ] **Step 5: materialise** — `materialise.ts`: `landing_page` → `return null` (no external row; the public route renders from the asset). Add it to the exhaustive switch.
- [ ] **Step 6:** typecheck + test + build. Commit `feat(campaigns): landing_page asset — kind, plan slot, house-rule-guarded generation`.

---

### Task 2: the host-scoped signup endpoint

**Files:** Create `src/app/api/campaigns/signup/route.ts`; Modify `src/middleware.ts` (PUBLIC_API_PREFIXES). Test: `src/app/api/campaigns/signup/validate.test.ts` (pure helpers).

**Interfaces produced:** `POST /api/campaigns/signup` (public) + a pure `src/lib/campaigns/signup.ts` with `validateSignup(body) → {ok, data}|{ok:false,error}` and `isHoneypotTripped(body)`.

- [ ] **Step 1: pure helpers (TDD)** — `signup.ts`: `validateSignup({name, email, phone, message, campaignSlug, website(honeypot)})` — require `name` + at least one of email/phone; email format if present; trim; cap lengths; `campaignSlug` required. `isHoneypotTripped` = the honeypot field (`website`/`company`) is non-empty. Test both. Write → fail → implement → pass.
- [ ] **Step 2: the route** — read `/api/leads/inbound/route.ts` first and mirror its public-endpoint shape (rate-limit, size cap, zod/validate, `runWithTenant`):
```ts
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  // 1. size cap + parse JSON (catch → 400)
  // 2. honeypot → return 200 {ok:true} silently (drop)
  // 3. validateSignup → 400 on !ok
  // 4. resolve tenant+site: const site = resolvePublicSite({ host: req.headers.get("host"), siteParam: body.siteSlug });
  //    if (!site) return 400 "Unknown site."
  // 5. rate-limit per IP (rateLimit(`campaign-signup:${ip}`, 30, 60_000)) → 429
  // 6. runWithTenant(site.tenantId, async () => {
  //      const campaign = getCampaignBySlug(campaignSlug); if (!campaign) return null (→404)
  //      upsertLead({ source:"landing", sourceLeadId: <email||phone||random-ish stable key>, campaign: campaign.name, fullName: name, email, phone: phone, notes: message });
  //    })
  // 7. return {ok:true}
}
```
Add `getCampaignBySlug(slug)` to `src/lib/campaigns/store.ts` if absent (tenant-scoped select by slug). `sourceLeadId`: use a stable dedupe key so double-submits don't double-create — e.g. `landing:${campaignSlug}:${(email||phone||"").toLowerCase()}`; if both blank, allow the insert (name-only). Never trust a client-supplied tenant id — only the host/siteSlug→resolvePublicSite result.
- [ ] **Step 3: middleware** — add `"/api/campaigns/signup"` to `PUBLIC_API_PREFIXES` in `src/middleware.ts` (so it isn't auth-gated), mirroring the `/api/leads/inbound` entry.
- [ ] **Step 4:** typecheck + test + build. Commit `feat(campaigns): public host-scoped signup endpoint → campaign-attributed lead (no API key)`.

---

### Task 3: the public landing route + branded template + form

**Files:** Create `src/app/site/[siteSlug]/c/[campaignSlug]/page.tsx`, `src/components/campaigns/CampaignLanding.tsx` (server, branded), `src/components/campaigns/SignupForm.tsx` (client). Read `src/app/site/[siteSlug]/page.tsx` first for the host-resolution + tenant-context pattern.

- [ ] **Step 1: the route** — mirror `site/[siteSlug]/page.tsx`: `resolvePublicSite({ host, siteParam: searchParams.site ?? params.siteSlug })`; if null → `notFound()`. Then `runWithTenant(site.tenantId, …)` (or the file's existing tenant-context mechanism): `getCampaignBySlug(campaignSlug)`; require an APPROVED `landing_page` asset (`listAssets` → find kind landing_page status approved) AND campaign status ∈ {ready, active} — else `notFound()`. Read branding (`getChromeLogoSrc`, `getThemeForTenant(tenantId)`, `getBrandFontIds`, `getBusinessProfile` for name/contact) + `parseLandingBody(asset.body)`. Render `<CampaignLanding …/>`. `export const dynamic = "force-dynamic"`.
- [ ] **Step 2: CampaignLanding** (server component) — a clean single-page layout using the tenant's brand tokens: header (logo), hero (headline + subhead on the accent colour), benefit bullets, `<SignupForm campaignSlug siteSlug primaryHost/>`, contact (phone/business name) + a plain footer. Inline-styled from the theme accent + fonts (match the app's inline-style idiom). Must be self-contained + mobile-responsive.
- [ ] **Step 3: SignupForm** (client) — fields name/phone/email/optional message + a hidden honeypot (`website`, visually hidden) + hidden `campaignSlug`; on submit POST JSON to `/api/campaigns/signup` (include `siteSlug` for the dev fallback); disable while submitting; on `{ok:true}` show an inline thank-you ("Thanks — we'll be in touch"); on error show a message. No external deps.
- [ ] **Step 4:** typecheck + test + build (build compiles the public route). Manually reason about the empty/preview states. Commit `feat(campaigns): public branded landing page + register-interest form`.

---

### Task 4: Launch → landing live + hub

**Files:** Modify `src/lib/campaigns/launch.ts` (+ landing URL in summary), `src/app/marketing/campaigns/[id]/page.tsx` (landing URL + signup count).

- [ ] **Step 1: launch** — `launchCampaign` already flips `ready→active` (which makes the landing publicly renderable per Task 3's status gate). Add the landing URL to the `{published}` summary when the campaign has an approved `landing_page` asset (build the path `/<...>/c/<slug>` or the primaryHost URL if the site has one — reuse `siteUrl`/`resolvePublicSite`'s primaryHost if available; else the `/site/<slug>/c/<slug>` dev path). Honest label ("landing page live at …").
- [ ] **Step 2: hub detail** — on `/marketing/campaigns/[id]`: if an approved `landing_page` asset exists, show the **landing URL** (copy + "view" link) and a **signup count** = `countLeadsByCampaign(campaign.name)` (add a tenant-scoped count helper to `@/lib/leads` or `store.ts`: `SELECT COUNT(*) FROM leads WHERE campaign = ?`). Show it as a small stat ("N sign-ups so far").
- [ ] **Step 3:** typecheck + test + build. Commit `feat(campaigns): launch surfaces the live landing URL + hub shows sign-up count`.

---

## Post-plan (controller)
- Final whole-branch review (opus): the public endpoint's security (host-only tenant resolution, no key, honeypot/rate-limit, campaign-in-tenant, upsertLead attribution correct), tenancy on the public route (branding + campaign read under the right tenant), the landing render gate (only approved+ready/active), house-rule injection in the landing copy, and no disruption to Slice 1 / the public CMS.
- Deploy `railway up` from `app/`. No env, no migration. Manual QA: build a campaign incl. the landing_page asset, approve it, launch, open the landing URL on a test tenant's site, submit the form, confirm a lead appears attributed to the campaign (board campaign filter) + the hub count increments.

## Self-review notes
- Coverage: landing asset+gen (T1), secure signup endpoint (T2), public branded page+form (T3), launch+hub (T4).
- Reuse-first: upsertLead, resolvePublicSite, the pipeline attribution/board filter, the branding tokens, the generation+approve loop — all existing. New: one prompt, one endpoint, one route/template/form, one enum value.
- Security is the crux: host = tenant proof (no key), campaign-in-tenant, honeypot+rate-limit, runWithTenant. The final review must scrutinise this.
