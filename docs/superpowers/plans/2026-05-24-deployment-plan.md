# Implementation Plan — Deploy ClientFlow (Railway + Docker + SQLite volume)

**Spec:** `docs/superpowers/specs/2026-05-24-deployment-design.md`
**Approach:** one always-on Railway service running a multi-stage Docker image, a
persistent volume at `/app/data` (DBs + all media), served at `app.clientflow.ie`
with auto-TLS. First deploy migrates the real local `clinic.db` + media. Nightly
off-box DB snapshots. Deploy via `railway up` from the local `app/` folder.

**Sequencing principle:** prepare + prove the image **locally** before touching
Railway (de-risk the native build), then stand up Railway, then migrate data, then
domain, then wire WhatsApp inbound, then backups. After every code phase: `tsc`
clean + the app still boots locally.

**Who does what:**
- **[I prepare]** = code/config I write and verify (Dockerfile, next config, scripts).
- **[you do — I'll guide]** = actions needing your accounts/credentials (Railway
  signup + billing, DNS at the domain, object-storage bucket, the Whapi dashboard).
  These are interactive; I'll give exact commands/values. For interactive CLI
  logins, run them yourself in the session with `! <command>`.

---

## Phase 0 — Build artifacts [I prepare]

**Objective:** everything needed to build a production image, no Railway yet.

**Files:**
- `app/next.config.mjs` — add `output: "standalone"` (keep the existing
  `serverComponentsExternalPackages`).
- `app/package.json` — add `"build:prod": "next build"` (no `extract`). Leave the
  existing `build` (with extract) as the local data-refresh path.
- `app/Dockerfile` — multi-stage:
  - **builder** (`node:20-bookworm-slim`): `apt-get install -y python3 make g++`
    (for `better-sqlite3`); `npm ci` (lets ffmpeg-static/ffprobe-static fetch
    Linux binaries); `npm run build:prod`.
  - **runtime** (`node:20-bookworm-slim`): `WORKDIR /app`; copy
    `.next/standalone ./`, `.next/static ./.next/static`, `public ./public`
    (incl. baked `public/data/*.json`); ensure the native `better-sqlite3`
    binding + `ffmpeg-static`/`ffprobe-static` binaries are present (copy those
    packages from the builder if standalone tracing drops them — see Phase 1);
    `ENV NODE_ENV=production`; `CMD ["node","server.js"]`.
- `app/.dockerignore` — `data`, `node_modules`, `.next`, `.devserver.log`,
  `verify-*.png`, `scripts/verify-*.mjs`, `*.bak-*`.

**Verify:** `tsc --noEmit` clean; `npm run build:prod` succeeds locally; confirm
`app/public/data/{hbot,ir,pemf,index}.json` exist (baked Marketing data).

---

## Phase 1 — Local Docker build & run [I prepare]

**Objective:** prove the image runs the app with native deps before Railway.

**Steps:**
- `docker build -t clientflow ./app`.
- Run with a throwaway data dir:
  `docker run --rm -p 3000:3000 -v "$PWD/app/data:/app/data" clientflow`
  (or a copy, to avoid touching the real DB).
- Confirm in-container: app boots, `better-sqlite3` loads (no "invalid ELF" /
  bindings error), ffmpeg resolves (`ffmpeg-static` path exists), `/login`
  renders, login works against the mounted DB.

**Verify:** container serves the app on `localhost:3000`; login + a dashboard page
render; if better-sqlite3 or ffmpeg fail, fix by explicitly copying those packages
into the runtime stage, rebuild, re-run. Image builds reproducibly.

---

## Phase 2 — Railway service + volume + env [you do — I'll guide]

**Objective:** the image running on Railway with persistent storage.

**Steps:**
- Create a Railway account + project (Hobby plan is fine to start).
- `! railway login` (interactive, opens browser), then in `app/`: `railway link`
  to the project.
- Add a **Volume** to the service mounted at **`/app/data`**.
- Set service **Variables**: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
  `NODE_ENV=production` (Railway provides `PORT`).
- Deploy: `railway up` from `app/` (uses the Dockerfile). 

**Verify:** the build succeeds on Railway; the service starts; the Railway-provided
URL serves `/login` over HTTPS. (DB is still empty/seeded — real data is Phase 3.)

