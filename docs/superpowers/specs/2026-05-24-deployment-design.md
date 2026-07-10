# Deploying ClientFlow to Production (Railway + Docker + SQLite volume)

**Date:** 2026-05-24
**Status:** Design approved — spec under review
**Part of:** the ClientFlow roadmap (item 7, Deployment — pulled forward). Unblocks
WhatsApp inbound + Gmail OAuth + the Email channel, all of which need a public
HTTPS URL.

## Context & approach

The app currently runs only on the developer's localhost. Several in-flight
features are gated on the app being reachable at a public HTTPS URL:
- **WhatsApp inbound** — the Whapi webhook can't reach localhost, so replies
  don't thread in (outbound already works live).
- **Email channel (next sub-project)** — Gmail OAuth wants a stable HTTPS
  redirect URI, and push-based inbound needs a public endpoint.

Rather than build email against localhost and re-wire everything at deploy time,
we **deploy first** so the integrations are built once, against the real domain.

**Host decision: Railway.** The owner is a solo, non-DevOps founder; Railway has
the friendliest path that still supports the app's hard requirement — a
**persistent disk for SQLite**. (Vercel/Netlify are ruled out: their serverless
filesystems are ephemeral and would lose the database and all uploads.) Fly.io
and a cheap VPS were the considered alternatives.

The marketing site at clientflow.ie stays on its current site-builder host,
untouched. The app gets its own subdomain, **`app.clientflow.ie`**.

### App constraints that shape the deploy

- **SQLite via `better-sqlite3`** (native module) — single-writer file at
  `data/clinic.db`, plus `data/control.db` (tenancy phase 0). One always-on
  instance, no horizontal scaling.
- **Self-healing schema** — `ensureTables()`/`ensureSeed()` run on boot, so there
  is no separate migration step; a fresh volume bootstraps itself.
- **All runtime-writable state lives under `data/`** — both DBs and all media:
  `branding/`, `image-library/`, `broll-library/`, `music/`, `uploads/`
  (video uploads + renders), `cards/`. A single volume at `/app/data` covers
  everything.
- **`ffmpeg-static` + `ffprobe-static`** ship prebuilt binaries via npm — no
  system ffmpeg to install; the Linux binaries are fetched during `npm ci`.
- **`public/data/*.json`** (Marketing/Irish-ads data) is **read-only at runtime**
  (`therapies.ts` only reads it). It is generated at build time by
  `extract/extract.mjs` from the source report HTML at the repo root.
- **`OPENAI_API_KEY`** (Content Studio Whisper) and **`ANTHROPIC_API_KEY`** (AI
  drafting/content) are required runtime secrets. WhatsApp config is stored
  inside `clinic.db` (settings), not in env.

### Approved decisions

- Host = **Railway**, Docker image, persistent volume at **`/app/data`**, served
  at **`app.clientflow.ie`** with auto-TLS, single instance.
- First deploy **migrates the real local `clinic.db` + media** onto the volume
  (production starts with real Renova data, not an empty seed).
- Backups = **nightly off-box snapshot** of the SQLite DB(s) to S3-compatible
  object storage (e.g. Cloudflare R2).
- Deploy via **`railway up` from the local `app/` folder** (repo is not under
  git). Git init optional, later.

## Architecture

### 1. Dockerfile (multi-stage) + Next config

- Base `node:20-bookworm-slim`.
- **Builder stage:** install build deps (`python3`, `make`, `g++`) so
  `better-sqlite3` compiles and the ffmpeg-static binaries download; `npm ci`;
  `npm run build:prod` (see §2).
- Add **`output: "standalone"`** to `next.config.mjs` for a minimal runtime image.
  (`serverComponentsExternalPackages` already lists `better-sqlite3`,
  `ffmpeg-static`, `ffprobe-static`.)
- **Runtime stage:** copy the standalone server (`.next/standalone`), static
  assets (`.next/static`), `public/` (including the baked `public/data/*.json`),
  and — because standalone tracing can miss native artifacts — explicitly ensure
  the compiled `better-sqlite3` `.node` binding and the `ffmpeg-static`/
  `ffprobe-static` binaries are present in the runtime `node_modules`.
- `WORKDIR /app`; `CMD ["node", "server.js"]`; `EXPOSE` the Next port; Railway
  injects `PORT`.
- `.dockerignore` excludes `data/`, `node_modules`, `.next`, local screenshots,
  and the dev `.devserver.log`.

### 2. Build-step decoupling (the `../extract` gotcha)

`npm run build` is `npm run extract && next build`, and `extract` reads
`../OHR_HBOT_Ad_Library_Full_Report.html` + `extract/ie-out/*.json` — files
**outside** the `app/` Docker build context. Fix:

- Add a **`build:prod` script = `next build`** (no extract). The Docker image
  uses `build:prod`.
