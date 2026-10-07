# AdonisAgent — Project Context for Claude Code

## What this is

**AdonisAgent** is a multi-tenant platform (Next.js 14, App Router) that the agency
uses to run client businesses and **build/manage their websites** under one roof.
It combines a CRM (clients, appointments, leads, memberships, packages, timetable,
staff, nutrition/workout, forms, automations) with a **multi-site CMS** (pages,
blog, SEO, media, a visual editor, and per-site domains), a **Content Studio**
(AI-designed social posts, video, blog) and an **AI agent layer** — one agent,
**Adonis**, that works a tenant's own data behind an operator-approval step (see
"Agents & AI" below).

Two SEPARATE clinic businesses live on the platform and must never be conflated:
- **Optimal Health at Inspire** — tenant 1028 `optimal-health`, LIVE
  (optimalhealthatinspire.ie · ☎ 083 867 2844; HBOT, infrared, PEMF, massage).
  This is where the client works day to day.
- **Renova Cellular Health** — tenant 1 `renova`, the ORIGINAL tenant (legacy
  data/clinic.db), a business that has NOT started yet and will launch later.
  Its tenant, CMS site and data stay put; do not merge or retire it.

> Note: the root folder is still named `Renova` (the platform was renamed
> ClientFlow → AdonisAgent in 2026-08; the folder may be renamed later). Nothing
> in the code depends on the folder name — all paths are relative. Some older
> identifiers still say `clientflow` (e.g. the `clientflow-live` CMS template,
> the `cf_client_session` cookie, `cf_live_` API keys) — leave them alone.

## Folder layout

```
<root>/
  app/                      ← the AdonisAgent platform (Next.js CRM + CMS + AI agents)
    src/                    ← app code
    data/                   ← SQLite DBs: control.db (control plane: users, sessions, tenant
                               registry, domain routing, AI usage) + tenants/<slug>/<slug>.db,
                               one file per business (e.g. tenants/inspire/inspire.db). The
                               original tenant `renova` still points at legacy data/clinic.db
                               (registered by the boot migration, src/lib/db/migrate.ts) but
                               is otherwise an ORDINARY tenant since 2026-09-14 — no data or
                               routing path branches on the slug (the only `"renova"` literals
                               left in src/ are nav/module gates, e.g. the Training module is
                               shown to `optimal-health` + `renova` only). NEVER diagnose
                               tenant state from these local files: they are stale dev copies;
                               production lives on the Railway volume (`railway ssh`).
    public/sites/<slug>/    ← per-site static assets (namespaced) + `_pages.json` bundles
  admin/                    ← separate Next.js app: the platform console (subscriptions/
                               billing, admin.adonisagent.ie) — its own package.json, deployed
                               as its own Railway service. Not part of the app/ CRM+CMS.
  sites/
    renova/, inspire/, optimal-health/, adonisagent/, clientflow/, clientflow-web/
                            ← bespoke website SOURCE per client (static HTML, assets, …),
                               imported into the CMS (see below). `adonisagent/` is the
                               platform's own marketing site; `clientflow*` are its predecessors.
  brand/, design-system/    ← brand pack (logo/mark/favicon) + shared design tokens
  docs/                     ← RUNBOOK.md, audits/plans, lead-engine assets
  tests/                    ← Python e2e/smoke scripts (separate from `app`'s `npm test`)
  tools/
    import-site.cjs         ← import a site folder's HTML into the CMS
    build-site-bundle.cjs   ← bundle a site's pages into the build so a deploy publishes them
    push-site-to-prod.cjs   ← push a site's pages straight to prod over `railway ssh`
```

## The modules (routes under `app/src/app`)

The CRM is a wide set of modules, most gated per tenant by venue type
(`src/lib/settings.ts` + `vocabulary.ts`) and by per-module feature flags
(`src/lib/features.ts`, set from the admin console):

- **Clinic/day-to-day:** `/dashboard`, `/clients`, `/appointments`, `/calendar`,
  `/timetable` (group classes), `/attendance`, `/packages` + `/session-packages`,
  `/memberships`, `/vouchers`, `/staff`, `/reports`.
- **Growth:** `/leads` (drag-drop pipeline board), `/marketing` (campaign engine,
  seasonal calendar, `/marketing/research` competitor dashboard), `/campaigns`
  (bulk email), `/content-studio`, `/adonis`.