---

## Phase 3 — Migrate the real data onto the volume [you do — I'll guide]

**Objective:** production starts with the actual Renova data, not an empty seed.

**Steps:**
- Locally: stop the dev server; **checkpoint** WAL so nothing is stranded
  (`PRAGMA wal_checkpoint(TRUNCATE);` via a tiny node one-liner) and snapshot a
  pre-migration backup copy of `app/data/clinic.db`.
- Copy onto the volume: `data/clinic.db`, `data/control.db`, and the media dirs
  (`branding/`, `image-library/`, `broll-library/`, `music/`, `uploads/`,
  `cards/`) — via `railway run`/a one-off shell into the volume, or a small
  bootstrap upload. (Exact mechanism confirmed against Railway's volume access at
  execution time.)
- Restart the service.

**Verify:** log in with the **real** account; client/appointment counts +
settings (incl. `whatsapp_config`) match local; spot-check a client profile and
the calendar. Keep the local DB as the rollback copy.

---

## Phase 4 — Custom domain + DNS [you do — I'll guide]

**Objective:** the app at `app.clientflow.ie` over HTTPS.

**Steps:**
- In Railway: add custom domain `app.clientflow.ie`; copy the CNAME target it
  shows.
- At clientflow.ie's DNS manager: add a **CNAME** `app` → that target. (Marketing
  apex untouched.)
- Wait for propagation; Railway issues TLS automatically.

**Verify:** `https://app.clientflow.ie/login` loads with a valid cert; login works;
the secure session cookie sticks (it requires HTTPS under `NODE_ENV=production`).

---

## Phase 5 — Wire WhatsApp inbound (the payoff) [you do — I'll guide]

**Objective:** finish the WhatsApp feature — inbound replies thread in.

**Steps:**
- In Settings → WhatsApp, copy the webhook URL (it embeds `?secret=`).
- Paste it into the Whapi dashboard webhooks for channel `GRNLTR-VS8WG`.
- Send a WhatsApp **to** the linked number (085 146 0205) from a test phone.

**Verify:** the inbound reply threads against the right lead/client in the
Communication inbox + flips status; a wrong/missing secret is rejected (401).

---

## Phase 6 — Nightly DB backup to object storage [I prepare + you do]

**Objective:** an off-box, restorable snapshot daily.

**Steps:**
- **[you]** Create an S3-compatible bucket (Cloudflare R2 recommended) + an API
  token; add its creds as Railway variables.
- **[I prepare]** `app/scripts/backup-db.mjs` — checkpoint WAL, copy
  `clinic.db` (+ `control.db`) to the bucket under a dated key, prune to the last
  N days. Triggered by a Railway **cron** service (or a secured route hit by an
  external scheduler) once daily.

**Verify:** run the job manually → a dated object appears in the bucket;
download + open it read-only and query a table (test restore). Confirm the daily
schedule fires.

---

## Phase 7 — Verification pass

- `npm run build:prod` / `tsc --noEmit` clean; image builds reproducibly.
- Live app at `app.clientflow.ie`: login, real data present, a page in each major
  area renders.
- **Volume persistence:** upload an image/video, trigger a **redeploy**
  (`railway up`), confirm the file + DB survive.
- WhatsApp inbound end-to-end (Phase 5) green; secret enforcement verified.
- Backup job produces a restorable snapshot (Phase 6).
- Remove any temporary bootstrap/verify artifacts.

---

## Risk notes

- **Native build is the top risk** — Phase 1 (local Docker run) exists to catch
  `better-sqlite3`/ffmpeg packaging before Railway. Pin Node 20; rebuild on Node
  bumps.
- **Single instance** — never scale beyond 1 replica (SQLite single-writer); a
  redeploy is brief downtime (acceptable for one clinic).
- **Data migration is one-shot + precious** — checkpoint, verify counts, retain
  the local pre-migration copy as rollback.
- **No git** → deploys are manual `railway up`; there's no auto-deploy safety net,
  so verify each phase before the next.
- **Secrets** — API keys + R2 creds live only in Railway variables; never logged.
- **Cost** — watch ffmpeg render CPU on Railway's usage pricing.
- This unblocks, but does **not** include, the Email channel (next sub-project).