- The already-generated `public/data/*.json` is **committed/baked into the image**
  (it exists locally from prior builds and is the static Marketing data).
- `extract` remains a local **data-refresh** tool; regenerate + redeploy only when
  ads are refreshed. (Out of scope: running extract in CI.)

### 3. Persistent volume + first-deploy data migration

- Railway volume mounted at **`/app/data`**. On boot the app creates the dir and
  self-heals tables, so an empty volume works — but we want the real data.
- **One-time migration:** upload the current local `data/clinic.db` (and
  `control.db` + existing media subfolders) onto the volume before/at first boot
  — via `railway run`/volume copy or a short bootstrap. Verify row counts
  (clients, appointments, settings incl. `whatsapp_config`) match local.
- WAL files: ensure a clean checkpoint before copying so no committed data is
  stranded in `-wal`/`-shm` (copy after a checkpoint, or copy all three files).

### 4. Environment & secrets (Railway dashboard)

- The app reads exactly three env vars: **`ANTHROPIC_API_KEY`** (AI drafting +
  content), **`OPENAI_API_KEY`** (Whisper transcription), and **`NODE_ENV`** (set
  to `production`). There is **no separate session-signing secret** — auth sessions
  are random tokens stored in `auth_sessions`, and the session cookie is set
  `secure` when `NODE_ENV=production`, which requires HTTPS (Railway provides it).
- No `DATABASE_URL` — the SQLite path is derived from `process.cwd()/data`.
- WhatsApp credentials live inside `clinic.db` (settings), so they ride along with
  the data migration. Gmail OAuth secrets are added in the email sub-project.

### 5. Domain & DNS

- Add `app.clientflow.ie` as a custom domain on the Railway service; create the
  **CNAME** Railway provides at clientflow.ie's DNS manager. TLS is automatic.
  The apex/marketing site is unaffected.

### 6. Backups — nightly snapshot

- A scheduled daily job copies `clinic.db` (+ `control.db`) to S3-compatible
  object storage (e.g. Cloudflare R2), retaining the last N days. Implemented as
  a small script invoked by a scheduler (Railway cron service / external cron
  hitting a secured route). A checkpoint precedes each copy. Worst-case loss: one
  day. (Litestream continuous replication considered; deferred — nightly is
  sufficient for one clinic now.)

### 7. Post-deploy wiring (the payoff)

- Paste `https://app.clientflow.ie/api/whatsapp/webhook?secret=…` into the Whapi
  dashboard → inbound WhatsApp replies thread in (completes the WhatsApp feature).
- Record the HTTPS origin for the upcoming Gmail OAuth redirect URI.

## Out of scope

- Multi-instance / horizontal scaling (SQLite is single-writer).
- The tenancy/DB-per-tenant swap (separate sub-project; the volume model already
  suits it).
- A full git-based CI/CD pipeline (deploy is `railway up` from local for now).
- The Email channel build itself — the sub-project this unblocks.
- Running `extract` in the cloud build; staging environment; multi-region.

## Risks & honest caveats

- **Single instance = a restart is downtime.** Acceptable for one clinic; redeploys
  are brief. No HA.
- **SQLite on a network/volume:** keep it on the mounted volume (not an overlay
  FS); single writer only — never scale the service beyond 1 replica.
- **Native build fragility:** `better-sqlite3` must compile for the image's
  Node/glibc; pin the Node version and rebuild on upgrades. Standalone output may
  need the native `.node` + ffmpeg binaries copied explicitly.
- **Data migration is one-shot and precious:** checkpoint + verify row counts;
  keep the local DB as the pre-deploy backup.
- **Cost creep:** Railway usage-based pricing; a single small instance + volume is
  modest but watch ffmpeg render CPU.
- **No git** means no platform auto-deploy; redeploys are manual `railway up`.

## Verification

- **Build:** Docker image builds locally; `better-sqlite3` loads and ffmpeg/ffprobe
  binaries resolve inside the container; `tsc`/build clean.
- **Boot:** container starts, creates/uses `/app/data`, app reachable on the
  Railway URL then on `app.clientflow.ie` over HTTPS.
- **Data:** login with the real account works; clients/appointments/settings match
  local (real data migrated, not an empty seed).
- **Render paths:** a representative page in each area renders; an image/video
  upload writes to the volume and survives a **redeploy** (volume persistence).
- **WhatsApp inbound:** with the webhook URL set in Whapi, a real inbound reply
  threads against the right lead/client and flips status; the webhook rejects
  calls with a missing/wrong secret.
- **Backup:** the nightly job produces a restorable snapshot in object storage;
  a test restore opens and queries.

## Notes

- Repo is not under git, so this spec is saved but not committed.
- Specs live at repo-root `docs/superpowers/specs/`; the app is under `app/`.