- **Programmes:** `/nutrition`, `/workout`, `/forms`, `/automations`, `/training`
  (sales-training programme, `optimal-health` + `renova` only).
- **Platform:** `/settings` (incl. `/settings/design`),
  `/setup` (self-onboarding checklist), `/cms`, `/communication` (combined inbox),
  `/billing`.
- **Client-facing:** `/app` — the branded client mobile app with its own login
  (`cf_client_session`), plus public `/f/<slug>` forms and `/u/<token>`
  unsubscribe.

## Content Studio (in `app/src/lib/content-studio` + `lib/ai`)

- **AI-designed posts:** the model authors HTML for each slide, rendered to PNG
  server-side (satori). Photography lands via `{{PHOTO}}` / `{{PHOTO:2}}` tokens
  (`photoSlots` owns that grammar); backgrounds come from FLUX via fal.ai, metered.
- **Also:** carousels and singles, video (b-roll, rotation/crop), blog drafting
  with a TipTap WYSIWYG, and a shared library (images, video, documents).
- **Publishing:** `src/lib/social/` posts to Meta (Facebook/Instagram Graph);
  scheduled posts and scheduled campaign email both fire from the minute
  **dispatch ticker** (`src/lib/dispatch/ticker.ts`, started by an import in
  `src/app/layout.tsx`).

## Campaign engine (in `app/src/lib/campaigns`)

Separate from bulk email below: ask Adonis for a campaign and it plans and builds
a full kit (`plan.ts` → `generate.ts` → `materialise.ts` → `launch.ts`) — landing
page, emails, social posts, a signup form feeding leads, a nurture sequence and a
pipeline per campaign, with per-artifact approve/regenerate and a scoreboard.
Campaigns are gated on the tenant having a site, and refuse with a reason rather
than failing silently. HOUSE RULE for generated campaign copy: no money-back
guarantees, no free consults, no pricing, no fabricated claims.

## The CMS (in `app/src`)

- **Multi-site model:** a `sites` table (tenant DB), all CMS content scoped by
  `site_id`. Control-plane `site_domains` maps hostnames → tenant+site for public
  rendering. See `src/lib/db/{schema.ts,tenant.ts,control.ts}`.
- **Admin** under `src/app/cms/` — Sites list, per-site dashboard, Pages (block +
  SEO editor), Blog (AI draft + publish), Media, Domains, Requests, and the
  full-screen **Studio** visual editor (`/cms/<slug>/studio`).
- **Public rendering** under `src/app/site/[siteSlug]/…` — resolves the site by
  host (prod) or `?site=`/path (dev) via `src/lib/cms/resolveHost.ts`. NEVER uses
  the cookie `db` proxy. Per-host `sitemap.xml` + `robots.txt`.
- **Templates:** `src/lib/cms/templates.tsx` registry; bespoke imported pages use
  the `clientflow-live` template (renders first-party HTML verbatim incl. its own
  styles + scripts, so GSAP/Lenis animations run).
- **AI blog** reuses `src/lib/ai/draftBlog.ts` + `src/lib/blog/generator.ts`.

## Agents & AI (in `app/src/lib/agents` + `app/src/lib/ai`)

- **ONE agent, "Adonis"** (since 2026-08-25): `AGENT_CATALOG` in
  `src/lib/agents/registry.ts` holds exactly one entry, key `orchestrator`,
  and it does the domain work itself. The old Sales/Marketing/Operations
  specialists, the Concierge and the dormant Finance placeholder were all
  retired, and the whole `delegate_to_*` subsystem went with them — their
  tools and playbooks now live inline in
  `src/lib/agents/specialists/orchestrator.ts`, with the tool slices split
  across `tools.{sales,marketing,operations,campaign,posts,website,schedule,
  skills}.ts`. `ensureAgents()` prunes any tenant `agents` row whose key is
  no longer in the catalog. Do NOT reintroduce specialist/delegation
  language in code, copy or docs.
- **Where it's reachable:** `/adonis` (the main chat, staff-facing), the
  dashboard embed, `/agents` (admin-only: model, instructions, tools, cap)
  and `/api/agents/[key]/chat`. One turn loop for all of them,
  `runAgentTurn`.
