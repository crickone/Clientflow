# ClientFlow

**ClientFlow** is a multi-tenant platform (Next.js 14, App Router) that runs
client businesses (gyms, clinics, wellness studios) and builds/manages their
websites, in one app. It combines a CRM (clients, appointments, leads,
packages, memberships, timetables, a content studio) with a multi-site CMS
(pages, blog, SEO, media, a visual Studio editor, per-site domains) and an
AI agent layer — an Orchestrator plus domain specialists that work a
tenant's own data, gated by an operator-approval step before anything sends,
publishes, or changes data.

For the full architecture, folder layout, and how to add a new client site,
see [`CLAUDE.md`](../CLAUDE.md) at the repo root — this file is a shorter,
app-focused entry point.

## Quick start

```bash
cd app
npm install
npm run dev       # http://localhost:3000
```

Needs a `.env.local` (gitignored) with at least `ANTHROPIC_API_KEY` for the
AI features to work; ask a teammate for current values. `npm run typecheck`
and `npm test` don't need any keys.

## Architecture

- **Next.js 14 App Router**, TypeScript, Tailwind. `src/app/` holds routes —
  the admin CRM/CMS under most paths, public site rendering under
  `src/app/site/[siteSlug]/…` — and `src/lib/` holds the domain logic.
- **Data:** per-tenant **SQLite** via `better-sqlite3` + `drizzle-orm` — one
  DB file per business (`data/tenants/<slug>/<slug>.db`) plus a shared
  control-plane DB (`data/control.db`: users, sessions, the tenant registry,
  domain routing, AI usage). See `src/lib/db/{schema.ts,tenant.ts,control.ts}`.
- **CMS:** multi-site — pages (block + SEO editor), blog (AI draft +
  scheduled publish), media, per-site domains, and a full-screen visual
  **Studio** editor, under `src/app/cms/`.
- **AI agents:** an Orchestrator that routes to Sales / Marketing /
  Operations specialists (plus a general-purpose Concierge for everything
  else), a write-approval gate, a per-tenant metered spend cap, and a
  multi-provider model layer (native Anthropic + OpenRouter). See
  `src/lib/agents/` and the "Agents & AI" section of `CLAUDE.md`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server (`next dev`). |
| `npm run build` | Local/dev convenience only — runs a legacy `extract` step (see below), then `next build`. |
| `npm run build:prod` | Plain `next build` — what CI and the Docker image actually run. |
| `npm start` | `next start` (the standalone server, post-build). |
| `npm run lint` | `next lint` — a reporting-only gate today. There's an unaddressed pre-existing backlog (errors included, not just warnings); CI runs it non-blocking (`continue-on-error`) rather than failing on it — see `CLAUDE.md`. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Runs every `src/**/*.test.ts` with `tsx` — a minimal assertion-based runner, no framework (`scripts/test.mjs`). |

`../extract/` is a legacy ad-library HTML extractor that predates ClientFlow.
`npm run build` still shells out to it for historical reasons, but the real
deploy path (`build:prod`, Docker, CI) never touches it.

## Deployment

Railway runs this as a persistent Node process (`next start`, standalone
output — not serverless), built from `Dockerfile`. Deploy with `railway up`
**from inside `app/`** — always `cd app` first, since the Railway service is
rooted there. Run `npx next build`, `npm run typecheck`, and `npm test`
locally before deploying; CI (`.github/workflows/ci.yml`) runs the same
checks on every push/PR to `main` but does not deploy for you — `railway up`
is still a manual step. `/api/health` is the unauthenticated liveness probe
Railway (or any uptime monitor) hits.

## Learn more

- [`CLAUDE.md`](../CLAUDE.md) — the fuller architecture, agents, and
  deployment reference (kept current for both humans and Claude Code).
- [`../docs/improvement-plan-2026-08.md`](../docs/improvement-plan-2026-08.md)
  — the current prioritized backlog.
- `docs/` (this folder) — design specs and implementation plans for past work.
