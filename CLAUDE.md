# ClientFlow — Project Context for Claude Code

## What this is

**ClientFlow** is a multi-tenant platform (Next.js 14, App Router) that the agency
uses to run client businesses and **build/manage their websites** under one roof.
It combines a CRM (clients, appointments, leads, packages, content studio) with a
**multi-site CMS** (pages, blog, SEO, media, a visual editor, and per-site domains)
and an **AI agent layer** (an Orchestrator + domain specialists that work a
tenant's own data, gated by an operator-approval step — see "Agents & AI" below).

The first managed website is **Renova Cellular Health** (a wellness clinic in
Clonmel, Co. Tipperary — optimalhealthatinspire.ie · ☎ 083 867 2844).

> Note: the root folder may be named `clientflow` (renamed from `Renova`). Nothing
> in the code depends on the folder name — all paths are relative.

## Folder layout

```
<root>/
  app/                      ← the ClientFlow platform (Next.js CRM + CMS + AI agents)
    src/                    ← app code
    data/                   ← SQLite DBs: control.db (control plane: users, sessions, tenant
                               registry, domain routing, AI usage) + tenants/<slug>/<slug>.db,
                               one file per business (e.g. tenants/inspire/inspire.db). The
                               original tenant (Renova) is still special-cased to legacy
                               data/clinic.db — see src/lib/db/tenant.ts.
    public/sites/<slug>/    ← per-site static assets (namespaced)
  admin/                    ← separate Next.js app: the platform console (subscriptions/
                               billing, admin.clientflow.ie) — its own package.json, deployed
                               as its own Railway service. Not part of the app/ CRM+CMS.
  sites/
    renova/, inspire/, clientflow/, clientflow-web/  ← bespoke website SOURCE per client
                               (static HTML, assets, …), imported into the CMS (see below)
  tools/
    import-site.cjs         ← import a site folder's HTML into the CMS
```

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

- **Orchestrator + specialists:** the Orchestrator (`src/lib/agents/specialists/orchestrator.ts`)
  is a thin chief-of-staff — it does no domain work itself, only routes a
  request to the right specialist (Sales, Marketing, Operations — see
  `AGENT_CATALOG` in `src/lib/agents/registry.ts`; Finance is modeled but
  dormant) or to the **Concierge**, a general-purpose assistant (the same
  system/tools as `/api/assistant/chat`, computed at runtime rather than a
  fixed catalog entry) for anything else — inbox, WhatsApp, invoices,
  nutrition/workout plans, general admin. All of them share one loop
  (`runAgentTurn`); reachable from `/agents` (org chart + per-agent detail)
  or `/api/agents/[key]/chat`.
- **Write-approval gate:** no agent call ever executes a write inline —
  every write tool call is collected as a `pendingWrite` and returned for
  the operator to explicitly approve before it runs. This holds through
  delegation too: a specialist (or the Concierge) invoked BY the
  Orchestrator still can't write on its own.
- **Metered spend cap:** every paid AI call is metered per tenant
  (`src/lib/ai/usage.ts`) against a monthly cap — €25/tenant by default,
  admin-adjustable €1–€1000 from the Agents page (`CapEditor`). Call sites
  check `assertUnderCap()` before calling out and `recordUsage()` after.
- **Multi-provider models:** `src/lib/ai/providers/` resolves a model id to
  the provider that runs it — native Anthropic models, or `openrouter:`-prefixed
  ids via `OpenRouterProvider` (e.g. DeepSeek, Kimi, GPT-5) — behind one
  provider-neutral turn loop, so tool dispatch/approval/metering never see a
  provider-specific wire format.
- **Durable runs:** the specialist chat route runs `runAgentTurn` in a
  detached, tenant-bound continuation that keeps going after the response
  has streamed back (Railway runs this app as a persistent `next start`
  process, not serverless); `src/lib/agents/runStore.ts` persists run
  progress so a client that disconnects mid-run can reconnect instead of
  losing it.

## Email marketing (campaigns)

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
3. **Import it:** `node tools/import-site.cjs --slug <slug> --name "<Name>"`
   (defaults to `sites/<slug>/`; copies assets to `app/public/sites/<slug>/`,
   rewrites links/asset URLs, keeps scripts, maps title/meta → SEO, publishes).
4. **Manage** content/blog/SEO/media in the CMS + Studio (`/cms/<slug>`).
5. **Go live:** add the client's domain under the site's **Domains**, set
   `CMS_SITE_HOSTS="host=slug,…"` on deploy.

## Running

- `cd app && npm run dev` → http://localhost:3000 (Node at `/usr/local/bin`).
- Public site dev preview: `http://localhost:3000/site/<slug>`.
- Theme is **dark premium**, token-driven in `src/app/globals.css` (`--bg`,
  `--surface-*`, `--accent`, `color-scheme: dark`). The public Renova site keeps
  its own styles (independent of the admin theme).

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