- **Write-approval gate:** no agent call ever executes a write inline —
  every write tool call is collected as a `pendingWrite` and returned for
  the operator to explicitly approve before it runs. A read tool's result
  can bubble its own `pendingWrites` up into the same gate. Agent writes
  are admin-only.
- **Metered spend cap:** every paid AI call is metered per tenant
  (`src/lib/ai/usage.ts`) against a monthly cap — €25/tenant by default,
  admin-adjustable €1–€1000 from the Agents page (`CapEditor`). Call sites
  check `assertUnderCap()` before calling out and `recordUsage()` after.
- **Multi-provider models:** `src/lib/ai/providers/` resolves a model id to
  the provider that runs it — native Anthropic models, or `openrouter:`-prefixed
  ids via `OpenRouterProvider` (e.g. DeepSeek, Kimi, GPT-5) — behind one
  provider-neutral turn loop, so tool dispatch/approval/metering never see a
  provider-specific wire format.
- **Durable runs:** the agent chat route runs `runAgentTurn` in a
  detached, tenant-bound continuation that keeps going after the response
  has streamed back (Railway runs this app as a persistent `next start`
  process, not serverless); `src/lib/agents/runStore.ts` persists run
  progress so a client that disconnects mid-run can reconnect instead of
  losing it.

## Google (in `app/src/lib/google`)

- **One Google Business connection per tenant** (control table
  `google_business_connections`, tokens encrypted), separate from the Gmail
  inbox connection. Connected at `/settings/integrations/google`; the sign-in
  reuses `/api/google/callback` (state `p:"business"`) so no new redirect URI.
- **Business Profile:** posts are a `google` channel on the social publisher
  (`lib/social/publisher.ts`, opt-in next to Facebook/Instagram); reviews are
  synced into the tenant table `google_reviews` (ticker, every 30 min) and
  answered from the inbox; profile metrics + search terms feed the dashboard's
  Google tab. **Search Console** and **GA4** come from the same sign-in.
- Raw REST, request/parse logic pure + tested in `businessApi.ts`. Every call is
  fail-soft with a readable reason: Google must approve Business Profile API
  access for the Cloud project before those calls return data.

## Email marketing (bulk send)

Note the two "campaigns": `/marketing/campaigns` is the campaign-engine kit
above (`lib/campaigns`, admin-only); `/campaigns` below is the bulk-email
product (`lib/marketing` + `lib/email`). They are different stores.

- **Sending:** platform Mailgun behind a swappable `CampaignSender` interface
  (`src/lib/marketing/sender/`) — one concrete impl today, `MailgunSender`,
  raw `fetch` against Mailgun's HTTP API (deliberately no `mailgun.js` dep).
  Every method returns a typed result instead of throwing.
- **Per-tenant verified sending domains** (`src/lib/marketing/domains.ts`),
  connected under `/campaigns/domains` (admin-only).
- **Money:** prepaid credits at a per-1000-recipient price set with a margin
  over Mailgun's underlying cost, metered in `src/lib/email/credits.ts` (a
  control-plane ledger — balance can't go negative, one ledger row per
  mutation inside a single transaction). Balances today only move via
  explicit admin-console grants; real charging (card capture, auto-topup
  execution) is deferred to CreatePay.
- **Contacts:** CSV import + suppressions under `/campaigns/contacts`
  (`src/lib/marketing/contactImport.ts` + `suppress.ts`).
- **Campaigns UI** at `/campaigns` — builder + AI draft, list, per-campaign
  stats.
- **Compliance:** every send is checked against suppressions and carries a
  `List-Unsubscribe` header + link; unsubscribing is a signed, unauthenticated
  token link at `/u/[token]` (`src/lib/marketing/unsubscribeToken.ts`), and
  the Mailgun webhook (`/api/mailgun/webhook`) records delivery/open/click/
  complaint/unsubscribe events back onto the campaign.
- **Admin console** (`admin/`) sets the global per-1000 price and
  grants/suspends a tenant's credits from its gym detail page (`/gyms/[id]`).

## Adding a new client website

1. **Create the site:** CMS → Sites → **Add site** (admin), or fulfil a **Request**.
2. **Build the design** (bespoke) in `sites/<slug>/` as static HTML/assets.
   **Run the `seo-audit` skill while building, not after** — every page needs
   a unique title of 50-60 chars with the service + town in it and the brand
   shortened at the end (e.g. "Infrared Light Therapy Clonmel | Optimal
   Health"), and a unique 140-160 char description that names the service +
   town, states facts from the client, and ends with an action ("Book online
   or call ..."). Plus one H1 per page, alt text on every image, and
   LocalBusiness data. Same plain-copy rules as the page text.
3. **Import it:** `node tools/import-site.cjs --slug <slug> --name "<Name>"`
   (defaults to `sites/<slug>/`; copies assets to `app/public/sites/<slug>/`,
   rewrites links/asset URLs, keeps scripts, maps title/meta → SEO, publishes).
4. **Manage** content/blog/SEO/media in the CMS + Studio (`/cms/<slug>`).
5. **Go live:** add the client's domain under the site's **Domains**, set
   `CMS_SITE_HOSTS="host=slug,…"` on deploy.

Site slugs are the public URL, so they must be globally unique (enforced in
`src/lib/cms/siteSlugs.ts`). Editing `sites/<slug>/*.html` in the repo does NOT
by itself change the live site — pages are served from `content_blocks` on the
Railway volume. Commit the bundle (`node tools/build-site-bundle.cjs --slug
<slug>`, which writes `app/public/sites/<slug>/_pages.json`, applied on boot by
`src/lib/cms/syncBundledSite.ts`) so the deploy carries them, or push directly
with `tools/push-site-to-prod.cjs`.

## House rules

- **NO EMOJIS.** Never use emojis in the app UI, in code (comments, labels,
  copy, log lines), in commit messages, in docs, or in replies to the operator.
  Use a `lucide-react` icon where a glyph is genuinely needed — the icon set is
  already the app's visual language. The ONLY exception is **generated marketing
  copy** (social captions, blog/email body text) where the client's audience
  expects them, and even then only when the copy calls for it.
- **Every page the platform renders for a tenant wears THAT tenant's own
  chrome** — its stylesheet, navbar and footer via `src/lib/cms/siteChrome.ts`,
  never a hardcoded palette. Applies to campaign landing pages, public forms,
  anything generated.
- **Agent website edits are surgical only** — the tools in
  `src/lib/agents/tools.website.ts` swap text and images in existing markup.
  Never render model-authored HTML into a verbatim template (XSS).
- **Finish the job:** land changes on `main` and deploy (see below) rather than
  stopping at "typecheck passes".

## Running

- `cd app && npm run dev` → http://localhost:3000 (Node at `/usr/local/bin`).
- Public site dev preview: `http://localhost:3000/site/<slug>`.
- Theme is **dark premium** by default (a light mode exists, per-viewer via the
  `ui-theme` cookie), token-driven in `src/app/globals.css` (`--bg`,
  `--surface-*`, `--accent`) via `src/lib/theme.ts`. EVERY account looks the
  same: per-tenant appearance settings (colours, heading font) were removed
  2026-10-07 — the light/dark toggle is the only choice. Don't reintroduce a
  per-tenant admin theme. The client mobile app (`/app`) still uses the
  tenant's brand colours. Nebula is brand/marketing assets only.
  Public client sites keep their own styles, independent of the admin theme.

## Deployment

- **Railway**, running this app as a persistent Node process (`next start`
  against the `output: "standalone"` build) — not serverless — built from
  `app/Dockerfile` (multi-stage: installs + `build:prod`, then a slim
  runtime image with the standalone server plus native deps it can't
  auto-trace: better-sqlite3, ffmpeg-static/ffprobe-static).
- **Deploy is `railway up`, always run from inside `app/`** — `cd app`
  first; the Railway service is rooted there (the sibling `admin/` app is
  its own, separately deployed Railway service).
- Before deploying: `npx next build` must succeed locally (the Docker build
  intentionally skips `tsc` — see `next.config.mjs`'s
  `typescript.ignoreBuildErrors` comment — it OOMs on Railway's builder),
  plus `npm run typecheck` and `npm test`. CI (`.github/workflows/ci.yml`)
  runs all three (typecheck, test, `build:prod`) on every push/PR to `main`,
  plus a non-blocking `npm run lint` — but CI does not deploy; `railway up`
  is still a separate, manual step.
- `main` is the source of truth — land changes there before deploying, even
  though the deploy command itself doesn't currently enforce that.
- `/api/health` is the unauthenticated liveness probe (checks the control
  DB) that Railway/uptime monitoring hits.
